// Acesso ao Google (Firestore e FCM) com a conta de serviço do Firebase, sem dependências:
// o JWT é assinado com o `crypto` do Node e trocado por um token de acesso; o resto é REST.
//
// Variável de ambiente (Vercel > Settings > Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT -> o conteúdo inteiro do .json da conta de serviço (Firebase > Configurações > Contas de serviço)
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let acct = null, tok = { v: '', exp: 0 };

function account() {
  if (acct) return acct;
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('config:FIREBASE_SERVICE_ACCOUNT');
  if (raw[0] !== '{') { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) {} }   // aceita o JSON em base64
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('config:FIREBASE_SERVICE_ACCOUNT inválida (não é JSON)'); }
  if (!j.client_email || !j.private_key || !j.project_id) throw new Error('config:FIREBASE_SERVICE_ACCOUNT incompleta');
  j.private_key = String(j.private_key).replace(/\\n/g, '\n');
  acct = j;
  return j;
}

async function accessToken() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const a = account(), now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(a.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  if (!r.ok) throw new Error('google-token ' + r.status);
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 3600) - 120) * 1000 };
  return tok.v;
}

// ---- Firestore (REST) ----
const fsBase = () => 'https://firestore.googleapis.com/v1/projects/' + account().project_id + '/databases/(default)/documents';
const seg = s => encodeURIComponent(String(s));

// valor do Firestore -> JS (só os tipos que usamos)
function val(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return undefined;
}
const plain = doc => { const o = {}; for (const k of Object.keys(doc.fields || {})) o[k] = val(doc.fields[k]); return o; };

async function fsGet(path) {
  const r = await fetch(fsBase() + '/' + path.split('/').map(seg).join('/'), { headers: { Authorization: 'Bearer ' + await accessToken() } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore get ' + r.status);
  return plain(await r.json());
}

async function fsList(collection) {
  const out = [];
  let page = '';
  for (let n = 0; n < 20; n++) {
    const r = await fetch(fsBase() + '/' + seg(collection) + '?pageSize=100' + (page ? '&pageToken=' + encodeURIComponent(page) : ''), { headers: { Authorization: 'Bearer ' + await accessToken() } });
    if (r.status === 404) break;
    if (!r.ok) throw new Error('firestore list ' + r.status);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: String(d.name).split('/').pop(), ...plain(d) }));
    page = j.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

// grava só os campos de `tokens` e `updatedAt` do documento push/{uid} (cria se não existir)
async function setPush(uid, tokens) {
  const q = '?updateMask.fieldPaths=tokens&updateMask.fieldPaths=updatedAt';
  const r = await fetch(fsBase() + '/push/' + seg(uid) + q, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      tokens: { arrayValue: { values: tokens.map(t => ({ stringValue: t })) } },
      updatedAt: { integerValue: String(Date.now()) }
    } })
  });
  if (!r.ok) throw new Error('firestore set ' + r.status);
}

// ---- FCM (HTTP v1): mensagem só de dados, o service worker do app é quem mostra ----
async function fcmSend(token, data) {
  const r = await fetch('https://fcm.googleapis.com/v1/projects/' + account().project_id + '/messages:send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, data, webpush: { headers: { Urgency: 'high', TTL: '43200' } } } })
  });
  if (r.ok) return { ok: true };
  let b = {};
  try { b = await r.json(); } catch (e) {}
  const e = b.error || {}, det = JSON.stringify(e.details || '');
  // só remove o aparelho quando o FCM diz que o token não existe mais; outros erros podem ser passageiros
  const dead = r.status === 404 || e.status === 'NOT_FOUND' || /UNREGISTERED/.test(det);
  return { ok: false, status: r.status, code: e.status || '', dead };
}

module.exports = { account, accessToken, fsGet, fsList, setPush, fcmSend };

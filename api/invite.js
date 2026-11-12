// Convite por e-mail (só o administrador). O cadastro público do Firebase fica desligado; quem entra é convidado aqui.
// Fluxo: valida o login de quem chamou -> confere que é o administrador -> cria o usuário com uma senha aleatória
// que ninguém vê -> o Firebase envia o e-mail para a pessoa criar a própria senha.
//
// POST /api/invite  (Authorization: Bearer <idToken do Firebase>)
//   { action: 'status' }              -> { admin: true|false }   (o app usa para mostrar ou esconder o cartão)
//   { action: 'invite', email: '..' } -> { ok: true, existed: true|false }
//
// Variáveis de ambiente: ADMIN_UID (UID do administrador, em Firebase > Authentication > Usuários),
//   FIREBASE_API_KEY, FIREBASE_SERVICE_ACCOUNT (ver lib/google.js)
const crypto = require('crypto');
const g = require('../lib/google');

const hits = new Map();
function limited(uid, max) {
  const now = Date.now(), a = (hits.get(uid) || []).filter(t => now - t < 10 * 60 * 1000);
  if (a.length >= max) { hits.set(uid, a); return true; }
  a.push(now); hits.set(uid, a);
  return false;
}

async function whoami(idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const u = ((await r.json()).users || [])[0];
  return u && u.localId ? { uid: u.localId } : null;
}

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const okMail = s => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const need = ['FIREBASE_API_KEY', 'FIREBASE_SERVICE_ACCOUNT', 'ADMIN_UID'].filter(k => !process.env[k]);
  if (need.length) return res.status(500).json({ error: 'config', missing: need });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = tok ? await whoami(tok) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const admin = same(user.uid, process.env.ADMIN_UID);

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}

  if (body.action === 'status') return res.status(200).json({ admin });

  if (body.action !== 'invite') return res.status(400).json({ error: 'action' });
  if (!admin) return res.status(403).json({ error: 'forbidden' });
  if (limited(user.uid, 10)) return res.status(429).json({ error: 'rate' });

  const email = String(body.email || '').trim().toLowerCase();
  if (!okMail(email)) return res.status(400).json({ error: 'badmail' });

  // senha aleatória: ninguém a conhece; a pessoa define a dela pelo link do e-mail
  const c = await g.authCreate(email, crypto.randomBytes(24).toString('base64url')).catch(e => ({ ok: false, status: 0, code: String(e.message || e).slice(0, 80) }));
  if (!c.ok && !c.exists) return res.status(502).json({ error: 'create', status: c.status, detail: c.code });

  // já tinha conta (convite repetido ou link vencido): só reenvia o link para criar uma nova senha
  const m = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + process.env.FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email })
  });
  if (!m.ok) {
    let b = {};
    try { b = await m.json(); } catch (e) {}
    return res.status(502).json({ error: 'mail', status: m.status, detail: String((b.error && b.error.message) || '').slice(0, 80), created: !c.exists });
  }
  return res.status(200).json({ ok: true, existed: !!c.exists });
};

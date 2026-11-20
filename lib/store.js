// Camada única para o servidor durante a migração Firestore -> Supabase: cada função escolhe o backend pelo formato do id
// (UUID = Supabase; o resto = Firebase) ou, no login, pelo emissor do token. As APIs chamam só este módulo.
const g = require('./google');
const sb = require('./supabase');

const isSb = uid => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(uid));

// o token é um JWT; só olhamos o emissor (iss) para escolher quem valida. Quem valida de verdade é o Firebase ou o Supabase.
function issuer(token) {
  try { return String(JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).iss || ''); } catch (e) { return ''; }
}
async function fbWhoami(idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const u = ((await r.json()).users || [])[0];
  return u && u.localId ? { uid: u.localId, email: String(u.email || '').toLowerCase() } : null;
}
async function whoami(token) {
  if (/\/auth\/v1\/?$/.test(issuer(token))) return sb.whoami(token);
  return fbWhoami(token);
}

const getPush = uid => isSb(uid) ? sb.getPush(uid) : g.fsGet('push/' + uid);
const setPush = (uid, tokens) => isSb(uid) ? sb.setPush(uid, tokens) : g.setPush(uid, tokens);
const setRun = (uid, text) => isSb(uid) ? sb.setRun(uid, text) : g.setRun(uid, text);
const setFields = (uid, o) => isSb(uid) ? sb.setFields(uid, o) : g.setFields(uid, o);

// todos os cadastros de push, dos dois backends; falha do Supabase não derruba quem está no Firebase
async function listPush() {
  const l = await g.fsList('push');
  if (sb.on()) { try { l.push(...await sb.listPush()); } catch (e) { console.log('[store] push_state: ' + String(e.message || e).slice(0, 100)); } }
  return l;
}

// estado S do usuário (objeto) ou null
async function getState(uid) {
  if (isSb(uid)) return sb.on() ? sb.loadState(uid) : null;
  const u = await g.fsGet('users/' + uid);
  return u && u.data ? JSON.parse(u.data) : null;
}

module.exports = { isSb, whoami, getPush, setPush, setRun, setFields, listPush, getState };

// Supabase pelo servidor (REST, sem dependências). Usa a chave de serviço, que ignora o RLS: NUNCA exponha ao navegador.
// Variáveis de ambiente: SUPABASE_URL (ex.: https://xxxx.supabase.co) e SUPABASE_SERVICE_ROLE_KEY (service_role ou secret).
// Uso: whoami(token) valida o login do app; loadState(uid) devolve o estado S; getPush/listPush/setPush/setRun/setFields
// cuidam da tabela push_state (aparelhos, ids já avisados, último envio).
const { fromRows } = require('./mapa');

const on = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const base = () => String(process.env.SUPABASE_URL).replace(/\/+$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
// chave antiga (JWT) vai também em Authorization; a nova (sb_secret_...) só em apikey
const hdr = extra => Object.assign({ apikey: key(), 'Content-Type': 'application/json' }, key().split('.').length === 3 ? { Authorization: 'Bearer ' + key() } : {}, extra);

async function call(path, init, what) {
  const r = await fetch(base() + path, Object.assign({}, init, { headers: hdr(init && init.headers) }));
  if (!r.ok) throw new Error('supabase ' + what + ' ' + r.status);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// quem é o dono do token do app (login do Supabase); null se inválido ou vencido
async function whoami(token) {
  if (!on()) return null;
  const r = await fetch(base() + '/auth/v1/user', { headers: { apikey: key(), Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { uid: u.id, email: String(u.email || '').toLowerCase() } : null;
}

const VAZIO = () => ({ tx: [], comp: [], cfix: [], cards: [], cx: [], sheet: [], rec: [], rules: {}, fp: {}, ord: { fx: [], vr: [] }, emo: {}, myname: '' });

// estado do usuário como o app o montaria; null se ele ainda não tem nenhuma linha
async function loadState(uid) {
  const t = await call('/rest/v1/rpc/load_all_for', { method: 'POST', body: JSON.stringify({ p_user: uid }) }, 'load_all_for');
  if (!t || Object.values(t).every(a => !a || !a.length)) return null;
  return Object.assign(VAZIO(), fromRows(t));
}

// linha de push_state -> o mesmo formato do documento push/{uid} do Firestore
const norm = r => r && ({
  id: r.user_id,
  tokens: Array.isArray(r.tokens) ? r.tokens : [],
  seen: Array.isArray(r.seen) ? r.seen : [],
  lastRun: (r.last_run && r.last_run.at) || 0, lastResult: (r.last_run && r.last_run.result) || '',
  lastHook: (r.last_hook && r.last_hook.at) || 0, lastHookResult: (r.last_hook && r.last_hook.result) || ''
});
async function getPush(uid) {
  const l = await call('/rest/v1/push_state?select=*&user_id=eq.' + encodeURIComponent(uid), { method: 'GET' }, 'push get');
  return norm((l || [])[0]) || null;
}
async function listPush() { return ((await call('/rest/v1/push_state?select=*', { method: 'GET' }, 'push list')) || []).map(norm); }

// cria ou atualiza só as colunas enviadas (merge-duplicates)
const upsert = (uid, cols) => call('/rest/v1/push_state?on_conflict=user_id',
  { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(Object.assign({ user_id: uid, updated_at: new Date().toISOString() }, cols)) }, 'push set');
const setPush = (uid, tokens) => upsert(uid, { tokens });
const setRun = (uid, result) => upsert(uid, { last_run: { at: Date.now(), result: String(result).slice(0, 200) } });
// mesmos nomes de campo do Firestore: seen, lastHook, lastHookResult
function setFields(uid, o) {
  const c = {};
  if (o.seen) c.seen = o.seen.map(String);
  if ('lastHook' in o || 'lastHookResult' in o) c.last_hook = { at: o.lastHook || Date.now(), result: String(o.lastHookResult || '').slice(0, 300) };
  return upsert(uid, c);
}

// convite por e-mail (cria o usuário e o Supabase envia o link para a pessoa criar a senha) e reenvio para quem já tem conta
async function mail(path, email, redirect) {
  const r = await fetch(base() + path + '?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', headers: hdr(), body: JSON.stringify({ email }) });
  if (r.ok) return { ok: true };
  const b = await r.json().catch(() => ({}));
  const code = String(b.error_code || b.code || b.msg || b.message || '').slice(0, 80);
  return { ok: false, status: r.status, exists: /email_exists|already.*registered/i.test(code + ' ' + (b.msg || b.message || '')), code };
}
const invite = (email, redirect) => mail('/auth/v1/invite', email, redirect);
const recover = (email, redirect) => mail('/auth/v1/recover', email, redirect);

module.exports = { invite, recover, on, whoami, loadState, getPush, listPush, setPush, setRun, setFields };

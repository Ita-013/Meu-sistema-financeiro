// Função serverless (Vercel): consulta contas e movimentações no Pluggy (Open Finance).
// Cada usuário conecta o PRÓPRIO Pluggy (Client ID + Client Secret). O Secret é criptografado aqui
// (AES-256-GCM, amarrado ao usuário) e devolvido ao app só como texto cifrado; nada fica guardado no servidor.
//
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   FIREBASE_API_KEY  -> apiKey do app web do Firebase (a mesma do index.html)
//   PLUGGY_ENC_KEY    -> uma frase longa e secreta (use 30+ caracteres aleatórios) para criptografar os Secrets
// Opcionais (só para o dono usar o próprio Pluggy sem conectar pelo app):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, ALLOWED_EMAIL, PLUGGY_ITEM_IDS
const crypto = require('crypto');
const { refresh } = require('../lib/bank');   // pede ao Pluggy que atualize os bancos (o mesmo passo do push das 9h)
const P = 'https://api.pluggy.ai';
const keys = new Map();   // apiKey do Pluggy em cache (2h)
const hits = new Map();   // limite de uso por usuário

const encKey = () => crypto.createHash('sha256').update(String(process.env.PLUGGY_ENC_KEY)).digest();
function seal(text, uid) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  c.setAAD(Buffer.from(uid));
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(b64, uid) {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), b.subarray(0, 12));
  d.setAAD(Buffer.from(uid));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
function limited(uid, kind, max) {
  const k = uid + ':' + kind, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < 10 * 60 * 1000);
  if (a.length >= max) { hits.set(k, a); return true; }
  a.push(now); hits.set(k, a);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function apiKey(c) {
  const h = crypto.createHash('sha256').update(c.id + '|' + c.secret).digest('hex'), hit = keys.get(h);
  if (hit && Date.now() < hit.exp) return hit.key;
  const r = await fetch(P + '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: c.id, clientSecret: c.secret })
  });
  if (!r.ok) { const e = new Error('auth ' + r.status); e.auth = true; throw e; }
  const key = (await r.json()).apiKey;
  if (keys.size > 200) keys.clear();
  keys.set(h, { key, exp: Date.now() + 100 * 60 * 1000 });
  return key;
}

async function pg(path, key) {
  const r = await fetch(P + path, { headers: { 'X-API-KEY': key } });
  if (!r.ok) throw new Error(path.split('?')[0] + ' ' + r.status);
  return r.json();
}

async function whoami(idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const u = ((await r.json()).users || [])[0];
  return u && u.localId ? { uid: u.localId, email: String(u.email || '').toLowerCase() } : null;
}

const top = m => { let b = '', n = 0; for (const [k, v] of m) if (v > n) { b = k; n = v; } return b; };
const isId = s => /^[0-9a-f-]{36}$/i.test(s);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const need = ['FIREBASE_API_KEY', 'PLUGGY_ENC_KEY'].filter(k => !process.env[k]);
  if (need.length) return res.status(500).json({ error: 'config', missing: need });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = tok ? await whoami(tok) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}

  // ---- conectar: valida o Client ID/Secret no Pluggy e devolve o Secret criptografado
  if (body.action === 'connect') {
    if (limited(user.uid, 'connect', 6)) return res.status(429).json({ error: 'rate' });
    const id = String(body.clientId || '').trim(), secret = String(body.clientSecret || '').trim();
    if (!isId(id) || secret.length < 16 || secret.length > 200) return res.status(400).json({ error: 'badcreds' });
    try { await apiKey({ id, secret }); }
    catch (e) { return res.status(401).json({ error: 'badcreds' }); }
    return res.status(200).json({ ok: true, clientId: id, enc: seal(secret, user.uid) });
  }

  // ---- sincronizar
  if (limited(user.uid, 'sync', 30)) return res.status(429).json({ error: 'rate' });
  let creds = null;
  if (body.cred && body.cred.id && body.cred.enc) {
    try { creds = { id: String(body.cred.id), secret: unseal(String(body.cred.enc), user.uid) }; }
    catch (e) { return res.status(401).json({ error: 'badcreds' }); }
  } else if (process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET && process.env.ALLOWED_EMAIL &&
             user.email === process.env.ALLOWED_EMAIL.trim().toLowerCase()) {
    creds = { id: process.env.PLUGGY_CLIENT_ID, secret: process.env.PLUGGY_CLIENT_SECRET };
  }
  if (!creds) return res.status(400).json({ error: 'nocred' });

  try {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    let items = Array.isArray(body.items) ? body.items.map(s => String(s).trim()).filter(isId)
      : (!body.cred && process.env.PLUGGY_ITEM_IDS ? process.env.PLUGGY_ITEM_IDS.split(',').map(s => s.trim()).filter(isId) : []);
    if (!items.length) return res.status(400).json({ error: 'noitems' });
    items = [...new Set(items)].slice(0, 10);

    // refresh manual (botão ⟳ do app): gasta cota do plano do Pluggy, então tem limite próprio
    if (body.refresh === true && limited(user.uid, 'refresh', 3)) return res.status(429).json({ error: 'rate' });
    const key = await apiKey(creds);
    // pede a atualização no banco e espera até 28 s (o limite da função é 60 s; ver vercel.json); depois lê normalmente
    const refreshed = body.refresh === true ? await refresh(items, key, 28000) : null;
    const accounts = [], transactions = [], usedItems = [], errors = [], owners = [];

    for (const itemId of items) {
      try {
        let inst = '', istatus = '', iupd = '';
        try { const it = await pg('/items/' + itemId, key); inst = (it.connector && it.connector.name) || ''; istatus = it.status || ''; iupd = it.lastUpdatedAt || ''; } catch (e) {}
        const accs = (await pg('/accounts?itemId=' + itemId, key)).results || [];
        const seen = new Map();
        for (const a of accs) {
          const isCard = a.type === 'CREDIT' && a.subtype === 'CREDIT_CARD';
          if (!(a.type === 'BANK' || isCard)) continue;
          accounts.push({ id: a.id, itemId, inst, name: a.marketingName || a.name || '', number: a.number || '', card: isCard });
          // faturas do cartão: data real de vencimento de cada fatura (se o conector informar)
          const bills = new Map();
          if (isCard) {
            try {
              for (let pgn = 1, tp = 1; pgn <= tp && pgn <= 5; pgn++) {
                const b = await pg('/bills?accountId=' + a.id + '&page=' + pgn, key);
                tp = b.totalPages || 1;
                (b.results || []).forEach(x => { if (x.id && x.dueDate) bills.set(x.id, String(x.dueDate).slice(0, 10)); });
              }
            } catch (e) {}
          }
          let q = '?accountId=' + a.id + '&dateFrom=' + from + '&dateTo=' + to, n = 0;
          while (q && n++ < 40) {
            const d = await pg('/v2/transactions' + q, key);
            (d.results || []).forEach(t => {
              const m = t.creditCardMetadata || {}, pd = t.paymentData || {};
              const debit = t.type === 'DEBIT';
              const mine = ((debit ? pd.payer : pd.receiver) || {}).name;
              const cp = ((debit ? pd.receiver : pd.payer) || {}).name || '';
              if (mine) seen.set(mine, (seen.get(mine) || 0) + 1);
              transactions.push({
                id: t.id, accountId: a.id, date: t.date, description: t.description,
                amount: t.amount, type: t.type, status: t.status, cp,
                installmentNumber: m.installmentNumber || 0, totalInstallments: m.totalInstallments || 0,
                billDue: (m.billId && bills.get(m.billId)) || '',
                method: pd.paymentMethod || ''
              });
            });
            q = d.next || null;
          }
        }
        const o = top(seen); if (o) owners.push(o);
        usedItems.push({ id: itemId, inst, status: istatus, updatedAt: iupd });
      } catch (e) {
        errors.push({ itemId, detail: String(e.message || e).slice(0, 120) });
      }
    }
    res.status(200).json({ accounts, transactions, items: usedItems, errors, me: [...new Set(owners)], from, at: Date.now(), refresh: refreshed });
  } catch (e) {
    if (e && e.auth) return res.status(401).json({ error: 'badcreds' });
    res.status(502).json({ error: 'pluggy', detail: String(e.message || e).slice(0, 200) });
  }
};

// Função serverless (Vercel): busca contas e movimentações no Pluggy (Open Finance).
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET  -> credenciais da aplicação no Pluggy Dashboard
//   PLUGGY_ITEM_IDS                         -> ids das conexões (itemId), separados por vírgula
//   FIREBASE_API_KEY                        -> apiKey do app web do Firebase (a mesma do index.html)
//   ALLOWED_EMAIL                           -> e-mail que pode usar esta função (o seu)
const P = 'https://api.pluggy.ai';
let cache = { key: '', exp: 0 };

async function apiKey() {
  if (cache.key && Date.now() < cache.exp) return cache.key;
  const r = await fetch(P + '/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET })
  });
  if (!r.ok) throw new Error('auth ' + r.status);
  cache = { key: (await r.json()).apiKey, exp: Date.now() + 100 * 60 * 1000 };
  return cache.key;
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
  return u ? { email: String(u.email || '').toLowerCase(), verified: !!u.emailVerified } : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const need = ['PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET', 'PLUGGY_ITEM_IDS', 'FIREBASE_API_KEY', 'ALLOWED_EMAIL'].filter(k => !process.env[k]);
  if (need.length) return res.status(500).json({ error: 'config', missing: need });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = tok ? await whoami(tok) : null;
  if (!me || me.email !== process.env.ALLOWED_EMAIL.trim().toLowerCase()) return res.status(401).json({ error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const key = await apiKey();
    const items = process.env.PLUGGY_ITEM_IDS.split(',').map(s => s.trim()).filter(Boolean);
    const accounts = [], transactions = [];

    for (const itemId of items) {
      let inst = '';
      try { const it = await pg('/items/' + itemId, key); inst = (it.connector && it.connector.name) || ''; } catch (e) {}
      const accs = (await pg('/accounts?itemId=' + itemId, key)).results || [];
      for (const a of accs) {
        const isCard = a.type === 'CREDIT' && a.subtype === 'CREDIT_CARD';
        if (!(a.type === 'BANK' || isCard)) continue;
        accounts.push({ id: a.id, itemId, inst, name: a.marketingName || a.name || '', number: a.number || '', card: isCard });
        // API v2 (paginação por cursor): o campo "next" já traz a query da próxima página
        let q = '?accountId=' + a.id + '&dateFrom=' + from + '&dateTo=' + to, n = 0;
        while (q && n++ < 40) {
          const d = await pg('/v2/transactions' + q, key);
          (d.results || []).forEach(t => {
            const m = t.creditCardMetadata || {}, pd = t.paymentData || {};
            transactions.push({
              id: t.id, accountId: a.id, date: t.date, description: t.description,
              amount: t.amount, type: t.type, status: t.status,
              installmentNumber: m.installmentNumber || 0, totalInstallments: m.totalInstallments || 0,
              method: pd.paymentMethod || ''
            });
          });
          q = d.next || null;
        }
      }
    }
    res.status(200).json({ accounts, transactions, from, at: Date.now() });
  } catch (e) {
    res.status(502).json({ error: 'pluggy', detail: String(e.message || e).slice(0, 200) });
  }
};

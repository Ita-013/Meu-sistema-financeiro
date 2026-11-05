// Função serverless (Vercel): busca contas e movimentações no Pluggy (Open Finance).
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET  -> credenciais da aplicação no Pluggy Dashboard
//   FIREBASE_API_KEY                        -> apiKey do app web do Firebase (a mesma do index.html)
//   ALLOWED_EMAIL                           -> e-mail que pode usar esta função (o seu)
//   PLUGGY_ITEM_IDS (opcional)              -> itemIds iniciais; depois você gerencia os bancos pelo app
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
  return u ? { email: String(u.email || '').toLowerCase() } : null;
}

const top = m => { let b = '', n = 0; for (const [k, v] of m) if (v > n) { b = k; n = v; } return b; };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const need = ['PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET', 'FIREBASE_API_KEY', 'ALLOWED_EMAIL'].filter(k => !process.env[k]);
  if (need.length) return res.status(500).json({ error: 'config', missing: need });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = tok ? await whoami(tok) : null;
  if (!me || me.email !== process.env.ALLOWED_EMAIL.trim().toLowerCase()) return res.status(401).json({ error: 'unauthorized' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const isId = s => /^[0-9a-f-]{36}$/i.test(s);
    let items = Array.isArray(body.items) ? body.items.map(s => String(s).trim()).filter(isId) : (process.env.PLUGGY_ITEM_IDS || '').split(',').map(s => s.trim()).filter(isId);
    if (!items.length) return res.status(400).json({ error: 'noitems' });
    items = [...new Set(items)].slice(0, 10);

    const key = await apiKey();
    const accounts = [], transactions = [], usedItems = [], errors = [], owners = [];

    for (const itemId of items) {
      try {
        let inst = '';
        try { const it = await pg('/items/' + itemId, key); inst = (it.connector && it.connector.name) || ''; } catch (e) {}
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
        usedItems.push({ id: itemId, inst });
      } catch (e) {
        errors.push({ itemId, detail: String(e.message || e).slice(0, 120) });
      }
    }
    res.status(200).json({ accounts, transactions, items: usedItems, errors, me: [...new Set(owners)], from, at: Date.now() });
  } catch (e) {
    res.status(502).json({ error: 'pluggy', detail: String(e.message || e).slice(0, 200) });
  }
};

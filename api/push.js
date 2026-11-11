// Função serverless (Vercel): cadastra os aparelhos que recebem o push diário (token do FCM) e envia um push de teste.
// O token fica em Firestore, em push/{uid}, gravado só por aqui (conta de serviço): não precisa mexer nas regras do Firestore.
//
// Variáveis de ambiente: FIREBASE_API_KEY (a mesma do index.html) e FIREBASE_SERVICE_ACCOUNT (ver lib/google.js)
const g = require('../lib/google');
const hits = new Map();   // limite de uso por usuário

function limited(uid, max) {
  const now = Date.now(), a = (hits.get(uid) || []).filter(t => now - t < 10 * 60 * 1000);
  if (a.length >= max) { hits.set(uid, a); return true; }
  a.push(now); hits.set(uid, a);
  if (hits.size > 5000) hits.clear();
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

const okToken = t => typeof t === 'string' && /^[\w:.\-]{20,4096}$/.test(t);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const need = ['FIREBASE_API_KEY', 'FIREBASE_SERVICE_ACCOUNT'].filter(k => !process.env[k]);
  if (need.length) return res.status(500).json({ error: 'config', missing: need });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = tok ? await whoami(tok) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (limited(user.uid, 30)) return res.status(429).json({ error: 'rate' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}

  try {
    const doc = await g.fsGet('push/' + user.uid);
    let tokens = Array.isArray(doc && doc.tokens) ? doc.tokens.filter(okToken) : [];

    if (body.action === 'register') {
      if (!okToken(body.token)) return res.status(400).json({ error: 'badtoken' });
      tokens = tokens.filter(t => t !== body.token).concat(body.token).slice(-5);   // até 5 aparelhos, os mais recentes
      await g.setPush(user.uid, tokens);
      return res.status(200).json({ ok: true, devices: tokens.length });
    }

    if (body.action === 'status') {   // o que o envio diário (cron) fez por último, gravado por api/daily.js
      return res.status(200).json({ ok: true, devices: tokens.length, lastRun: (doc && doc.lastRun) || 0, lastResult: (doc && doc.lastResult) || '' });
    }

    if (body.action === 'unregister') {
      if (!okToken(body.token)) return res.status(400).json({ error: 'badtoken' });
      await g.setPush(user.uid, tokens.filter(t => t !== body.token));
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'test') {
      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0, error: 'nodevice' });
      let sent = 0, dead = [], code = '';
      for (const t of tokens) {
        const r = await g.fcmSend(t, { title: 'Meu caixa', body: 'Teste do push do servidor: está funcionando.', tag: 'caixa-teste' });
        if (r.ok) sent++; else { if (r.dead) dead.push(t); code = code || r.code || String(r.status); }
      }
      if (dead.length) await g.setPush(user.uid, tokens.filter(t => !dead.includes(t)));
      return res.status(200).json({ ok: true, sent, failed: tokens.length - sent, error: sent ? undefined : code || 'fcm' });
    }

    return res.status(400).json({ error: 'action' });
  } catch (e) {
    const m = String(e && e.message || e);
    if (/^config:/.test(m)) return res.status(500).json({ error: 'config', detail: m.slice(7, 120) });
    return res.status(502).json({ error: 'push', detail: m.slice(0, 160) });
  }
};

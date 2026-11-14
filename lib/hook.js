// Assinatura do webhook do Pluggy: cada conta tem a sua, derivada do CRON_SECRET (só a Vercel conhece).
// O Pluggy manda essa assinatura de volta no cabeçalho X-Caixa-Sig a cada chamada (ver api/hook.js e o
// cadastro em api/pluggy.js, action 'hook'). Sem ela, ninguém de fora consegue disparar push em nome da conta.
const crypto = require('crypto');
const sig = uid => crypto.createHmac('sha256', String(process.env.CRON_SECRET || '')).update('pluggy-hook:' + uid).digest('hex');
const okSig = (uid, got) => { const a = Buffer.from(sig(uid)), b = Buffer.from(String(got || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const EVENTS = ['item/updated', 'transactions/created'];
const VERSION = 1;   // sobe quando o cadastro mudar (o app recadastra sozinho)
module.exports = { sig, okSig, EVENTS, VERSION };

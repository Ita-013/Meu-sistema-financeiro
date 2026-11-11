// Função serverless (Vercel), chamada pelo agendador (cron) do vercel.json uma vez por dia, por volta das 9h de Brasília.
// Para cada usuário com aparelho cadastrado: lê o estado do app (Firestore, SOMENTE leitura), monta o aviso com
// contas vencidas, contas que vencem hoje e movimentações para conciliar, e envia o push (FCM).
//
// Variáveis de ambiente: CRON_SECRET, FIREBASE_SERVICE_ACCOUNT (ver lib/google.js), PLUGGY_ENC_KEY (ver lib/bank.js)
const crypto = require('crypto');
const g = require('../lib/google');
const { compute, linhas, hoje } = require('../lib/plan');
const { novas } = require('../lib/bank');

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'config', missing: ['CRON_SECRET'] });
  if (!same(req.headers.authorization || '', 'Bearer ' + secret)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(500).json({ error: 'config', missing: ['FIREBASE_SERVICE_ACCOUNT'] });

  const t = hoje();
  const out = { day: t, users: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    const docs = await g.fsList('push');
    for (const d of docs) {
      const tokens = Array.isArray(d.tokens) ? d.tokens.filter(x => typeof x === 'string' && x) : [];
      let why = '';   // o que aconteceu com este usuário; fica gravado em push/{uid} para o app mostrar
      if (!tokens.length) why = 'sem aparelho cadastrado';
      else {
        out.users++;
        try {
          const u = await g.fsGet('users/' + d.id);
          if (!u || !u.data) { out.skipped++; why = 'sem dados do app'; }
          else {
            const S = JSON.parse(u.data);
            const r = compute(S, t);
            const b = await novas(S, d.id, t);
            const l = linhas(r, b.n || 0, !!(b.err || b.partial));
            if (!l.length) { out.skipped++; why = 'nada a avisar hoje'; }   // nada atrasado, vencendo ou para conciliar
            else {
              const msg = { title: 'Meu caixa', body: l.join('\n'), tag: 'caixa-diario', day: t };
              const dead = [], codes = [];
              let ok = 0;
              for (const tk of tokens) {
                const s = await g.fcmSend(tk, msg);
                if (s.ok) { out.sent++; ok++; } else { out.failed++; codes.push(s.code || s.status); if (s.dead) dead.push(tk); }
              }
              if (dead.length) await g.setPush(d.id, tokens.filter(x => !dead.includes(x)));
              why = ok + ' de ' + tokens.length + ' aparelho(s) enviado(s)' + (codes.length ? ' · erro FCM: ' + [...new Set(codes)].join(', ') : '') + (dead.length ? ' · removido(s) ' + dead.length + ' inválido(s)' : '');
            }
          }
        } catch (e) {
          out.failed++;   // um usuário com problema não impede os outros
          why = 'erro: ' + String(e && e.message || e).slice(0, 120);
        }
      }
      console.log('[daily] ' + t + ' ' + d.id.slice(0, 6) + ' ' + why);   // aparece no log da Vercel (guarda ~1h no plano Hobby)
      try { await g.setRun(d.id, t + ' · ' + why); } catch (e) {}   // o registro que fica: o app lê por /api/push (action status)
    }
    console.log('[daily] resumo ' + JSON.stringify(out));
    res.status(200).json(out);
  } catch (e) {
    const m = String(e && e.message || e);
    if (/^config:/.test(m)) return res.status(500).json({ error: 'config', detail: m.slice(7, 120) });
    res.status(502).json({ error: 'daily', detail: m.slice(0, 160) });
  }
};

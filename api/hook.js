// Função serverless (Vercel) chamada pelo PLUGGY (webhook) quando um banco termina de atualizar.
// Fluxo: banco atualiza no Pluggy -> Pluggy chama /api/hook?u={uid} com o cabeçalho X-Caixa-Sig ->
// aqui conferimos a assinatura, contamos as movimentações que o app ainda não importou e que ainda não foram
// avisadas, e mandamos o push (FCM) na hora, com o app fechado. Nada é gravado em users/{uid} (o app importa).
//
// O cadastro do webhook no Pluggy é feito pelo app (api/pluggy.js, action 'hook'), com a chave da própria conta.
// Variáveis de ambiente: CRON_SECRET (assinatura), FIREBASE_SERVICE_ACCOUNT, PLUGGY_ENC_KEY.
const g = require('../lib/google');
const store = require('../lib/store');
const { hoje } = require('../lib/plan');
const { novas } = require('../lib/bank');
const { okSig, EVENTS } = require('../lib/hook');

const fmtHora = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const uid = String((req.query && req.query.u) || '');
  if (!/^[\w-]{10,128}$/.test(uid) || !process.env.CRON_SECRET || !okSig(uid, req.headers['x-caixa-sig'])) return res.status(401).json({ error: 'unauthorized' });

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}
  const ev = String(body.event || '');
  if (!EVENTS.includes(ev)) return res.status(200).json({ ok: true, ignored: ev || 'sem evento' });   // 200: o Pluggy não precisa repetir

  // o Pluggy manda item/updated e transactions/created quase juntos na mesma atualização: o segundo espera o
  // primeiro gravar os ids avisados, para não chegar push repetido
  if (ev === 'transactions/created') await new Promise(r => setTimeout(r, 20000));
  const t = hoje();
  let why = '';
  try {
    const doc = await store.getPush(uid);
    const tokens = Array.isArray(doc && doc.tokens) ? doc.tokens.filter(x => typeof x === 'string' && x) : [];
    const seen = Array.isArray(doc && doc.seen) ? doc.seen : [];
    const S = await store.getState(uid);
    if (!S) why = 'sem dados do app';
    else {
      if (body.itemId && !(S.pgItems || []).some(i => String(i.id) === String(body.itemId))) why = 'banco que não é desta conta';
      else {
        const b = await novas(S, uid, t, { refresh: false, seen });
        if (b.skip) why = 'Pluggy não conectado';
        else if (b.err) why = 'não consegui ler o Pluggy';
        else if (!b.fresh.length) why = 'nada novo para avisar';
        else if (!tokens.length) why = b.fresh.length + ' nova(s), mas sem aparelho cadastrado';
        else {
          const n = b.fresh.length;
          const msg = { title: 'Meu caixa', body: n + (n === 1 ? ' movimentação nova do banco para conciliar.' : ' movimentações novas do banco para conciliar.'), tag: 'caixa-banco', day: t };
          let ok = 0; const dead = [];
          for (const tk of tokens) { const s = await g.fcmSend(tk, msg); if (s.ok) ok++; else if (s.dead) dead.push(tk); }
          if (dead.length) await store.setPush(uid, tokens.filter(x => !dead.includes(x)));
          // guarda os ids avisados (os mais recentes) para o próximo aviso não repetir as mesmas
          if (ok) await store.setFields(uid, { seen: [...seen, ...b.fresh].slice(-400) });
          why = n + ' nova(s), push ' + ok + ' de ' + tokens.length + ' aparelho(s)';
        }
      }
    }
  } catch (e) {
    why = 'erro: ' + String(e && e.message || e).slice(0, 100);
  }
  console.log('[hook] ' + ev + ' ' + uid.slice(0, 6) + ' ' + why);
  try { await store.setFields(uid, { lastHook: Date.now(), lastHookResult: fmtHora() + ' · ' + ev + ' · ' + why }); } catch (e) {}
  res.status(200).json({ ok: true });
};

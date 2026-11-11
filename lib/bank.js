// Conta quantas movimentações do banco (Pluggy) ainda não foram importadas pelo app.
// Só leitura: não grava nada no Firestore (o app é quem importa e confirma; ver index.html, pgIngest).
//
// Variável de ambiente: PLUGGY_ENC_KEY (a mesma de api/pluggy.js), para abrir o Client Secret salvo no app.
const crypto = require('crypto');
const P = 'https://api.pluggy.ai';
const isId = s => /^[0-9a-f-]{36}$/i.test(s);
const norm = x => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function unseal(b64, uid) {
  const k = crypto.createHash('sha256').update(String(process.env.PLUGGY_ENC_KEY)).digest();
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
  d.setAAD(Buffer.from(uid));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

async function pg(path, key) {
  const r = await fetch(P + path, { headers: { 'X-API-KEY': key } });
  if (!r.ok) throw new Error(path.split('?')[0] + ' ' + r.status);
  return r.json();
}

// mesmas regras automáticas de "ignorar" do app (pgSkip) que não dependem de nomes; transferências entre contas
// próprias dependem do seu nome e só o app aplica, então a contagem pode ficar um pouco acima
const interna = (desc, card, type) => {
  const nd = norm(desc || '');
  return /rendiment/.test(nd) || /dinheiro (retirado|reservado)|cofrinho|pagamento de fatura/.test(nd) || (card && type === 'in' && /^pagamento/.test(nd));
};

// devolve { n } com a quantidade de movimentações novas, { skip:true } se o Pluggy não está conectado,
// ou { err:true } se a consulta falhou
async function novas(S, uid, t) {
  const items = (S.pgItems || []).map(i => String(i.id)).filter(isId).slice(0, 10);
  if (!S.pgCred || !S.pgCred.id || !S.pgCred.enc || !items.length) return { skip: true };
  try {
    const secret = unseal(String(S.pgCred.enc), uid);
    const a = await fetch(P + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: S.pgCred.id, clientSecret: secret }) });
    if (!a.ok) throw new Error('auth ' + a.status);
    const key = (await a.json()).apiKey;
    const from = new Date(Date.parse(t + 'T12:00:00Z') - 15 * 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.parse(t + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    const known = new Set((S.rec || []).map(x => x.id)), cards = new Set((S.cards || []).map(c => c.pg).filter(Boolean));
    let n = 0, bad = 0;
    for (const itemId of items) {
      try {
        const accs = (await pg('/accounts?itemId=' + itemId, key)).results || [];
        for (const acc of accs) {
          const isCard = acc.type === 'CREDIT' && acc.subtype === 'CREDIT_CARD';
          if (!(acc.type === 'BANK' || isCard)) continue;
          if (isCard && !cards.has(acc.id)) continue;   // cartão ainda não associado a um cartão do sistema: o app também ignora
          let q = '?accountId=' + acc.id + '&dateFrom=' + from + '&dateTo=' + to, k = 0;
          while (q && k++ < 40) {
            const d = await pg('/v2/transactions' + q, key);
            (d.results || []).forEach(x => {
              const amount = Math.abs(+x.amount || 0), date = String(x.date || '').slice(0, 10);
              if (!amount || !/^\d{4}-\d\d-\d\d$/.test(date) || known.has('p:' + x.id)) return;
              if (interna(x.description, isCard, x.type === 'CREDIT' ? 'in' : 'out')) return;
              n++;
            });
            q = d.next || null;
          }
        }
      } catch (e) { bad++; }
    }
    return bad === items.length ? { err: true } : { n, partial: bad > 0 };
  } catch (e) {
    return { err: true };
  }
}

module.exports = { novas };

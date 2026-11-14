// Testes do webhook do Pluggy (api/hook.js) sem internet: fetch é trocado por respostas falsas de Firestore, Pluggy e FCM.
// Chamado por tools/regressao.js. Devolve a lista de resultados no mesmo formato dos testes do navegador.
const crypto = require('crypto');
module.exports = async () => {
  const out = [], t = (id, n, ok, d) => out.push({ id, n, ok: !!ok, d });
  process.env.CRON_SECRET = 'segredo-de-teste'; process.env.PLUGGY_ENC_KEY = 'chave-de-teste-pluggy-123456789';
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'x@y.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'p' });
  const uid = 'usuarioTeste123';
  const k = crypto.createHash('sha256').update(process.env.PLUGGY_ENC_KEY).digest(), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from(uid)); const ct = Buffer.concat([c.update('segredo-do-cliente-pluggy', 'utf8'), c.final()]);
  const enc = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), item = '11111111-1111-1111-1111-111111111111';
  const S = { pgCred: { id: '22222222-2222-2222-2222-222222222222', enc }, pgItems: [{ id: item }], rec: [{ id: 'p:ja-importada' }], cards: [] };
  let pushDoc, fcm = 0, patches = [];
  const fsv = v => Array.isArray(v) ? { arrayValue: { values: v.map(x => ({ stringValue: x })) } } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v };
  const doc = o => ({ fields: Object.fromEntries(Object.entries(o).map(([a, b]) => [a, fsv(b)])) });
  const J = (o, st) => ({ ok: (st || 200) < 400, status: st || 200, json: async () => o });
  global.fetch = async (url, o) => {
    url = String(url); o = o || {};
    if (url.includes('oauth2.googleapis.com')) return J({ access_token: 'tk', expires_in: 3600 });
    if (url.includes('/documents/push/') && o.method === 'PATCH') { const b = JSON.parse(o.body); patches.push(Object.keys(b.fields)); for (const [a, v] of Object.entries(b.fields)) pushDoc[a] = v.arrayValue ? (v.arrayValue.values || []).map(x => x.stringValue) : v.integerValue ? +v.integerValue : v.stringValue; return J({}); }
    if (url.includes('/documents/push/')) return J(doc(pushDoc));
    if (url.includes('/documents/users/')) return J(doc({ data: JSON.stringify(S) }));
    if (url.endsWith('/auth')) return J({ apiKey: 'k' });
    if (url.includes('/accounts?')) return J({ results: [{ id: 'acc', type: 'BANK' }] });
    if (url.includes('/v2/transactions')) return J({ results: [
      { id: 'ja-importada', amount: -10, date: new Date().toISOString(), description: 'Mercado' },
      { id: 'nova-1', amount: -25, date: new Date().toISOString(), description: 'Padaria' },
      { id: 'nova-2', amount: 80, type: 'CREDIT', date: new Date().toISOString(), description: 'Pix recebido' },
      { id: 'rend', amount: 1, type: 'CREDIT', date: new Date().toISOString(), description: 'Rendimento' }] });
    if (url.includes('fcm.googleapis.com')) { fcm++; return J({}); }
    return J({}, 404);
  };
  const hook = require('../api/hook'), { sig } = require('../lib/hook');
  const call = async (h, ev) => { let st = 0, body; const res = { setHeader() {}, status(x) { st = x; return this; }, json(b) { body = b; return this; } };
    await hook({ method: 'POST', query: { u: uid }, headers: h, body: { event: ev || 'item/updated', itemId: item } }, res); return { st, body }; };

  pushDoc = { tokens: ['token-do-aparelho-com-mais-de-vinte'] };
  const r0 = await call({ 'x-caixa-sig': 'errada' });
  t('R101', 'Webhook: chamada sem a assinatura certa é recusada (401) e não envia push', r0.st === 401 && fcm === 0, 'status ' + r0.st);
  const r1 = await call({ 'x-caixa-sig': sig(uid) });
  const avisou = fcm === 1 && (pushDoc.seen || []).join() === 'p:nova-1,p:nova-2' && /2 nova/.test(pushDoc.lastHookResult || '');
  const r2 = await call({ 'x-caixa-sig': sig(uid) });
  t('R102', 'Webhook: avisa na hora só as movimentações novas (fora as já importadas e as internas) e não repete as mesmas na chamada seguinte', r1.st === 200 && avisou && fcm === 1 && /nada novo/.test(pushDoc.lastHookResult || ''), 'push enviados ' + fcm + '; seen ' + (pushDoc.seen || []).join() + '; último: ' + pushDoc.lastHookResult);
  return out;
};

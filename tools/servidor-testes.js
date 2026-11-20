// Testes do servidor na migração Firestore -> Supabase: lib/supabase.js e lib/store.js com fetch simulado (sem rede).
// Uso: node tools/servidor-testes.js        (os testes da função SQL load_all_for rodam em tools/sql-testes.sh, se existir Postgres)
const assert = require('assert');
process.env.SUPABASE_URL = 'https://abc.supabase.co/';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'a.b.c';   // forma de JWT: vai também em Authorization
process.env.FIREBASE_API_KEY = 'fbkey';
const M = require('../lib/mapa');
const calls = [];
let rota = () => ({ ok: false, status: 500, json: async () => ({}) });
global.fetch = async (url, init = {}) => { calls.push({ url, init }); return rota(url, init); };
const resp = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
const jwt = iss => 'x.' + Buffer.from(JSON.stringify({ iss })).toString('base64url') + '.y';
let ok = 0, falhas = 0;
const t = async (n, f) => { calls.length = 0; try { await f(); ok++ } catch (e) { falhas++; console.log('FALHOU: ' + n + '\n   ' + String(e.message).split('\n')[0]) } };
(async () => {
  const sb = require('../lib/supabase'), store = require('../lib/store');

  await t('whoami (Supabase): manda apikey e o token do usuário; devolve uid e e-mail', async () => {
    rota = () => resp({ id: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'Ana@X.com' });
    const u = await sb.whoami('tok');
    assert.deepStrictEqual(u, { uid: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'ana@x.com' });
    assert.strictEqual(calls[0].url, 'https://abc.supabase.co/auth/v1/user');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok'); assert.strictEqual(calls[0].init.headers.apikey, 'a.b.c');
  });
  await t('whoami (Supabase): token recusado -> null', async () => { rota = () => resp({}, 401); assert.strictEqual(await sb.whoami('ruim'), null) });

  await t('store.whoami escolhe o validador pelo emissor do token', async () => {
    rota = url => /auth\/v1\/user/.test(url) ? resp({ id: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'a@a' }) : resp({ users: [{ localId: 'fbuid123456789012345678', email: 'B@b' }] });
    const a = await store.whoami(jwt('https://abc.supabase.co/auth/v1'));
    assert.ok(a.uid.includes('-') && calls[0].url.includes('/auth/v1/user'));
    calls.length = 0;
    const b = await store.whoami(jwt('https://securetoken.google.com/proj'));
    assert.strictEqual(b.uid, 'fbuid123456789012345678'); assert.ok(calls[0].url.includes('identitytoolkit'));
    assert.strictEqual(await store.whoami('lixo-sem-jwt').then(r => r && r.uid), 'fbuid123456789012345678');   // sem emissor legível cai no Firebase
  });

  await t('loadState: chama load_all_for com o uid, monta o S igual ao fromRows e preenche listas vazias', async () => {
    const S0 = { tx: [{ id: 5, type: 'out', amount: 10.5, desc: 'Pão', cat: 'Mercado', date: '2026-11-03', pay: 'Pix' }], comp: [], cards: [], cx: [], sheet: [], rec: [], rules: {}, cats: null, goal: { name: '', target: 0, saved: 0 } };
    const tabelas = M.toRows(S0).tables;
    rota = () => resp(tabelas);
    const S = await sb.loadState('aaaaaaaa-1111-2222-3333-444444444444');
    assert.strictEqual(S.tx.length, 1); assert.strictEqual(S.tx[0].desc, 'Pão');
    assert.ok(Array.isArray(S.cfix) && Array.isArray(S.comp) && S.ord && S.emo);
    assert.strictEqual(JSON.parse(calls[0].init.body).p_user, 'aaaaaaaa-1111-2222-3333-444444444444');
    assert.ok(calls[0].url.endsWith('/rest/v1/rpc/load_all_for'));
  });
  await t('loadState: usuário sem nenhuma linha -> null ("sem dados do app")', async () => {
    rota = () => resp(Object.fromEntries(M.TABELAS.map(x => [x, []])));
    assert.strictEqual(await sb.loadState('aaaaaaaa-1111-2222-3333-444444444444'), null);
  });
  await t('erro do banco vira exceção com o código (o daily marca "erro" e segue para o próximo)', async () => {
    rota = () => resp({}, 403);
    await assert.rejects(() => sb.loadState('aaaaaaaa-1111-2222-3333-444444444444'), /load_all_for 403/);
  });

  await t('push_state: setPush faz upsert só das colunas enviadas (merge-duplicates)', async () => {
    rota = () => ({ ok: true, status: 201, json: async () => null });
    await sb.setPush('aaaaaaaa-1111-2222-3333-444444444444', ['t1', 't2']);
    const c = calls[0], b = JSON.parse(c.init.body);
    assert.ok(c.url.endsWith('/rest/v1/push_state?on_conflict=user_id')); assert.match(c.init.headers.Prefer, /merge-duplicates/);
    assert.deepStrictEqual(b.tokens, ['t1', 't2']); assert.ok(!('seen' in b) && !('last_run' in b));
  });
  await t('push_state: setFields mapeia seen e lastHook para as colunas do banco', async () => {
    rota = () => ({ ok: true, status: 201, json: async () => null });
    await sb.setFields('aaaaaaaa-1111-2222-3333-444444444444', { seen: ['a', 'b'], lastHook: 123, lastHookResult: 'ok' });
    const b = JSON.parse(calls[0].init.body);
    assert.deepStrictEqual(b.seen, ['a', 'b']); assert.deepStrictEqual(b.last_hook, { at: 123, result: 'ok' }); assert.ok(!('tokens' in b));
  });
  await t('push_state: getPush devolve o mesmo formato do documento push/{uid} do Firestore', async () => {
    rota = () => resp([{ user_id: 'u', tokens: ['x'], seen: ['s'], last_run: { at: 9, result: 'r' }, last_hook: { at: 8, result: 'h' } }]);
    const d = await sb.getPush('aaaaaaaa-1111-2222-3333-444444444444');
    assert.deepStrictEqual([d.tokens, d.seen, d.lastRun, d.lastResult, d.lastHook, d.lastHookResult], [['x'], ['s'], 9, 'r', 8, 'h']);
    assert.ok(calls[0].url.includes('user_id=eq.aaaaaaaa'));
  });
  await t('chave nova (sb_secret_) vai só em apikey, sem Authorization', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_abc';
    rota = () => ({ ok: true, status: 200, json: async () => [] });
    await sb.getPush('aaaaaaaa-1111-2222-3333-444444444444');
    assert.strictEqual(calls[0].init.headers.apikey, 'sb_secret_abc'); assert.ok(!('Authorization' in calls[0].init.headers));
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a.b.c';
  });

  await t('store: UUID vai para o Supabase, id do Firebase não toca no Supabase', async () => {
    assert.ok(store.isSb('aaaaaaaa-1111-2222-3333-444444444444')); assert.ok(!store.isSb('Ab3dEf6hIj9kLm2nOp5qRs8tUv1w'));
    rota = () => resp({ error: 'nao deveria' }, 500);
    await store.getPush('Ab3dEf6hIj9kLm2nOp5qRs8tUv1w').catch(() => {});   // vai para o Firestore (sem credencial aqui: falha, mas não no Supabase)
    assert.ok(calls.every(c => !c.url.includes('supabase.co')));
  });
  await t('store.listPush: se o Supabase falhar, quem está no Firebase continua sendo atendido', async () => {
    const g = require('../lib/google'), antes = g.fsList;
    g.fsList = async () => [{ id: 'fbuid', tokens: ['t'] }];
    rota = () => resp({}, 500);
    const l = await store.listPush(); g.fsList = antes;
    assert.deepStrictEqual(l.map(x => x.id), ['fbuid']);
  });
  await t('store.listPush junta os dois backends', async () => {
    const g = require('../lib/google'), antes = g.fsList;
    g.fsList = async () => [{ id: 'fbuid', tokens: ['t'] }];
    rota = () => resp([{ user_id: 'aaaaaaaa-1111-2222-3333-444444444444', tokens: ['z'], seen: [] }]);
    const l = await store.listPush(); g.fsList = antes;
    assert.deepStrictEqual(l.map(x => x.id), ['fbuid', 'aaaaaaaa-1111-2222-3333-444444444444']);
  });
  await t('store.getState: usuário Firebase lê users/{uid} (JSON); usuário Supabase usa load_all_for', async () => {
    const g = require('../lib/google'), antes = g.fsGet;
    g.fsGet = async p => p === 'users/fbuid' ? { data: JSON.stringify({ tx: [{ id: 1 }] }) } : null;
    assert.deepStrictEqual(await store.getState('fbuid'), { tx: [{ id: 1 }] }); g.fsGet = antes;
    rota = () => resp(M.toRows({ tx: [{ id: 7, type: 'in', amount: 1, desc: 'x', cat: 'Salário', date: '2026-11-01' }] }).tables);
    assert.strictEqual((await store.getState('aaaaaaaa-1111-2222-3333-444444444444')).tx[0].id, 7);
  });
  console.log(falhas ? 'FALHOU: ' + falhas + ' (de ' + (ok + falhas) + ')' : 'TUDO CERTO (' + ok + ' testes)');
  process.exit(falhas ? 1 : 0);
})();

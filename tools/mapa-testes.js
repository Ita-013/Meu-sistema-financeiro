#!/usr/bin/env node
// Testes de lib/mapa.js (conversão S <-> linhas do Supabase e diff incremental). Sem dependências, sem rede.
//
//   node tools/mapa-testes.js                       # usa um estado sintético (nenhum dado pessoal no repositório)
//   MAPA_REAL=caminho/estado.json node tools/mapa-testes.js   # roda também sobre um estado real (fica só na sua máquina)
//
// O que prova:
//   1. Estabilidade: S -> linhas -> S -> linhas devolve as MESMAS linhas (nada se perde nem muda a cada ida e volta).
//   2. Fidelidade: cada item que entrou volta com os mesmos campos (campos desconhecidos sobrevivem em "extra").
//   3. Diff: 300 rodadas de operações parecidas com as do app; applyDiff(diff(antes, depois), antes) == depois,
//      e uma alteração de 1 item gera exatamente 1 linha no diff.
'use strict';
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'lib', 'mapa.js'));

let falhas = 0, passou = 0;
const ok = (cond, msg, detalhe) => { if (cond) passou++; else { falhas++; console.log('  FALHOU: ' + msg + (detalhe ? '\n    ' + detalhe : '')) } };
const titulo = t => console.log('\n' + t);
const clone = o => JSON.parse(JSON.stringify(o));
const eq = (a, b) => M.stable(a) === M.stable(b);

// ---------- gerador determinístico (mesma semente = mesmo estado) ----------
function prng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } };
function fixture(seed, nTx) {
  const R = prng(seed), pick = a => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1)), cents = () => Math.round((5 + R() * 400) * 100) / 100;
  const mes = i => '2026-' + String(1 + i % 12).padStart(2, '0'), dia = () => String(int(1, 28)).padStart(2, '0');
  let id = 1700000000000;
  const S = { myname: 'Fulano', cards: [{ id: 7, name: 'Nubank', cl: 3, dd: 10, col: '#8a05be' }, { id: 8, name: 'Inter', cl: 20, dd: 27, pg: 'item-1', novoCampo: 1 }],
    cx: [{ id: 50, name: 'Viagem', emo: '✈️', target: 5000, mv: [{ id: 501, date: '2026-03-01', amt: 1000, note: 'Inicial' }, { id: 502, date: '2026-04-01', amt: -200.5, tx: 900 }] }, { id: 51, name: 'Reserva', target: 0, mv: [] }],
    tx: [], comp: [], cfix: [], fp: { '7|2026-10': { d: '2026-10-10', v: 1234.56 } }, sheet: [], rec: [], rules: {}, cats: { out: ['Mercado', 'Moradia', 'Saúde'], in: ['Salário'] },
    emo: { Mercado: '🛒' }, ord: { fx: ['Moradia'], vr: ['Mercado'] }, goal: { name: '', target: 0, saved: 0 }, bud: { Mercado: 800 }, budm: {},
    pgItems: [{ id: 'item-1', name: 'Inter' }], pgCred: { id: 'cid', enc: 'cifrado' }, lastCard: 8, lastBackup: '2026-11-10', ts: 1, cts: 2, sh: 'hash', mig: 1 };
  for (let i = 0; i < nTx; i++) {
    const m = mes(i), tx = { id: ++id, type: i % 6 ? 'out' : 'in', amount: cents(), desc: i % 5 ? 'Compra ' + i : "Padaria D'Ávila \"Pão\"; drop table x;--", cat: pick(['Mercado', 'Moradia', 'Saúde', 'Lazer']), date: m + '-' + dia() };
    if (i % 3) tx.pay = pick(['Pix', 'Dinheiro']);
    if (i % 4 === 0) { tx.pay = 'Cartão'; tx.card = pick([7, 8]); tx.pd = m + '-01' }
    if (i % 9 === 0) tx.sid = 77;
    if (i % 11 === 0) tx.res = [{ id: ++id, date: m + '-' + dia(), amt: Math.round(tx.amount * 20) / 100, who: 'Bia' }];
    if (i % 13 === 0) { tx.cx = 50; tx.cxm = 502; tx.gross = tx.amount + 10; tx.rid = 'uuid-' + i }
    if (i % 17 === 0) tx.campoDesconhecido = { x: [1, 2, 3] };
    S.tx.push(tx);
  }
  S.tx.push({ id: 900, type: 'out', amount: 209.97000000000003, desc: 'float', cat: 'Outros', date: '2026-04-02', cx: 50, cxm: 502 });
  for (let i = 0; i < 12; i++) S.comp.push({ id: ++id, n: 'Conta ' + i, v: cents(), c: 'Moradia', d: mes(i) + '-10', m: mes(i), st: pick(['a', 'g', 'i']), ...(i % 3 ? {} : { rep: 20, tx: 900, lk: 1 }) });
  S.cfix.push({ id: 20, n: 'Internet', v: 99.9, c: 'Moradia', day: 5, from: '2026-01' }, { id: 21, n: 'Academia', v: 80, c: 'Saúde', day: 0, from: '2026-01', to: '2026-06' });
  S.sheet.push({ id: 800, name: 'Mercado', cat: 'Mercado', v: { '2026-10': 800, '2026-11': 850.5 } }, { id: 801, name: 'Salário', k: 'in', v: { '2026-10': 5000 } },
    { id: 802, name: 'Parcela TV', cat: 'Casa', p: 1, sid: 77, v: { '2026-10': -300 } }, { id: 803, name: 'Viagem', cx: 50, v: {} });
  for (let i = 0; i < 20; i++) S.rec.push({ id: i % 2 ? 'uuid-r' + i : 'id-' + i, ...(i % 2 ? { pg: 1, pgchk: 1 } : {}), date: mes(i) + '-' + dia(), type: i % 3 ? 'out' : 'in', amount: cents(), desc: 'MOV ' + i,
    st: pick(['pend', 'ign', 'done']), kind: pick(['conta', 'fatura']), ...(i % 5 ? {} : { card: 7, ik: 2, inn: 10, tx: 900, lk: 1, dup: 1, why: 'x' }) });
  S.rules = { ifood: { cat: 'Lazer', pay: 'Cartão', card: 7 }, mercado: { cat: 'Mercado', pay: '' } };
  return S;
}

// ---------- comparação item a item (regras explícitas do que é "o mesmo dado") ----------
const LIGACOES = ['rep', 'tx', 'card', 'sid', 'cx', 'cxm', 'rid'];   // 0/''/null = sem vínculo
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      let c = canon(v[k]);
      if (LIGACOES.includes(k) && !c) continue;
      if (c === null || c === undefined || c === '' || c === false) continue;
      if (typeof c === 'object' && Object.keys(c).length === 0) continue;   // {} e [] equivalem a ausente
      o[k] = c;
    }
    return o;
  }
  if (v === true) return 1;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return v;
}
const comDefaults = {
  tx: t => ({ ...t, cat: t.cat || 'Outros', desc: t.desc || t.cat || 'Outros' }), cfix: t => ({ ...t, day: t.day || 0 }), cx: x => ({ ...x, name: x.name || 'Caixinha', target: x.target || 0 }),
  sheet: r => ({ ...r, k: r.k === 'in' ? 'in' : undefined }),   // o app só testa r.k==='in' (o importador dele faz a mesma normalização)
};

function testar(rotulo, S) {
  titulo('== ' + rotulo);
  const r = M.toRows(S);
  ok(!Object.keys(r.skipped).length, 'nenhum item descartado', JSON.stringify(r.skipped).slice(0, 200));
  const T1 = r.tables, S1 = M.fromRows(T1), T2 = M.toRows(S1).tables;

  // 1. estabilidade: as linhas não mudam depois de ida e volta
  const ordena = rows => rows.slice().sort((a, b) => M.stable(a) < M.stable(b) ? -1 : 1);   // a ordem das linhas não importa, o conteúdo sim
  for (const t of M.TABELAS) ok(eq(ordena(T1[t]), ordena(T2[t])), 'estável: ' + t, t + ': ' + T1[t].length + ' linhas antes, ' + T2[t].length + ' depois');
  ok(eq(M.fromRows(JSON.parse(JSON.stringify(T1))), S1), 'fromRows igual após serializar as linhas em JSON');

  // 2. fidelidade item a item (listas com id)
  for (const [lista, defs] of [['tx', comDefaults.tx], ['cards'], ['cx', comDefaults.cx], ['comp'], ['cfix', comDefaults.cfix], ['sheet', comDefaults.sheet], ['rec']]) {
    const volta = new Map(S1[lista].map(i => [String(i.id), i]));
    let n = 0, ruim = 0;
    for (const orig of S[lista] || []) {
      const v = volta.get(String(orig.id));
      if (!v) continue;                                   // descartado por ser inválido (já conferido acima)
      n++;
      const a = canon(defs ? defs(orig) : orig), b = canon(v);
      if (lista === 'cx' && a.mv) a.mv = a.mv.slice().sort((x, y) => x.id - y.id);   // fromRows devolve os movimentos por id
      if (!eq(a, b)) { ruim++; if (ruim <= 2) console.log('    diferença em ' + lista + ' id ' + orig.id + '\n      orig: ' + M.stable(a).slice(0, 220) + '\n      volta: ' + M.stable(b).slice(0, 220)) }
    }
    ok(ruim === 0 && n === (S[lista] || []).length, lista + ': ' + n + ' itens iguais na volta', ruim + ' com diferença; ' + n + ' de ' + (S[lista] || []).length + ' voltaram');
  }
  // mapas e configurações
  ok(eq(canon(S1.fp), canon(S.fp || {})), 'fp (faturas pagas) igual');
  ok(eq(canon(S1.rules), canon(S.rules || {})), 'rules iguais');
  const dedup = a => [...new Set((a || []).map(s => String(s).trim().slice(0, 40)))];
  if (S.cats) ok(eq(S1.cats, { out: dedup(S.cats.out), in: dedup(S.cats.in) }), 'categorias iguais (mesma ordem)');
  const chaves = Object.keys(S).filter(k => !['tx', 'cards', 'cx', 'comp', 'cfix', 'fp', 'sheet', 'cats', 'rules', 'rec', 'ts', 'cts', 'sh', 'app', 'version', 'exportedAt'].includes(k));
  // vazio e ausente equivalem ({} , '' e undefined): o app completa com blankS() ao carregar
  let cfgRuim = chaves.filter(k => !eq(canon({ v: S[k] }), canon({ v: S1[k] })));
  ok(!cfgRuim.length, 'configurações iguais (' + chaves.length + ' chaves)', 'diferem: ' + cfgRuim.join(', '));
  ok(!('ts' in S1) && !('cts' in S1) && !('sh' in S1), 'campos de sincronização do Firebase (ts/cts/sh) não vão para o banco');

  // informativo: a ordem original das listas é a ordem de id?
  const fora = ['tx', 'cards', 'cx', 'comp', 'cfix', 'sheet'].filter(l => (S[l] || []).some((x, i, a) => i && a[i - 1].id > x.id));
  console.log('  info: listas fora da ordem crescente de id (carregue com order by id): ' + (fora.join(', ') || 'nenhuma'));
  return S;
}

// ---------- diff: operações parecidas com as do app ----------
function testarDiff(S0, rodadas, seed) {
  titulo('== diff incremental (' + rodadas + ' rodadas)');
  const R = prng(seed), pick = a => a[Math.floor(R() * a.length)];
  const S = clone(S0); let uid = 1800000000000;
  const ops = [
    ['noop', () => 0],
    ['novo lançamento', () => { S.tx.push({ id: ++uid, type: 'out', amount: 12.34, desc: 'Novo', cat: 'Lazer', date: '2026-11-05', pay: 'Pix' }); return 1 }],
    ['editar valor', () => { const t = pick(S.tx); t.amount = Math.round((t.amount + 1) * 100) / 100; return 1 }],
    ['editar categoria', () => { const t = pick(S.tx); t.cat = t.cat === 'Lazer' ? 'Mercado' : 'Lazer'; return 1 }],
    ['excluir lançamento', () => { const t = pick(S.tx); const i = S.tx.indexOf(t); S.tx.splice(i, 1); return 1 + (t.res ? t.res.length : 0) }],
    ['ressarcimento novo', () => { const t = pick(S.tx); (t.res = t.res || []).push({ id: ++uid, date: t.date, amt: 1, who: 'Caio' }); return 1 }],
    ['plano da planilha', () => { const r = pick(S.sheet); r.v['2026-12'] = Math.round(R() * 1000) / 10; return 1 }],
    ['excluir mês do plano', () => { const r = pick(S.sheet.filter(r => Object.keys(r.v).length)); if (!r) return 0; delete r.v[Object.keys(r.v)[0]]; return 1 }],
    ['status do compromisso', () => { const c = pick(S.comp); c.st = c.st === 'g' ? 'a' : 'g'; return 1 }],
    ['novo recorrente', () => { S.cfix.push({ id: ++uid, n: 'Novo rec', v: 10, c: 'Moradia', day: 3, from: '2026-11' }); return 1 }],
    ['status da conciliação', () => { const x = pick(S.rec); x.st = x.st === 'done' ? 'pend' : 'done'; return 1 }],
    ['regra aprendida', () => { S.rules['k' + R()] = { cat: 'Lazer', pay: 'Pix' }; return 1 }],
    ['renomear categoria', () => { const i = S.cats.out.indexOf('Saúde'); if (i < 0) return 0; S.cats.out[i] = 'Saúde+'; return 2 }],   // some 1 + entra 1
    ['configuração', () => { S.myname = 'N' + Math.floor(R() * 99); return 1 }],
  ];
  let prev = M.toRows(S).tables, certos = 0;
  for (let i = 0; i < rodadas; i++) {
    const [nome, fn] = pick(ops);
    const esperado = fn();
    const next = M.toRows(S).tables, d = M.diff(prev, next);
    const aplicado = M.applyDiff(prev, d);
    const bate = M.TABELAS.every(t => eq(aplicado[t].slice().sort((a, b) => M.stable(a) < M.stable(b) ? -1 : 1), next[t].slice().sort((a, b) => M.stable(a) < M.stable(b) ? -1 : 1)));
    // renomear categoria: pode voltar ao nome antigo numa rodada seguinte; só exigimos o tamanho exato nas demais operações
    const tamanhoOk = nome === 'renomear categoria' || nome === 'excluir mês do plano' || d.n === esperado || (nome === 'configuração' && d.n <= 1);
    if (!bate || !tamanhoOk) ok(false, 'rodada ' + i + ' (' + nome + ')', 'aplicado==próximo: ' + bate + '; esperava ' + esperado + ' linha(s), diff tem ' + d.n);
    else certos++;
    prev = next;
  }
  ok(certos === rodadas, certos + ' de ' + rodadas + ' rodadas: aplicar o diff reproduz o estado novo e o tamanho do diff é o esperado');
  // desempenho: um estado grande precisa converter rápido (roda no celular)
  const grande = fixture(7, 5000); let t0 = Date.now(); const a = M.toRows(grande).tables; const tConv = Date.now() - t0;
  grande.tx[10].amount += 1; t0 = Date.now(); const b = M.toRows(grande).tables, d = M.diff(a, b); const tDiff = Date.now() - t0;
  ok(d.n === 1, 'estado de 5.000 lançamentos: 1 alteração = 1 linha no diff', 'n=' + d.n);
  console.log('  info: 5.000 lançamentos: toRows ' + tConv + ' ms; toRows + diff ' + tDiff + ' ms (neste computador)');
}

// ---------- execução ----------
testar('estado sintético (300 lançamentos)', fixture(42, 300));
testar('estado sintético pequeno', fixture(1, 5));
testar('estado vazio', { tx: [] });
if (process.env.MAPA_REAL) {
  let real = JSON.parse(fs.readFileSync(process.env.MAPA_REAL, 'utf8').replace(/^﻿/, ''));
  if (typeof real === 'string') real = JSON.parse(real);
  if (real && typeof real.data === 'string') real = JSON.parse(real.data);
  testar('estado real (' + path.basename(process.env.MAPA_REAL) + ')', real);
}
testarDiff(fixture(42, 300), 300, 2026);

console.log('\n' + (falhas ? 'FALHOU: ' + falhas + ' verificação(ões) com problema (' + passou + ' ok)' : 'TUDO CERTO: ' + passou + ' verificações'));
process.exit(falhas ? 1 : 0);

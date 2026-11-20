// Conversão entre o estado do app (S) e as linhas das tabelas do Supabase (tools/schema.sql).
//
//   toRows(S)        S -> { tables, skipped, warns, arredondados }   (valida; o que o banco recusaria NÃO entra)
//   fromRows(tables) linhas -> S                                      (o inverso; carregue cada tabela ordenada por id)
//   diff(a, b)       { upserts, deletes, n }  o que mudou entre dois conjuntos de linhas (envio incremental)
//   applyDiff(t, d)  aplica um diff sobre um conjunto de linhas (usado nos testes e para avançar o "último estado enviado")
//
// Cada linha é um objeto com os nomes de coluna do banco, SEM user_id (o banco preenche com auth.uid()).
// Funciona no Node (CommonJS) e no navegador (cole o conteúdo; sem dependências, sem rede).
//
// Ordem das listas: o app nunca reordena S.tx/S.cards/... (só push e filter; a ordem de exibição fica em S.ord),
// então a ordem de inserção = ordem crescente de id. Carregue com "order by id".
//
// Ordem de envio (chaves estrangeiras): upserts em TABELAS (pais antes dos filhos); deletes em TABELAS ao contrário.
(function (root) {
  'use strict';

  const PAYS = ['Pix', 'Dinheiro', 'Cartão'];
  const ST = { a: 'a_pagar', g: 'pago', i: 'ignorado' };
  const ST_INV = { a_pagar: 'a', pago: 'g', ignorado: 'i' };
  const RST = { pend: 'pendente', done: 'conciliada', ign: 'ignorada' };
  const RST_INV = { pendente: 'pend', conciliada: 'done', ignorada: 'ign' };

  const TABELAS = ['cards', 'cashboxes', 'cashbox_movements', 'transactions', 'tx_reimbursements', 'commitments', 'recurring_commitments',
    'invoice_payments', 'budget_rows', 'budget_plan', 'reconciliation', 'rules', 'categories', 'user_settings'];

  const PK = {
    cards: ['id'], cashboxes: ['id'], cashbox_movements: ['id'], transactions: ['id'], tx_reimbursements: ['tx_id', 'id'],
    commitments: ['id'], recurring_commitments: ['id'], invoice_payments: ['card_id', 'month'], budget_rows: ['id'],
    budget_plan: ['row_id', 'month'], reconciliation: ['id'], rules: ['key'], categories: ['kind', 'name'], user_settings: [],
  };

  // colunas de cada tabela, com o tipo SQL (o gerador de .sql precisa do tipo; o resto do código só usa o nome)
  const COLS = {
    cards: [['id', 'bigint'], ['name', 'text'], ['closing_day', 'smallint'], ['due_day', 'smallint'], ['pluggy_id', 'text'], ['color', 'text'], ['extra', 'jsonb']],
    cashboxes: [['id', 'bigint'], ['name', 'text'], ['emoji', 'text'], ['target', 'numeric'], ['extra', 'jsonb']],
    cashbox_movements: [['id', 'bigint'], ['cashbox_id', 'bigint'], ['date', 'date'], ['amount', 'numeric'], ['note', 'text'], ['tx_id', 'bigint'], ['extra', 'jsonb']],
    transactions: [['id', 'bigint'], ['type', 'text'], ['amount', 'numeric'], ['description', 'text'], ['category', 'text'], ['date', 'date'], ['purchase_date', 'date'],
      ['pay_method', 'text'], ['card_id', 'bigint'], ['installment_group', 'bigint'], ['cashbox_id', 'bigint'], ['cashbox_move_id', 'bigint'], ['gross', 'numeric'], ['rec_id', 'text'], ['extra', 'jsonb']],
    tx_reimbursements: [['tx_id', 'bigint'], ['id', 'bigint'], ['date', 'date'], ['amount', 'numeric'], ['who', 'text']],
    commitments: [['id', 'bigint'], ['name', 'text'], ['amount', 'numeric'], ['category', 'text'], ['due_date', 'date'], ['month', 'date'], ['status', 'text'],
      ['recurring_id', 'bigint'], ['tx_id', 'bigint'], ['linked', 'boolean'], ['extra', 'jsonb']],
    recurring_commitments: [['id', 'bigint'], ['name', 'text'], ['amount', 'numeric'], ['category', 'text'], ['day', 'smallint'], ['from_month', 'date'], ['to_month', 'date'], ['extra', 'jsonb']],
    invoice_payments: [['card_id', 'bigint'], ['month', 'date'], ['paid_on', 'date'], ['amount', 'numeric']],
    budget_rows: [['id', 'bigint'], ['name', 'text'], ['category', 'text'], ['kind', 'text'], ['is_parcel', 'boolean'], ['cashbox_id', 'bigint'], ['installment_group', 'bigint'], ['extra', 'jsonb']],
    budget_plan: [['row_id', 'bigint'], ['month', 'date'], ['planned', 'numeric']],
    reconciliation: [['id', 'text'], ['date', 'date'], ['type', 'text'], ['amount', 'numeric'], ['description', 'text'], ['status', 'text'], ['kind', 'text'], ['card_id', 'bigint'],
      ['installment_n', 'smallint'], ['installment_total', 'smallint'], ['counterparty', 'text'], ['bank', 'text'], ['bill_date', 'date'], ['is_duplicate', 'boolean'],
      ['reason', 'text'], ['new_description', 'text'], ['tx_id', 'bigint'], ['linked', 'boolean'], ['from_pluggy', 'boolean'], ['extra', 'jsonb']],
    rules: [['key', 'text'], ['category', 'text'], ['pay_method', 'text'], ['card_id', 'bigint']],
    categories: [['kind', 'text'], ['name', 'text'], ['position', 'smallint']],
    user_settings: [['my_name', 'text'], ['ord', 'jsonb'], ['emoji', 'jsonb'], ['goal', 'jsonb'], ['budget_legacy', 'jsonb'], ['pluggy', 'jsonb'], ['extra', 'jsonb']],
  };

  // ---------- utilitários ----------
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const num = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const text = (v, max) => { const s = String(v == null ? '' : v); return max ? s.slice(0, max) : s };
  const rest = (o, used) => { const e = {}; for (const k of Object.keys(o)) if (!used.includes(k) && o[k] !== undefined) e[k] = o[k]; return e };
  const intOrNull = v => Number.isFinite(num(v)) ? num(v) : null;

  // JSON com chaves ordenadas: compara linhas sem depender da ordem das chaves
  function stable(v) {
    if (v === undefined || v === null) return 'null';
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }

  // ---------- S -> linhas ----------
  function toRows(S) {
    S = obj(S);
    const skipped = {}, warns = [];
    let arredondados = 0;
    const skip = (t, msg) => (skipped[t] = skipped[t] || []).push(msg);
    const money = v => {
      const n = num(v);
      if (!Number.isFinite(n)) return NaN;
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) arredondados++;   // mais de 2 casas: não é só ruído de float
      return Math.round(n * 100) / 100;
    };
    const tables = {};
    for (const t of TABELAS) tables[t] = [];
    // monta a linha com todas as colunas na ordem de COLS (faltou = null)
    const add = (t, o) => { const r = {}; for (const [c] of COLS[t]) r[c] = o[c] === undefined ? null : o[c]; tables[t].push(r) };

    // cartões
    const cardIds = new Set();
    for (const c of arr(S.cards)) {
      const id = num(c && c.id);
      if (!c || !Number.isFinite(id) || !String(c.name || '').trim()) { skip('cards', 'sem id ou nome: ' + JSON.stringify(c).slice(0, 60)); continue }
      if (cardIds.has(id)) { skip('cards', 'id repetido ' + id); continue }
      cardIds.add(id);
      const cl = Number(c.cl), dd = Number(c.dd);
      add('cards', { id, name: text(c.name, 60).trim(), closing_day: cl >= 1 && cl <= 31 ? cl | 0 : null, due_day: dd >= 1 && dd <= 31 ? dd | 0 : null,
        pluggy_id: c.pg ? text(c.pg, 80) : null, color: /^#[0-9A-Fa-f]{6}$/.test(c.col || '') ? c.col.toUpperCase() : null, extra: rest(c, ['id', 'name', 'cl', 'dd', 'pg', 'col']) });
    }
    const cardOrNull = (v, onde) => { const n = num(v); if (!Number.isFinite(n)) return null; if (cardIds.has(n)) return n; warns.push(onde + ': cartão ' + n + ' não existe; vínculo removido'); return null };

    // caixinhas e movimentos
    const cxIds = new Set(), mvIds = new Set();
    for (const x of arr(S.cx)) {
      const id = num(x && x.id);
      if (!x || !Number.isFinite(id)) { skip('cashboxes', 'sem id'); continue }
      if (cxIds.has(id)) { skip('cashboxes', 'id repetido ' + id); continue }
      cxIds.add(id);
      const target = money(x.target);
      add('cashboxes', { id, name: text(x.name || 'Caixinha', 60), emoji: x.emo ? text(x.emo, 16) : null, target: target >= 0 ? target : 0, extra: rest(x, ['id', 'name', 'emo', 'target', 'mv']) });
      for (const m of arr(x.mv)) {
        const mid = num(m && m.id), amt = money(m && m.amt);
        if (!m || !Number.isFinite(mid) || !Number.isFinite(amt) || amt === 0 || !isDate(m.date)) { skip('cashbox_movements', 'caixinha ' + id + ', movimento ' + (m && m.id)); continue }
        if (mvIds.has(mid)) { skip('cashbox_movements', 'id repetido ' + mid); continue }
        mvIds.add(mid);
        add('cashbox_movements', { id: mid, cashbox_id: id, date: m.date, amount: amt, note: m.note ? text(m.note, 80) : null, tx_id: intOrNull(m.tx), extra: rest(m, ['id', 'date', 'amt', 'note', 'tx']) });
      }
    }
    const cxOrNull = (v, onde) => { const n = num(v); if (!Number.isFinite(n)) return null; if (cxIds.has(n)) return n; warns.push(onde + ': caixinha ' + n + ' não existe; vínculo removido'); return null };

    // lançamentos e ressarcimentos
    const txIds = new Set();
    for (const t of arr(S.tx)) {
      const id = num(t && t.id), amount = money(t && t.amount);
      if (!t || !Number.isFinite(id)) { skip('transactions', 'sem id'); continue }
      if (txIds.has(id)) { skip('transactions', 'id repetido ' + id); continue }
      if ((t.type !== 'in' && t.type !== 'out') || !(amount > 0) || !isDate(t.date)) { skip('transactions', `id ${id} (tipo=${t.type}, valor=${t.amount}, data=${t.date})`); continue }
      txIds.add(id);
      const gross = money(t.gross);
      add('transactions', { id, type: t.type, amount, description: text(t.desc || t.cat, 120), category: text(t.cat || 'Outros', 40), date: t.date,
        purchase_date: isDate(t.pd) ? t.pd : null, pay_method: PAYS.includes(t.pay) ? t.pay : null, card_id: cardOrNull(t.card, 'lançamento ' + id),
        installment_group: intOrNull(t.sid), cashbox_id: cxOrNull(t.cx, 'lançamento ' + id), cashbox_move_id: intOrNull(t.cxm), gross: gross > 0 ? gross : null,
        rec_id: t.rid != null && t.rid !== '' ? String(t.rid) : null,
        extra: rest(t, ['id', 'type', 'amount', 'desc', 'date', 'pd', 'pay', 'card', 'sid', 'cx', 'cxm', 'gross', 'rid', 'res', 'cat']) });
      const vistos = new Set();
      for (const r of arr(t.res)) {
        const rid = num(r && r.id), ramt = money(r && r.amt);
        if (!r || !Number.isFinite(rid) || !(ramt > 0) || vistos.has(rid)) { skip('tx_reimbursements', 'lançamento ' + id + ', ressarcimento ' + (r && r.id)); continue }
        vistos.add(rid);
        add('tx_reimbursements', { tx_id: id, id: rid, date: isDate(r.date) ? r.date : t.date, amount: ramt, who: text(r.who, 40) });
      }
    }

    // compromissos avulsos e recorrentes
    const compIds = new Set();
    for (const x of arr(S.comp)) {
      const id = num(x && x.id), v = money(x && x.v);
      if (!x || !Number.isFinite(id) || !(v >= 0) || !isMonth(x.m) || !String(x.n || '').trim()) { skip('commitments', 'id ' + (x && x.id) + ' (valor=' + (x && x.v) + ', mês=' + (x && x.m) + ')'); continue }
      if (compIds.has(id)) { skip('commitments', 'id repetido ' + id); continue }
      compIds.add(id);
      const rep = num(x.rep);
      add('commitments', { id, name: text(x.n, 120), amount: v, category: x.c ? text(x.c, 40) : null, due_date: isDate(x.d) ? x.d : null, month: x.m + '-01',
        status: ST[x.st] || 'a_pagar', recurring_id: Number.isFinite(rep) && rep !== 0 ? rep : null, tx_id: intOrNull(x.tx), linked: !!x.lk,
        extra: rest(x, ['id', 'n', 'v', 'c', 'd', 'm', 'st', 'rep', 'tx', 'lk']) });
    }
    const cfixIds = new Set();
    for (const t of arr(S.cfix)) {
      const id = num(t && t.id), v = money(t && t.v);
      if (!t || !Number.isFinite(id) || !(v >= 0) || !isMonth(t.from) || !String(t.n || '').trim()) { skip('recurring_commitments', 'id ' + (t && t.id)); continue }
      if (cfixIds.has(id)) { skip('recurring_commitments', 'id repetido ' + id); continue }
      cfixIds.add(id);
      const day = Number(t.day);
      add('recurring_commitments', { id, name: text(t.n, 120), amount: v, category: t.c ? text(t.c, 40) : null, day: day >= 0 && day <= 31 ? day | 0 : 0,
        from_month: t.from + '-01', to_month: isMonth(t.to) ? t.to + '-01' : null, extra: rest(t, ['id', 'n', 'v', 'c', 'day', 'from', 'to']) });
    }

    // faturas pagas (S.fp: 'cartão|mês' -> {d, v})
    for (const [k, f] of Object.entries(obj(S.fp))) {
      const [cid, mes] = k.split('|'), c = num(cid);
      if (!cardIds.has(c) || !isMonth(mes) || !f || !isDate(f.d)) { skip('invoice_payments', 'chave ' + k); continue }
      add('invoice_payments', { card_id: c, month: mes + '-01', paid_on: f.d, amount: Number.isFinite(money(f.v)) ? money(f.v) : 0 });
    }

    // planilha de orçamentos
    const rowIds = new Set();
    for (const r of arr(S.sheet)) {
      const id = num(r && r.id);
      if (!r || !Number.isFinite(id) || !String(r.name || '').trim()) { skip('budget_rows', 'id ' + (r && r.id)); continue }
      if (rowIds.has(id)) { skip('budget_rows', 'id repetido ' + id); continue }
      rowIds.add(id);
      add('budget_rows', { id, name: text(r.name, 60), category: r.cat ? text(r.cat, 40) : null, kind: r.k === 'in' ? 'in' : 'out', is_parcel: !!r.p,
        cashbox_id: cxOrNull(r.cx, 'planilha ' + id), installment_group: intOrNull(r.sid), extra: rest(r, ['id', 'name', 'cat', 'k', 'p', 'cx', 'sid', 'v']) });
      for (const [mes, val] of Object.entries(obj(r.v))) {
        const p = money(val);
        if (!isMonth(mes) || !Number.isFinite(p)) { skip('budget_plan', 'linha ' + id + ', mês ' + mes); continue }
        add('budget_plan', { row_id: id, month: mes + '-01', planned: p });
      }
    }

    // conciliação
    const recIds = new Set();
    for (const x of arr(S.rec)) {
      const id = x && x.id != null ? String(x.id) : '', amount = money(x && x.amount);
      if (!x || !id || (x.type !== 'in' && x.type !== 'out') || !(amount > 0) || !isDate(x.date)) { skip('reconciliation', 'id ' + (x && x.id) + ' (valor=' + (x && x.amount) + ', data=' + (x && x.date) + ')'); continue }
      if (recIds.has(id)) { skip('reconciliation', 'id repetido ' + id); continue }
      recIds.add(id);
      const ik = Number(x.ik), inn = Number(x.inn);
      add('reconciliation', { id, date: x.date, type: x.type, amount, description: text(x.desc, 160), status: RST[x.st] || 'pendente',
        kind: x.kind === 'conta' || x.kind === 'fatura' ? x.kind : null, card_id: cardOrNull(x.card, 'conciliação ' + id), installment_n: ik > 0 ? ik | 0 : null,
        installment_total: inn > 0 ? inn | 0 : null, counterparty: x.cp ? text(x.cp, 80) : null, bank: x.bk ? text(x.bk, 60) : null, bill_date: isDate(x.bd) ? x.bd : null,
        is_duplicate: !!x.dup, reason: x.why ? text(x.why, 200) : null, new_description: x.nd ? text(x.nd, 160) : null, tx_id: intOrNull(x.tx), linked: !!x.lk, from_pluggy: !!x.pg,
        extra: rest(x, ['id', 'date', 'type', 'amount', 'desc', 'st', 'kind', 'card', 'ik', 'inn', 'cp', 'bk', 'bd', 'dup', 'why', 'nd', 'tx', 'lk', 'pg']) });
    }

    // regras e categorias
    for (const [k, r] of Object.entries(obj(S.rules))) {
      if (!k || k.length > 80 || !r || typeof r.cat !== 'string' || !r.cat) { skip('rules', 'chave ' + k.slice(0, 40)); continue }
      add('rules', { key: k, category: text(r.cat, 40), pay_method: PAYS.includes(r.pay) ? r.pay : null, card_id: cardOrNull(r.card, 'regra ' + k.slice(0, 30)) });
    }
    for (const kind of ['out', 'in']) {
      const vistos = new Set();
      arr(obj(S.cats)[kind]).forEach(n => { if (typeof n === 'string' && n.trim() && !vistos.has(n.trim().slice(0, 40))) { const nm = n.trim().slice(0, 40); vistos.add(nm); add('categories', { kind, name: nm, position: vistos.size - 1 }) } });
    }

    // configurações (o que não é lista)
    const tratados = ['tx', 'cards', 'cx', 'comp', 'cfix', 'fp', 'sheet', 'cats', 'rules', 'rec', 'myname', 'ord', 'emo', 'goal', 'bud', 'budm',
      'pgItems', 'pgCred', 'pgHook', 'ts', 'cts', 'sh', 'app', 'version', 'exportedAt'];   // ts/cts/sh: controle de sincronização do Firebase
    const pluggy = ['pgItems', 'pgCred', 'pgHook'].reduce((o, k) => (S[k] !== undefined ? (o[k] = S[k], o) : o), {});
    const legado = (Object.keys(obj(S.bud)).length || Object.keys(obj(S.budm)).length) ? { bud: obj(S.bud), budm: obj(S.budm) } : null;
    add('user_settings', { my_name: S.myname ? text(S.myname, 60) : null, ord: Object.keys(obj(S.ord)).length ? S.ord : { fx: [], vr: [] }, emoji: obj(S.emo),
      goal: S.goal && typeof S.goal === 'object' ? S.goal : null, budget_legacy: legado, pluggy: Object.keys(pluggy).length ? pluggy : null, extra: rest(S, tratados) });

    return { tables, skipped, warns, arredondados };
  }

  // ---------- linhas -> S ----------
  // Só campos que existem entram (null = campo ausente). Marcas booleanas voltam como 1 (o app usa só a veracidade).
  function fromRows(T) {
    T = T || {};
    const L = n => (Array.isArray(T[n]) ? T[n] : []).slice().sort((a, b) => (a.id > b.id) - (a.id < b.id));
    const put = (o, k, v) => { if (v !== null && v !== undefined) o[k] = v; return o };
    const flag = (o, k, v) => { if (v) o[k] = 1; return o };
    const S = {};

    S.cards = L('cards').map(r => { const o = Object.assign({}, r.extra, { id: r.id, name: r.name }); put(o, 'cl', r.closing_day); put(o, 'dd', r.due_day); put(o, 'pg', r.pluggy_id); put(o, 'col', r.color); return o });

    const mv = {};
    for (const m of L('cashbox_movements')) { const o = Object.assign({}, m.extra, { id: m.id, date: m.date, amt: m.amount }); put(o, 'note', m.note); put(o, 'tx', m.tx_id); (mv[m.cashbox_id] = mv[m.cashbox_id] || []).push(o) }
    S.cx = L('cashboxes').map(r => { const o = Object.assign({}, r.extra, { id: r.id, name: r.name, target: r.target, mv: mv[r.id] || [] }); put(o, 'emo', r.emoji); return o });

    const res = {};
    for (const r of (T.tx_reimbursements || []).slice().sort((a, b) => a.id - b.id)) (res[r.tx_id] = res[r.tx_id] || []).push({ id: r.id, date: r.date, amt: r.amount, who: r.who });
    S.tx = L('transactions').map(r => {
      const o = Object.assign({}, r.extra, { id: r.id, type: r.type, amount: r.amount, desc: r.description, cat: r.category, date: r.date });
      put(o, 'pd', r.purchase_date); put(o, 'pay', r.pay_method); put(o, 'card', r.card_id); put(o, 'sid', r.installment_group); put(o, 'cx', r.cashbox_id);
      put(o, 'cxm', r.cashbox_move_id); put(o, 'gross', r.gross); put(o, 'rid', r.rec_id);
      if (res[r.id]) o.res = res[r.id];
      return o;
    });

    S.comp = L('commitments').map(r => {
      const o = Object.assign({}, r.extra, { id: r.id, n: r.name, v: r.amount, m: r.month.slice(0, 7), st: ST_INV[r.status] || 'a' });
      put(o, 'c', r.category); put(o, 'd', r.due_date); if (r.recurring_id !== null && r.recurring_id !== undefined) o.rep = r.recurring_id; put(o, 'tx', r.tx_id); flag(o, 'lk', r.linked);
      return o;
    });
    S.cfix = L('recurring_commitments').map(r => { const o = Object.assign({}, r.extra, { id: r.id, n: r.name, v: r.amount, day: r.day, from: r.from_month.slice(0, 7) }); put(o, 'c', r.category); if (r.to_month) o.to = r.to_month.slice(0, 7); return o });

    S.fp = {};
    for (const r of T.invoice_payments || []) S.fp[r.card_id + '|' + r.month.slice(0, 7)] = { d: r.paid_on, v: r.amount };

    const plan = {};
    for (const p of T.budget_plan || []) (plan[p.row_id] = plan[p.row_id] || {})[p.month.slice(0, 7)] = p.planned;
    S.sheet = L('budget_rows').map(r => {
      const o = Object.assign({}, r.extra, { id: r.id, name: r.name, v: plan[r.id] || {} });
      put(o, 'cat', r.category); if (r.kind === 'in') o.k = 'in'; flag(o, 'p', r.is_parcel); put(o, 'cx', r.cashbox_id); put(o, 'sid', r.installment_group);
      return o;
    });

    S.rec = L('reconciliation').map(r => {
      const o = Object.assign({}, r.extra, { id: r.id, date: r.date, type: r.type, amount: r.amount, desc: r.description, st: RST_INV[r.status] || 'pend' });
      put(o, 'kind', r.kind); put(o, 'card', r.card_id); put(o, 'ik', r.installment_n); put(o, 'inn', r.installment_total); put(o, 'cp', r.counterparty); put(o, 'bk', r.bank);
      put(o, 'bd', r.bill_date); flag(o, 'dup', r.is_duplicate); put(o, 'why', r.reason); put(o, 'nd', r.new_description); put(o, 'tx', r.tx_id); flag(o, 'lk', r.linked); flag(o, 'pg', r.from_pluggy);
      return o;
    });

    S.rules = {};
    for (const r of T.rules || []) { const o = { cat: r.category }; put(o, 'pay', r.pay_method); put(o, 'card', r.card_id); S.rules[r.key] = o }

    const cs = (T.categories || []).slice().sort((a, b) => a.position - b.position);
    S.cats = cs.length ? { out: cs.filter(c => c.kind === 'out').map(c => c.name), in: cs.filter(c => c.kind === 'in').map(c => c.name) } : null;

    const cfg = (T.user_settings || [])[0];
    if (cfg) {
      Object.assign(S, cfg.extra);
      put(S, 'myname', cfg.my_name); S.ord = cfg.ord || { fx: [], vr: [] }; S.emo = cfg.emoji || {}; put(S, 'goal', cfg.goal);
      if (cfg.budget_legacy) { S.bud = cfg.budget_legacy.bud || {}; S.budm = cfg.budget_legacy.budm || {} }
      if (cfg.pluggy) Object.assign(S, cfg.pluggy);
    }
    return S;
  }

  // ---------- diferença entre dois conjuntos de linhas ----------
  const keyOf = (t, r) => PK[t].length ? PK[t].map(c => String(r[c])).join('|') : 'unica';
  const index = (rows, t) => { const m = new Map(); for (const r of rows || []) m.set(keyOf(t, r), r); return m };
  const pick = (r, cols) => { const o = {}; for (const c of cols) o[c] = r[c]; return o };

  function diff(prev, next) {
    prev = prev || {}; next = next || {};
    const upserts = {}, deletes = {}; let n = 0;
    for (const t of TABELAS) {
      const a = index(prev[t], t), b = index(next[t], t);
      for (const [k, r] of b) { const o = a.get(k); if (!o || stable(o) !== stable(r)) { (upserts[t] = upserts[t] || []).push(r); n++ } }
      for (const [k, r] of a) if (!b.has(k)) { (deletes[t] = deletes[t] || []).push(PK[t].length ? pick(r, PK[t]) : {}); n++ }
    }
    return { upserts, deletes, n };
  }

  function applyDiff(tables, d) {
    const out = {};
    for (const t of TABELAS) {
      const m = index(tables && tables[t], t);
      for (const r of (d.deletes && d.deletes[t]) || []) m.delete(keyOf(t, r));
      for (const r of (d.upserts && d.upserts[t]) || []) m.set(keyOf(t, r), r);
      out[t] = [...m.values()];
    }
    return out;
  }

  const api = { TABELAS, PK, COLS, toRows, fromRows, diff, applyDiff, stable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Mapa = api;
})(typeof window !== 'undefined' ? window : this);

// O que avisar no dia: contas vencidas, contas que vencem hoje e movimentações para conciliar.
// As regras são as mesmas do app (index.html: occ, fatOcc, lateOld, isLate e reconcileComp), portadas para o servidor.
// Se mudar essas regras no app, mude aqui também.

const pad = n => String(n).padStart(2, '0');
const dim = mm => new Date(+mm.slice(0, 4), +mm.slice(5, 7), 0).getDate();
const cdt = (mm, day) => day ? mm + '-' + pad(Math.min(day, dim(mm))) : '';
const addM = (k, d) => { const [y, mo] = k.split('-').map(Number), t = new Date(y, mo - 1 + d, 1); return t.getFullYear() + '-' + pad(t.getMonth() + 1); };

// hoje no horário de Brasília (o servidor roda em UTC)
const hoje = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);

function fatOcc(S, mm, cur) {
  const out = [];
  if (mm < addM(cur, -1)) return out;
  S.cards.forEach(c => {
    if (!(c.cl && c.dd)) return;
    const F = Math.round(S.tx.filter(t => t.card === c.id && t.type === 'out' && String(t.date).slice(0, 7) === mm).reduce((a, t) => a + t.amount, 0) * 100) / 100;
    if (F <= 0) return;
    const p = S.fp && S.fp[c.id + '|' + mm];
    out.push({ id: 'f' + c.id + '@' + mm, n: 'Fatura ' + c.name, v: F, c: 'Cartão', d: cdt(mm, c.dd), m: mm, st: p ? 'g' : 'a', fat: c.id, virt: 1 });
  });
  return out;
}

function occ(S, mm, cur) {
  const r = S.comp.filter(x => x.m === mm);
  S.cfix.forEach(t => {
    if (t.from <= mm && (!t.to || mm <= t.to) && !S.comp.some(x => x.rep === t.id && x.m === mm))
      r.push({ id: 'v' + t.id + '@' + mm, n: t.n, v: t.v, c: t.c, d: cdt(mm, t.day), m: mm, st: 'a', rep: t.id, virt: 1 });
  });
  fatOcc(S, mm, cur).forEach(x => r.push(x));
  return r;
}

const isLate = (x, t) => x.st === 'a' && x.d && x.d < t;

function lateOld(S, cur, t) {
  const ms = [...S.comp.map(x => x.m), ...S.cfix.map(x => x.from), addM(cur, -1)].filter(k => k < cur).sort();
  if (!ms.length) return [];
  const out = [];
  for (let k = ms[0]; k < cur; k = addM(k, 1)) occ(S, k, cur).forEach(x => { if (isLate(x, t)) out.push(x); });
  return out;
}

// S = estado do app (já convertido de JSON); t = 'AAAA-MM-DD' (hoje em Brasília)
function compute(S, t) {
  S.comp = S.comp || []; S.cfix = S.cfix || []; S.cards = S.cards || []; S.tx = S.tx || []; S.rec = S.rec || [];
  // compromisso pago cujo lançamento sumiu volta para "a pagar" (reconcileComp do app)
  const ids = new Set(S.tx.map(x => x.id));
  S.comp.forEach(x => { if (x.st === 'g' && x.tx && !ids.has(x.tx)) x.st = 'a'; });
  const cur = t.slice(0, 7), seen = new Set();
  const late = [...lateOld(S, cur, t), ...occ(S, cur, cur).filter(x => isLate(x, t))].filter(x => !seen.has(x.id) && seen.add(x.id));
  const due = occ(S, cur, cur).filter(x => x.st === 'a' && x.d === t);
  const pend = S.rec.filter(x => x.st === 'pend').length;
  return { late, due, pend };
}

const brl = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const lst = a => a.slice(0, 3).map(x => x.n + ' (' + brl(x.v) + ')').join(', ') + (a.length > 3 ? ' e mais ' + (a.length - 3) : '');

// mesmas frases do aviso local do app; `novas` = movimentações do banco que o app ainda não importou
function linhas(r, novas, bankErr) {
  const l = [], conc = r.pend + (novas || 0);
  if (r.late.length) l.push((r.late.length === 1 ? 'Atrasada: ' : 'Atrasadas (' + r.late.length + '): ') + lst(r.late));
  if (r.due.length) l.push('Vence hoje: ' + lst(r.due));
  if (conc) l.push(conc + (conc === 1 ? ' movimentação para conciliar' : ' movimentações para conciliar'));
  if (bankErr) l.push('Não consegui consultar o banco hoje.');
  return l;
}

module.exports = { compute, linhas, hoje, addM };

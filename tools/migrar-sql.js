#!/usr/bin/env node
// Meu Caixa: converte o estado do app (S) em um arquivo .sql com INSERTs para as tabelas do tools/schema.sql.
// A conversão em si (validação, nomes de coluna, códigos) mora em lib/mapa.js; aqui só se gera o SQL.
//
// Uso:
//   node tools/migrar-sql.js ENTRADA.json seu@email.com [--substituir] [--saida dados-supabase.sql]
//
// ENTRADA.json pode ser:
//   - o estado completo (no navegador, com o app aberto: F12 > Console > copy(localStorage['caixa-v1']));
//   - o arquivo de backup baixado pelo app (aba ⚙; não leva a conciliação nem os bancos);
//   - o documento users/{uid} do Firestore ({"data":"...","updatedAt":...}), ou só o valor do campo "data"
//     copiado do console do Firebase (Firestore > users > seu uid > campo data), com ou sem as aspas externas.
// O e-mail é o do usuário criado em Supabase > Authentication > Users (não o da conta do painel).
//
// O arquivo gerado é colado no Supabase > SQL Editor. Ele:
//   - recusa rodar se o usuário já tiver dados (a menos que você use --substituir, que apaga e recarrega);
//   - termina com uma conferência de contagens, que deve bater com o resumo impresso aqui.
// Linhas inválidas (data impossível, valor <= 0, id repetido...) NÃO entram: ficam listadas no resumo.
//
// ATENÇÃO: o .sql tem os seus dados financeiros. Não commite, não compartilhe. Sem dependências, sem rede.
'use strict';
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'lib', 'mapa.js'));

// ---------- argumentos ----------
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined };
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--saida');
const [arquivo, email] = pos;
const saida = opt('saida') || 'dados-supabase.sql';
const die = m => { console.error('Erro: ' + m); process.exit(1) };
if (!arquivo || !email) die('uso: node tools/migrar-sql.js ENTRADA.json seu@email.com [--substituir] [--saida arquivo.sql]');
if (!/^[^\s'"\\;]+@[^\s'"\\;]+\.[^\s'"\\;]+$/.test(email)) die('e-mail inválido: ' + email);

let S;
try {
  S = JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, ''));
  if (typeof S === 'string') S = JSON.parse(S);                   // texto copiado do console do Firebase, com aspas e escapes
  if (S && typeof S.data === 'string') S = JSON.parse(S.data);   // documento do Firestore
} catch (e) { die('não consegui ler o JSON de entrada (' + e.message + ')') }
if (!S || typeof S !== 'object' || !Array.isArray(S.tx)) die('isto não parece um estado do Meu Caixa (falta a lista "tx").');

const { tables, skipped, warns, arredondados } = M.toRows(S);

// ---------- literais SQL tipados: o VALUES precisa de tipos certos mesmo quando a coluna inteira é null ----------
const q = s => "'" + String(s).replace(/\u0000/g, '').replace(/'/g, "''") + "'";
function lit(v, t) {
  if (v === null || v === undefined) return 'null::' + t;
  switch (t) {
    case 'bigint': case 'smallint': return Math.trunc(v) + '::' + t;
    case 'numeric': return v.toFixed(2) + '::numeric';
    case 'date': return q(v) + '::date';
    case 'boolean': return (v ? 'true' : 'false') + '::boolean';
    case 'jsonb': return q(JSON.stringify(v)) + '::jsonb';
    default: return q(v) + '::text';
  }
}
const out = [];
function insert(tabela, rows) {
  const cols = M.COLS[tabela], nomes = cols.map(c => c[0]).join(', ');
  for (let i = 0; i < rows.length; i += 200) {
    const corpo = rows.slice(i, i + 200).map(r => '(' + cols.map(([c, t]) => lit(r[c], t)).join(', ') + ')').join(',\n  ');
    out.push(`insert into public.${tabela} (user_id, ${nomes})\nselect (select id from _u), * from (values\n  ${corpo}\n) as v(${nomes});`);
  }
}

// ---------- monta o .sql (a ordem de M.TABELAS respeita as chaves estrangeiras) ----------
out.push(`-- Gerado por tools/migrar-sql.js em ${new Date().toISOString()} para ${email}
-- Cole no Supabase > SQL Editor > Run. Contém dados financeiros: não commite nem compartilhe.
create temp table _u as select id from auth.users where lower(email) = lower(${q(email)});

do $$ begin
  if not exists (select 1 from _u) then
    raise exception 'Usuário % não encontrado. Crie em Authentication > Users (Add user) com este e-mail.', ${q(email)};
  end if;
end $$;
`);
if (flag('substituir')) {
  out.push('-- --substituir: apaga os dados deste usuário nas tabelas abaixo antes de recarregar');
  for (const t of ['tx_reimbursements', 'transactions', 'commitments', 'recurring_commitments', 'invoice_payments', 'cashbox_movements', 'budget_plan',
    'budget_rows', 'reconciliation', 'rules', 'categories', 'cashboxes', 'cards', 'user_settings'])
    out.push(`delete from public.${t} where user_id = (select id from _u);`);
} else {
  out.push(`do $$ begin
  if exists (select 1 from public.transactions where user_id = (select id from _u))
  or exists (select 1 from public.cards where user_id = (select id from _u))
  or exists (select 1 from public.cashboxes where user_id = (select id from _u))
  or exists (select 1 from public.commitments where user_id = (select id from _u))
  or exists (select 1 from public.budget_rows where user_id = (select id from _u))
  or exists (select 1 from public.reconciliation where user_id = (select id from _u))
  or exists (select 1 from public.user_settings where user_id = (select id from _u)) then
    raise exception 'Este usuário já tem dados. Nada foi alterado. Para apagar e recarregar, gere o arquivo de novo com --substituir.';
  end if;
end $$;`);
}
out.push('');
for (const t of M.TABELAS) if (tables[t].length) insert(t, tables[t]);

out.push('\n-- CONFERÊNCIA: compare com o resumo impresso pelo script');
out.push(M.TABELAS.map(t => `select '${t}' as tabela, count(*) as linhas from public.${t} where user_id = (select id from _u)`).join('\nunion all\n') + '\norder by 1;');
fs.writeFileSync(saida, out.join('\n') + '\n', 'utf8');

// ---------- resumo ----------
const soma = (a, c) => a.reduce((s, r) => s + r[c], 0);
const tx = tables.transactions;
console.log('\nArquivo gerado: ' + saida + ' (' + (fs.statSync(saida).size / 1024).toFixed(0) + ' KB)');
console.log('\nLinhas por tabela (a conferência no fim do SQL deve mostrar os mesmos números):');
for (const t of M.TABELAS) console.log('  ' + t.padEnd(24) + String(tables[t].length).padStart(6));
console.log('\nTotais para conferir depois (soma de transactions.amount):');
console.log('  receitas: ' + soma(tx.filter(r => r.type === 'in'), 'amount').toFixed(2) + ' | despesas: ' + soma(tx.filter(r => r.type === 'out'), 'amount').toFixed(2));
if (arredondados) console.log('\nAviso: ' + arredondados + ' valor(es) tinham mais de 2 casas decimais e foram arredondados para centavos.');
const nSkip = Object.values(skipped).reduce((s, a) => s + a.length, 0);
if (nSkip) {
  console.log('\nATENÇÃO: ' + nSkip + ' item(ns) NÃO entraram (dado inválido para o banco):');
  for (const [t, l] of Object.entries(skipped)) { console.log('  ' + t + ': ' + l.length); l.slice(0, 10).forEach(m => console.log('    - ' + m)); if (l.length > 10) console.log('    ... e mais ' + (l.length - 10)) }
} else console.log('\nNenhum item descartado.');
if (warns.length) { console.log('\nVínculos removidos (' + warns.length + '):'); warns.slice(0, 10).forEach(m => console.log('  - ' + m)); if (warns.length > 10) console.log('  ... e mais ' + (warns.length - 10)) }

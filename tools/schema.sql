-- =====================================================================
-- Meu Caixa: esquema relacional (Postgres / Supabase)
--
-- Como usar: Supabase > SQL Editor > cole este arquivo inteiro > Run.
-- Pode rodar de novo sem medo: usa "if not exists" e recria as policies.
-- NÃO contém dados nem segredos: só a estrutura.
--
-- Ideia central (multiusuário): UMA tabela por tipo de dado, compartilhada
-- por todos, com a coluna user_id. O Row Level Security (RLS) faz o banco
-- acrescentar "user_id = quem está logado" em toda consulta.
--
-- Chaves: os ids do app já são números gerados no navegador (uid(), em ms).
-- Por isso a chave primária é (user_id, id): o id antigo é preservado e as
-- referências entre tabelas (card, cx, sid...) continuam valendo sem mapa.
--
-- Cada tabela tem a coluna "extra jsonb": guarda campos que o app tenha e
-- que não viraram coluna, para a migração não perder nada.
--
-- Códigos do app -> valores legíveis (a migração converte):
--   comp.st:  a -> a_pagar | g -> pago | i -> ignorado
--   rec.st:   pend -> pendente | done -> conciliada | ign -> ignorada
--   rec.kind: conta | fatura (igual)
--   meses 'YYYY-MM' -> date no dia 1 (ex.: '2026-10' -> 2026-10-01)
--   pay '' (vazio) -> null
-- =====================================================================

-- ---------- cartões (S.cards) ----------
create table if not exists public.cards (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          bigint not null,
  name        text not null,
  closing_day smallint check (closing_day between 1 and 31),   -- cl
  due_day     smallint check (due_day between 1 and 31),       -- dd
  pluggy_id   text,                                            -- pg
  color       text check (color ~ '^#[0-9A-F]{6}$'),           -- col
  extra       jsonb not null default '{}',
  primary key (user_id, id)
);

-- ---------- caixinhas (S.cx) e seus movimentos (S.cx[].mv) ----------
create table if not exists public.cashboxes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id      bigint not null,
  name    text not null,
  emoji   text,
  target  numeric(12,2) not null default 0 check (target >= 0),
  extra   jsonb not null default '{}',
  primary key (user_id, id)
);

create table if not exists public.cashbox_movements (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         bigint not null,
  cashbox_id bigint not null,
  date       date not null,
  amount     numeric(12,2) not null check (amount <> 0),       -- amt: negativo = retirada
  note       text,
  tx_id      bigint,                                           -- lançamento espelho (tx)
  extra      jsonb not null default '{}',
  primary key (user_id, id),
  foreign key (user_id, cashbox_id) references public.cashboxes (user_id, id) on delete cascade
);

-- ---------- lançamentos (S.tx) ----------
create table if not exists public.transactions (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                bigint not null,
  type              text not null check (type in ('in','out')),
  amount            numeric(12,2) not null check (amount > 0),
  description       text not null default '',                  -- desc
  category          text not null default 'Outros',            -- cat
  date              date not null,   -- cartão: vencimento da fatura (define o mês); senão, a data do pagamento
  purchase_date     date,            -- pd: data da compra (cartão)
  pay_method        text check (pay_method in ('Pix','Dinheiro','Cartão')),   -- pay
  card_id           bigint,
  installment_group bigint,          -- sid: agrupa as parcelas de uma compra
  cashbox_id        bigint,          -- cx
  cashbox_move_id   bigint,          -- cxm
  gross             numeric(12,2) check (gross > 0),           -- valor antes dos ressarcimentos
  rec_id            text,            -- rid: id da conciliação que originou (sem FK de propósito)
  extra             jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, card_id)    references public.cards (user_id, id)     on delete set null (card_id),
  foreign key (user_id, cashbox_id) references public.cashboxes (user_id, id) on delete set null (cashbox_id)
);
create index if not exists transactions_user_date_idx  on public.transactions (user_id, date);
create index if not exists transactions_user_cat_idx   on public.transactions (user_id, category, date);
create index if not exists transactions_user_card_idx  on public.transactions (user_id, card_id) where card_id is not null;
create index if not exists transactions_user_inst_idx  on public.transactions (user_id, installment_group) where installment_group is not null;

-- ressarcimentos de um lançamento (S.tx[].res): quem devolveu parte do valor
create table if not exists public.tx_reimbursements (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tx_id   bigint not null,
  id      bigint not null,
  date    date not null,
  amount  numeric(12,2) not null check (amount > 0),           -- amt
  who     text not null default '',
  primary key (user_id, tx_id, id),
  foreign key (user_id, tx_id) references public.transactions (user_id, id) on delete cascade
);

-- ---------- compromissos avulsos (S.comp) ----------
-- Só as linhas REAIS. As ocorrências virtuais (recorrentes do mês e faturas
-- de cartão, ids 'v...@mês' e 'f...@mês') o app calcula; não são gravadas.
create table if not exists public.commitments (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id           bigint not null,
  name         text not null,                                  -- n
  amount       numeric(12,2) not null check (amount >= 0),     -- v
  category     text,                                           -- c
  due_date     date,                                           -- d (vencimento, opcional)
  month        date not null check (extract(day from month) = 1),   -- m
  status       text not null default 'a_pagar' check (status in ('a_pagar','pago','ignorado')),
  recurring_id bigint,                                         -- rep: veio de um recorrente (null = avulso)
  tx_id        bigint,                                         -- lançamento que pagou
  linked       boolean not null default false,                 -- lk
  extra        jsonb not null default '{}',
  primary key (user_id, id)
);
create index if not exists commitments_user_month_idx on public.commitments (user_id, month);

-- compromissos recorrentes (S.cfix)
create table if not exists public.recurring_commitments (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         bigint not null,
  name       text not null,
  amount     numeric(12,2) not null check (amount >= 0),
  category   text,
  day        smallint not null default 0 check (day between 0 and 31),   -- 0 = sem vencimento
  from_month date not null check (extract(day from from_month) = 1),
  to_month   date check (extract(day from to_month) = 1),
  extra      jsonb not null default '{}',
  primary key (user_id, id)
);

-- fatura de cartão paga (S.fp: chave 'cartão|mês' -> {d, v})
create table if not exists public.invoice_payments (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id bigint not null,
  month   date not null check (extract(day from month) = 1),
  paid_on date not null,
  amount  numeric(12,2) not null default 0,
  primary key (user_id, card_id, month),
  foreign key (user_id, card_id) references public.cards (user_id, id) on delete cascade
);

-- ---------- planilha de orçamentos (S.sheet) ----------
create table if not exists public.budget_rows (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                bigint not null,
  name              text not null,
  category          text,                                      -- cat
  kind              text not null default 'out' check (kind in ('in','out')),   -- k
  is_parcel         boolean not null default false,            -- p (inferido: linha de parcelamento; confirmar)
  cashbox_id        bigint,                                    -- cx
  installment_group bigint,                                    -- sid
  extra             jsonb not null default '{}',
  primary key (user_id, id),
  foreign key (user_id, cashbox_id) references public.cashboxes (user_id, id) on delete set null (cashbox_id)
);

-- o mapa S.sheet[].v ({'2026-10': 120.5}) vira uma linha por (linha, mês)
create table if not exists public.budget_plan (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  row_id  bigint not null,
  month   date not null check (extract(day from month) = 1),
  planned numeric(12,2) not null,
  primary key (user_id, row_id, month),
  foreign key (user_id, row_id) references public.budget_rows (user_id, id) on delete cascade
);

-- ---------- conciliação (S.rec) ----------
create table if not exists public.reconciliation (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id                text not null,                             -- id do Pluggy (texto) ou gerado na importação
  date              date not null,
  type              text not null check (type in ('in','out')),
  amount            numeric(12,2) not null check (amount > 0),
  description       text not null default '',                  -- desc
  status            text not null default 'pendente' check (status in ('pendente','conciliada','ignorada')),
  kind              text check (kind in ('conta','fatura')),
  card_id           bigint,
  installment_n     smallint,                                  -- ik
  installment_total smallint,                                  -- inn
  counterparty      text,                                      -- cp
  bank              text,                                      -- bk
  bill_date         date,                                      -- bd
  is_duplicate      boolean not null default false,            -- dup
  reason            text,                                      -- why
  new_description   text,                                      -- nd
  tx_id             bigint,                                    -- lançamento criado/vinculado
  linked            boolean not null default false,            -- lk
  from_pluggy       boolean not null default false,            -- pg
  extra             jsonb not null default '{}',
  primary key (user_id, id)
);
create index if not exists reconciliation_user_status_idx on public.reconciliation (user_id, status, date);

-- regras aprendidas (S.rules: descrição normalizada -> categoria)
create table if not exists public.rules (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text not null,
  category   text not null,
  pay_method text check (pay_method in ('Pix','Dinheiro','Cartão')),
  card_id    bigint,
  primary key (user_id, key)
);

-- ---------- categorias (S.cats) ----------
create table if not exists public.categories (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind     text not null check (kind in ('in','out')),
  name     text not null,
  position int  not null default 0,
  primary key (user_id, kind, name)
);

-- ---------- configurações (o que não é lista) ----------
-- jsonb: o Postgres também guarda JSON flexível; serve para o que muda muito.
create table if not exists public.user_settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  my_name       text,
  ord           jsonb not null default '{"fx":[],"vr":[]}',    -- ordem dos gastos fixos/variáveis
  emoji         jsonb not null default '{}',                   -- emo: emoji por categoria
  goal          jsonb,                                         -- meta antiga
  budget_legacy jsonb,                                         -- bud + budm (migrados para a planilha)
  pluggy        jsonb,                                         -- pgItems, pgCred (cifrado), pgHook
  extra         jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);

-- ---------- estado do push (hoje push/{uid} no Firestore) ----------
-- SÓ o servidor (service_role) acessa. RLS ligado e nenhuma policy = o navegador não vê nada.
create table if not exists public.push_state (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tokens      text[] not null default '{}',
  seen        text[] not null default '{}',                    -- ids já avisados (até 400)
  last_run    jsonb,
  last_hook   jsonb,
  extra       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- SEGURANÇA: RLS em TODAS as tabelas
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows',
    'budget_plan','reconciliation','rules','categories','user_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dono_acessa_o_proprio on public.%I', t);
    execute format(
      'create policy dono_acessa_o_proprio on public.%I for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);   -- visitante sem login: nada
  end loop;
end $$;

alter table public.push_state enable row level security;       -- sem policy de propósito
revoke all on public.push_state from anon, authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA: esta consulta deve voltar VAZIA (nenhuma tabela sem RLS).
-- ---------------------------------------------------------------------
select c.relname as tabela_sem_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

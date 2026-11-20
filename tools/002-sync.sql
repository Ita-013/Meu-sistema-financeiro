-- =====================================================================
-- Meu Caixa: 002, funções de sincronização (rode DEPOIS do schema.sql)
--
-- Como usar: Supabase > SQL Editor > cole este arquivo inteiro > Run.
-- Pode rodar de novo sem medo (create or replace, add column if not exists, drop trigger if exists).
--
-- O que cria:
--   load_all()        devolve, em UMA chamada, todas as linhas do usuário logado (um JSON com uma lista por tabela).
--   apply_changes(p)  recebe {"upserts":{tabela:[linhas]}, "deletes":{tabela:[chaves]}} e aplica tudo numa
--                     transação: ou grava tudo ou nada. Formato produzido por lib/mapa.js (diff).
--   wipe_my_data()    apaga todos os dados do usuário logado (botão "apagar cópia da nuvem").
--   updated_at        coluna em todas as tabelas, atualizada sozinha por um gatilho a cada alteração.
--
-- Segurança: as funções são "security invoker": rodam com as permissões de quem chamou, então o RLS do
-- schema.sql continua valendo (cada pessoa só enxerga e grava as próprias linhas). O nome das tabelas vem
-- de uma lista fixa aqui dentro, nunca do JSON recebido; os valores passam por jsonb_populate_recordset
-- (tipados), então não há como injetar SQL. Visitante sem login (anon) não pode executá-las.
-- =====================================================================

-- ---------- updated_at: coluna + gatilho ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows',
    'budget_plan','reconciliation','rules','categories','user_settings','push_state'
  ] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- load_all(): tudo do usuário, numa chamada ----------
-- Cada linha vem sem user_id, created_at e updated_at, ou seja, só as colunas que lib/mapa.js conhece.
create or replace function public.load_all() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  ordem text[] := array['cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows','budget_plan',
    'reconciliation','rules','categories','user_settings'];
  t text; r jsonb; res jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  foreach t in array ordem loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) - ''user_id'' - ''created_at'' - ''updated_at''), ''[]''::jsonb) from public.%I x', t)
      into r;
    res := res || jsonb_build_object(t, r);
  end loop;
  return res;
end $$;

-- ---------- apply_changes(p): aplica só as diferenças, numa transação ----------
-- 1) upserts na ordem das chaves estrangeiras (pais antes dos filhos); 2) deletes na ordem inversa.
-- Upsert = "insere ou, se a chave já existe, atualiza" (on conflict do update).
-- user_id não vem do JSON: é sempre quem está logado (default auth.uid() e RLS).
create or replace function public.apply_changes(p jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ordem text[] := array['cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows','budget_plan',
    'reconciliation','rules','categories','user_settings'];
  t text; i int; n int;
  pk text[]; pk_sem_user text[];
  cols text; sets text; alvo text; cond text;
  ups int := 0; dels int := 0;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'formato inválido: esperava um objeto'; end if;

  foreach t in array ordem loop
    if jsonb_typeof(p->'upserts'->t) = 'array' and jsonb_array_length(p->'upserts'->t) > 0 then
      select array_agg(a.attname::text order by a.attnum) into pk
        from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any(x.indkey)
       where x.indrelid = ('public.' || t)::regclass and x.indisprimary;
      pk_sem_user := array_remove(pk, 'user_id');
      select string_agg(quote_ident(attname), ', ' order by attnum) into cols
        from pg_attribute
       where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped
         and attname::text not in ('user_id', 'created_at', 'updated_at');
      select string_agg(format('%1$I = excluded.%1$I', attname), ', ' order by attnum) into sets
        from pg_attribute
       where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped
         and attname::text <> all (pk_sem_user || array['user_id', 'created_at', 'updated_at']);
      select string_agg(quote_ident(c), ', ') into alvo from unnest(pk) c;
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) '
        'on conflict (%s) do update set %s',
        t, cols, cols, t, alvo, sets)
        using p->'upserts'->t;
      get diagnostics n = row_count;
      ups := ups + n;
    end if;
  end loop;

  for i in reverse array_length(ordem, 1)..1 loop
    t := ordem[i];
    if jsonb_typeof(p->'deletes'->t) = 'array' and jsonb_array_length(p->'deletes'->t) > 0 then
      select array_agg(a.attname::text order by a.attnum) into pk
        from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any(x.indkey)
       where x.indrelid = ('public.' || t)::regclass and x.indisprimary;
      pk_sem_user := array_remove(pk, 'user_id');
      if cardinality(pk_sem_user) = 0 then
        cond := 'true';
      else
        select string_agg(format('d.%1$I = x.%1$I', c), ' and ') into cond from unnest(pk_sem_user) c;
      end if;
      execute format(
        'delete from public.%I d using jsonb_populate_recordset(null::public.%I, $1) x '
        'where d.user_id = auth.uid() and %s', t, t, cond)
        using p->'deletes'->t;
      get diagnostics n = row_count;
      dels := dels + n;
    end if;
  end loop;

  return jsonb_build_object('upserts', ups, 'deletes', dels);
end $$;

-- ---------- wipe_my_data(): apaga tudo do usuário logado ----------
create or replace function public.wipe_my_data() returns void
language plpgsql security invoker set search_path = public as $$
declare
  ordem text[] := array['cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows','budget_plan',
    'reconciliation','rules','categories','user_settings'];
  i int;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  for i in reverse array_length(ordem, 1)..1 loop
    execute format('delete from public.%I where user_id = auth.uid()', ordem[i]);
  end loop;
end $$;

-- ---------- permissões: só quem está logado executa ----------
revoke all on function public.load_all(), public.apply_changes(jsonb), public.wipe_my_data(), public.touch_updated_at() from public, anon;
grant execute on function public.load_all(), public.apply_changes(jsonb), public.wipe_my_data() to authenticated;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA: deve listar as 3 funções e 15 tabelas com updated_at.
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('load_all', 'apply_changes', 'wipe_my_data')) as funcoes,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at') as tabelas_com_updated_at;

-- 003-server.sql: leitura de um usuário pelo SERVIDOR (fase B da migração para o Supabase).
-- O servidor (Vercel) usa a chave service_role, que ignora o RLS e não tem auth.uid(); por isso esta função recebe o
-- id do usuário e filtra por ele. Só o service_role executa: o app (authenticated) e o visitante (anon) não podem.
-- Rode no SQL Editor do Supabase (depois do 002). Pode rodar de novo sem problema.
-- Resultado esperado na última consulta: executa_service_role = true, executa_authenticated = false, executa_anon = false.

create or replace function public.load_all_for(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  ordem text[] := array['cards','cashboxes','cashbox_movements','transactions','tx_reimbursements',
    'commitments','recurring_commitments','invoice_payments','budget_rows','budget_plan',
    'reconciliation','rules','categories','user_settings'];
  t text; r jsonb; res jsonb := '{}'::jsonb; ob text;
begin
  if p_user is null then raise exception 'usuário não informado'; end if;
  foreach t in array ordem loop
    select coalesce(string_agg(quote_ident(a.attname), ', ' order by a.attnum), '1') into ob
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisprimary and a.attname <> 'user_id';
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) - ''user_id'' - ''created_at'' - ''updated_at'' order by %s), ''[]''::jsonb) from public.%I x where x.user_id = $1', ob, t)
      into r using p_user;
    res := res || jsonb_build_object(t, r);
  end loop;
  return res;
end $$;

revoke all on function public.load_all_for(uuid) from public, anon, authenticated;
grant execute on function public.load_all_for(uuid) to service_role;

-- permissões de tabela do servidor (projetos novos podem não conceder sozinhos)
grant usage on schema public to service_role;
grant select on public.cards, public.cashboxes, public.cashbox_movements, public.transactions, public.tx_reimbursements,
  public.commitments, public.recurring_commitments, public.invoice_payments, public.budget_rows, public.budget_plan,
  public.reconciliation, public.rules, public.categories, public.user_settings to service_role;
grant select, insert, update, delete on public.push_state to service_role;

select
  has_function_privilege('service_role', 'public.load_all_for(uuid)', 'execute') as executa_service_role,
  has_function_privilege('authenticated', 'public.load_all_for(uuid)', 'execute') as executa_authenticated,
  has_function_privilege('anon', 'public.load_all_for(uuid)', 'execute') as executa_anon;

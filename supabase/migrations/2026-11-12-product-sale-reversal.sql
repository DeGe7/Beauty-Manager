begin;

-- Older deployments may have the product sales ledger without the reversal
-- snapshot columns because the original CRM migration was applied before the
-- reversal support was added to the source schema.
alter table public.product_sales
  add column if not exists reversal_date text,
  add column if not exists reversal_reason text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'product_sales_reversal_date_check'
       and conrelid = 'public.product_sales'::regclass
  ) then
    alter table public.product_sales
      add constraint product_sales_reversal_date_check
      check (reversal_date is null or reversal_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'product_sales_reversal_reason_check'
       and conrelid = 'public.product_sales'::regclass
  ) then
    alter table public.product_sales
      add constraint product_sales_reversal_reason_check
      check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 500);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'product_sales_reversal_state_check'
       and conrelid = 'public.product_sales'::regclass
  ) then
    alter table public.product_sales
      add constraint product_sales_reversal_state_check
      check (
        (reversal_date is null and reversal_reason is null and reversed_at is null)
        or (reversal_date is not null and reversal_reason is not null and reversed_at is not null)
      );
  end if;
end
$$;

-- The sale row lock makes repeated reversal requests idempotent and prevents
-- stock from being restored more than once.
create or replace function public.reverse_product_sale(
  p_sale_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_sale public.product_sales;
  v_item jsonb;
  v_product_id text;
  v_quantity bigint;
  v_reversal_date text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null or not public.has_permission('produtos') then
    raise exception 'product_sale_permission_required' using errcode = '42501';
  end if;
  if p_sale_id is null or length(btrim(p_sale_id)) = 0 then
    raise exception 'product_sale_id_required' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 500 then
    raise exception 'invalid_product_sale_reversal_reason' using errcode = '22023';
  end if;

  select sale.*
    into v_sale
    from public.product_sales sale
   where sale.id = p_sale_id
     and sale.organization_id = v_organization_id
   for update;
  if not found then
    raise exception 'product_sale_not_found' using errcode = 'P0001';
  end if;
  if v_sale.reversed_at is not null then
    return to_jsonb(v_sale);
  end if;
  if jsonb_typeof(v_sale.items) <> 'array'
     or jsonb_array_length(v_sale.items) = 0
     or exists (
       select 1
         from jsonb_array_elements(v_sale.items) as item(value)
        where coalesce(item.value->>'productId', '') = ''
           or coalesce(item.value->>'quantity', '') !~ '^[1-9][0-9]*$'
     ) then
    raise exception 'invalid_product_sale_snapshot' using errcode = '22023';
  end if;

  for v_item in
    select jsonb_build_object(
             'productId', item.value->>'productId',
             'quantity', sum((item.value->>'quantity')::bigint)
           )
      from jsonb_array_elements(v_sale.items) as item(value)
     group by item.value->>'productId'
     order by item.value->>'productId'
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::bigint;
    update public.products
       set stock = stock + v_quantity,
           updated_at = now()
     where id = v_product_id
       and organization_id = v_organization_id;
    if not found then
      raise exception 'product_sale_reversal_product_not_found:%', v_product_id using errcode = 'P0001';
    end if;
  end loop;

  v_reversal_date := timezone('America/Sao_Paulo', clock_timestamp())::date::text;
  update public.product_sales
     set reversal_date = v_reversal_date,
         reversal_reason = btrim(p_reason),
         reversed_at = clock_timestamp(),
         reversed_by = auth.uid()
   where id = v_sale.id
     and organization_id = v_organization_id
  returning * into v_sale;

  return to_jsonb(v_sale);
end;
$$;

revoke all on function public.reverse_product_sale(text, text)
  from public, anon;
grant execute on function public.reverse_product_sale(text, text)
  to authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-12.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

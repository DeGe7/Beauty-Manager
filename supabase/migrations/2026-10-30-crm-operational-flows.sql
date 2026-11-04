begin;

-- Keep the configured service/category stable for commission and plan rules;
-- the client-entered description is a separate display-only snapshot.
alter table public.appointments
  add column if not exists service_description text;

alter table public.incomes
  add column if not exists payment_method text
    check (payment_method in ('debito', 'credito', 'pix', 'dinheiro'));

-- Product sales need a durable price/discount snapshot because the catalog can
-- change after the sale. This is a sales ledger, not a second product catalog.
create table if not exists public.product_sales (
  id text primary key default gen_random_uuid()::text,
  date text not null,
  client_id text references public.clients(id) on delete set null,
  appointment_id text references public.appointments(id) on delete set null,
  payment_method text not null
    check (payment_method in ('debito', 'credito', 'pix', 'dinheiro')),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  total double precision not null check (total >= 0),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reversal_date text check (reversal_date is null or reversal_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  reversal_reason text check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 500),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id) on delete set null
);

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

create index if not exists product_sales_organization_date_idx
  on public.product_sales (organization_id, date desc);

alter table public.product_sales enable row level security;
revoke all on public.product_sales from public, anon, authenticated;
grant select on public.product_sales to authenticated;

drop policy if exists product_sales_select_member on public.product_sales;
create policy product_sales_select_member on public.product_sales
for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.has_permission('produtos')
);

create or replace function public.record_product_sale(
  p_date text,
  p_client_id text,
  p_appointment_id text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_sale_id text := gen_random_uuid()::text;
  v_item jsonb;
  v_product public.products;
  v_product_id text;
  v_quantity integer;
  v_discount_type text;
  v_discount_value numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_discount_amount numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null or not public.has_permission('produtos') then
    raise exception 'product_sale_permission_required' using errcode = '42501';
  end if;
  if p_date is null or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_date <> timezone('America/Sao_Paulo', clock_timestamp())::date::text then
    raise exception 'product_sale_date_must_be_today' using errcode = '22023';
  end if;
  if p_payment_method not in ('debito', 'credito', 'pix', 'dinheiro') then
    raise exception 'invalid_product_sale_payment_method' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'product_sale_items_required' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients client
    where client.id = p_client_id and client.organization_id = v_organization_id
  ) then
    raise exception 'product_sale_client_not_found' using errcode = 'P0001';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments appointment
    where appointment.id = p_appointment_id and appointment.organization_id = v_organization_id
  ) then
    raise exception 'product_sale_appointment_not_found' using errcode = 'P0001';
  end if;

  -- Process product locks in stable order so concurrent baskets cannot
  -- deadlock by locking the same products in opposite orders.
  for v_item in
    select item.value
      from jsonb_array_elements(p_items) as item(value)
     order by item.value->>'productId'
  loop
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    if v_product_id is null
       or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item->>'discountValue', '0') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'invalid_product_sale_item' using errcode = '22023';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    v_discount_type := coalesce(nullif(v_item->>'discountType', ''), 'amount');
    v_discount_value := coalesce((v_item->>'discountValue')::numeric, 0);
    if v_discount_type not in ('amount', 'percent')
       or v_discount_value < 0
       or (v_discount_type = 'percent' and v_discount_value > 100) then
      raise exception 'invalid_product_sale_discount' using errcode = '22023';
    end if;

    select product.*
      into v_product
      from public.products product
     where product.id = v_product_id
       and product.organization_id = v_organization_id
       and product.is_active
     for update;
    if not found then
      raise exception 'product_sale_product_not_found' using errcode = 'P0001';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'product_sale_insufficient_stock:%:%', v_product.name, v_product.stock using errcode = 'P0001';
    end if;

    v_unit_price := round(v_product.price::numeric, 2);
    v_subtotal := round(v_unit_price * v_quantity, 2);
    v_discount_amount := case
      when v_discount_type = 'percent'
        then round(v_subtotal * v_discount_value / 100, 2)
      else round(v_discount_value, 2)
    end;
    if v_discount_amount > v_subtotal then
      raise exception 'product_sale_discount_exceeds_subtotal' using errcode = '22023';
    end if;
    v_line_total := round(v_subtotal - v_discount_amount, 2);
    if v_line_total < 0 then
      raise exception 'product_sale_negative_total' using errcode = '22023';
    end if;
    v_total := v_total + v_line_total;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'unitPrice', v_unit_price,
      'quantity', v_quantity,
      'discountType', v_discount_type,
      'discountValue', v_discount_value,
      'discountAmount', v_discount_amount,
      'total', v_line_total
    ));

    update public.products
       set stock = stock - v_quantity,
           updated_at = now()
     where id = v_product.id
       and organization_id = v_organization_id
       and stock >= v_quantity;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'product_sale_insufficient_stock:%:%', v_product.name, v_product.stock using errcode = 'P0001';
    end if;
  end loop;

  insert into public.product_sales (
    id, date, client_id, appointment_id, payment_method, items, total,
    organization_id, created_by
  ) values (
    v_sale_id, p_date, p_client_id, p_appointment_id, p_payment_method,
    v_items, v_total, v_organization_id, auth.uid()
  );

  return jsonb_build_object(
    'id', v_sale_id,
    'date', p_date,
    'client_id', p_client_id,
    'appointment_id', p_appointment_id,
    'payment_method', p_payment_method,
    'items', v_items,
    'total', v_total,
    'created_at', now()
  );
end;
$$;

revoke all on function public.record_product_sale(text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.record_product_sale(text, text, text, text, jsonb)
  to authenticated;

-- Reversals preserve the original sale snapshot and are idempotent under
-- concurrent requests: the sale row lock allows stock to be restored only once.
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

create or replace function public.get_reception_daily_operations(p_date text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_income jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0}'::jsonb;
  v_expense jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0}'::jsonb;
  v_plan_receipts jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0,"sem_forma":0}'::jsonb;
  v_payment jsonb;
  v_appointment record;
  v_plan record;
  v_exp record;
  v_sales record;
  v_method text;
  v_attendances integer := 0;
  v_plan_uses integer := 0;
  v_expense_total numeric := 0;
  v_income_total numeric := 0;
  v_income_without_method numeric := 0;
  v_plan_total numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null
     or not (
       public.is_manager()
       or (public.current_user_role() = 'recepcao' and public.has_permission('controle'))
     ) then
    raise exception 'daily_operations_permission_required' using errcode = '42501';
  end if;
  if p_date is distinct from timezone('America/Sao_Paulo', clock_timestamp())::date::text then
    raise exception 'daily_operations_current_day_only' using errcode = '42501';
  end if;

  for v_appointment in
    select appointment.*
      from public.appointments appointment
     where appointment.organization_id = v_organization_id
       and appointment.date = p_date
       and appointment.status in ('confirmed', 'completed')
       and (appointment.status = 'completed' or appointment.attendance_recorded_at is not null)
  loop
    v_attendances := v_attendances + 1;
    if v_appointment.plan_subscriber_id is not null
       and v_appointment.attendance_recorded_at is not null then
      v_plan_uses := v_plan_uses + 1;
    end if;
    if jsonb_typeof(v_appointment.payment_splits) = 'array'
       and jsonb_array_length(v_appointment.payment_splits) > 0 then
      for v_payment in select value from jsonb_array_elements(v_appointment.payment_splits)
      loop
        v_method := v_payment->>'method';
        if v_method in ('debito', 'credito', 'pix', 'dinheiro') then
          v_income := jsonb_set(
            v_income, array[v_method],
            to_jsonb(coalesce((v_income->>v_method)::numeric, 0) + coalesce((v_payment->>'amount')::numeric, 0))
          );
          v_income_total := v_income_total + coalesce((v_payment->>'amount')::numeric, 0);
        end if;
      end loop;
    elsif v_appointment.pay_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_appointment.pay_method],
        to_jsonb(coalesce((v_income->>v_appointment.pay_method)::numeric, 0) + v_appointment.value + v_appointment.tip)
      );
      v_income_total := v_income_total + v_appointment.value + v_appointment.tip;
    end if;
  end loop;

  for v_sales in
    select movements.payment_method, sum(movements.total)::numeric as total
      from (
        select sale.payment_method, sale.total as total
          from public.product_sales sale
         where sale.organization_id = v_organization_id and sale.date = p_date
        union all
        select sale.payment_method, -sale.total as total
          from public.product_sales sale
         where sale.organization_id = v_organization_id and sale.reversal_date = p_date
      ) as movements
     group by movements.payment_method
  loop
    v_income := jsonb_set(
      v_income, array[v_sales.payment_method],
      to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
    );
    v_income_total := v_income_total + v_sales.total;
  end loop;

  for v_sales in
    select sale.pay_method1 as payment_method,
           sum(case when sale.installments > 0
             then sale.value::numeric * sale.installments_paid / sale.installments
             else 0 end) as total
      from public.prothesis_sales sale
     where sale.organization_id = v_organization_id and sale.date = p_date
     group by sale.pay_method1
  loop
    if v_sales.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_sales.payment_method],
        to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
      );
      v_income_total := v_income_total + v_sales.total;
    end if;
  end loop;

  for v_sales in
    select income.payment_method, sum(income.amount)::numeric as total
      from public.incomes income
     where income.organization_id = v_organization_id and income.date = p_date
     group by income.payment_method
  loop
    v_income_total := v_income_total + v_sales.total;
    if v_sales.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_sales.payment_method],
        to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
      );
    else
      v_income_without_method := v_income_without_method + v_sales.total;
    end if;
  end loop;

  for v_plan in
    select payment.payment_method, sum(payment.amount)::numeric as total
      from public.subscription_payments payment
     where payment.organization_id = v_organization_id
       and payment.status = 'pago'
       and coalesce(payment.paid_at, payment.due_date) = p_date
     group by payment.payment_method
  loop
    v_plan_total := v_plan_total + v_plan.total;
    if v_plan.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_plan_receipts := jsonb_set(
        v_plan_receipts, array[v_plan.payment_method],
        to_jsonb(coalesce((v_plan_receipts->>v_plan.payment_method)::numeric, 0) + v_plan.total)
      );
    else
      v_plan_receipts := jsonb_set(
        v_plan_receipts, '{sem_forma}',
        to_jsonb(coalesce((v_plan_receipts->>'sem_forma')::numeric, 0) + v_plan.total)
      );
    end if;
  end loop;

  for v_exp in
    select expense.payment_method, sum(expense.amount)::numeric as total
      from public.expenses expense
     where expense.organization_id = v_organization_id and expense.date = p_date
     group by expense.payment_method
  loop
    v_expense_total := v_expense_total + v_exp.total;
    if v_exp.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_expense := jsonb_set(
        v_expense, array[v_exp.payment_method],
        to_jsonb(coalesce((v_expense->>v_exp.payment_method)::numeric, 0) + v_exp.total)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'date', p_date,
    'attendances', v_attendances,
    'planUses', v_plan_uses,
    'incomeByMethod', v_income,
    'incomeTotal', v_income_total,
    'incomeWithoutMethod', v_income_without_method,
    'expenseByMethod', v_expense,
    'expenseTotal', v_expense_total,
    'planReceiptsByMethod', v_plan_receipts,
    'planReceiptTotal', v_plan_total
  );
end;
$$;

revoke all on function public.get_reception_daily_operations(text)
  from public, anon;
grant execute on function public.get_reception_daily_operations(text)
  to authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-30.4')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
commit;

begin;

create or replace function public.has_permission(permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  role_key text;
  configured_permissions jsonb;
begin
  if auth.uid() is null or permission_key is null or btrim(permission_key) = '' then
    return false;
  end if;

  role_key := public.current_user_role();
  if public.is_manager() then
    return true;
  end if;
  if role_key = 'recepcao'
     and permission_key in ('financeiro', 'profissionais', 'configuracoes', 'comunicacao') then
    return false;
  end if;
  if role_key = 'recepcao' and permission_key = 'planos' then
    return true;
  end if;

  select role_item->'permissions'
    into configured_permissions
    from public.organization_settings settings
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(settings.payload->'roles') = 'array'
        then settings.payload->'roles' else '[]'::jsonb end
    ) role_item
   where settings.organization_id = public.current_organization_id()
     and role_item->>'key' = role_key
   limit 1;

  if configured_permissions is null or jsonb_typeof(configured_permissions) <> 'array' then
    configured_permissions := public.default_role_permissions(role_key);
  end if;
  return configured_permissions ? permission_key;
end;
$$;

update public.organization_settings settings
   set payload = jsonb_set(
     coalesce(settings.payload, '{}'::jsonb),
     '{roles}',
     (
       select jsonb_agg(
         case when role_item.value->>'key' = 'recepcao' then
           jsonb_set(
             role_item.value,
             '{permissions}',
             '["dashboard","agenda","controle","clientes","produtos","planos"]'::jsonb,
             true
           )
         else role_item.value end
       )
         from jsonb_array_elements(
           case when jsonb_typeof(settings.payload->'roles') = 'array'
             then settings.payload->'roles' else '[]'::jsonb end
         ) as role_item(value)
     ),
     true
   )
 where jsonb_typeof(settings.payload->'roles') = 'array'
   and exists (
     select 1
       from jsonb_array_elements(settings.payload->'roles') as role_item(value)
      where role_item.value->>'key' = 'recepcao'
   );

drop policy if exists subscription_plans_manager_write on public.subscription_plans;
create policy subscription_plans_manager_write on public.subscription_plans
for all to authenticated
using (
  organization_id = public.current_organization_id()
  and public.has_permission('planos')
)
with check (
  organization_id = public.current_organization_id()
  and public.has_permission('planos')
);

drop policy if exists subscribers_select_member on public.subscribers;
create policy subscribers_select_member on public.subscribers
for select to authenticated using (
  organization_id = public.current_organization_id()
  and (
    public.is_current_organization_professional(professional_id)
    or (public.current_user_role() = 'recepcao' and professional_id is null)
  )
  and public.is_current_organization_plan(plan_id)
  and (
    public.is_manager()
    or (
      public.has_permission('planos')
      and (
        professional_id = public.current_professional_id()
        or public.current_user_role() = 'recepcao'
      )
    )
  )
);

drop policy if exists subscribers_write on public.subscribers;
create policy subscribers_write on public.subscribers
for all to authenticated using (
  organization_id = public.current_organization_id()
  and (
    public.is_current_organization_professional(professional_id)
    or (public.current_user_role() = 'recepcao' and professional_id is null)
  )
  and public.is_current_organization_plan(plan_id)
  and (
    public.is_manager()
    or (
      public.has_permission('planos')
      and (
        professional_id = public.current_professional_id()
        or public.current_user_role() = 'recepcao'
      )
    )
  )
) with check (
  organization_id = public.current_organization_id()
  and (
    public.is_current_organization_professional(professional_id)
    or (public.current_user_role() = 'recepcao' and professional_id is null)
  )
  and public.is_current_organization_plan(plan_id)
  and (
    public.is_manager()
    or (
      public.has_permission('planos')
      and (
        professional_id = public.current_professional_id()
        or public.current_user_role() = 'recepcao'
      )
    )
  )
);

drop policy if exists subscription_payments_select_member on public.subscription_payments;
create policy subscription_payments_select_member on public.subscription_payments
for select to authenticated using (
  organization_id = public.current_organization_id()
  and exists (
    select 1
      from public.subscribers s
      join public.subscription_plans p on p.id = s.plan_id
     where s.id = subscription_payments.subscriber_id
       and s.organization_id = subscription_payments.organization_id
       and (
         public.is_current_organization_professional(s.professional_id)
         or (public.current_user_role() = 'recepcao' and s.professional_id is null)
       )
       and public.is_current_organization_plan(p.id)
       and (
         public.is_manager()
         or (
           public.has_permission('planos')
           and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')
         )
       )
  )
);

drop policy if exists subscription_payments_write on public.subscription_payments;
create policy subscription_payments_write on public.subscription_payments
for all to authenticated using (
  organization_id = public.current_organization_id()
  and exists (
    select 1
      from public.subscribers s
      join public.subscription_plans p on p.id = s.plan_id
     where s.id = subscription_payments.subscriber_id
       and s.organization_id = subscription_payments.organization_id
       and (
         public.is_current_organization_professional(s.professional_id)
         or (public.current_user_role() = 'recepcao' and s.professional_id is null)
       )
       and public.is_current_organization_plan(p.id)
       and (
         public.is_manager()
         or (
           public.has_permission('planos')
           and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')
         )
       )
  )
) with check (
  organization_id = public.current_organization_id()
  and exists (
    select 1
      from public.subscribers s
      join public.subscription_plans p on p.id = s.plan_id
     where s.id = subscription_payments.subscriber_id
       and s.organization_id = subscription_payments.organization_id
       and (
         public.is_current_organization_professional(s.professional_id)
         or (public.current_user_role() = 'recepcao' and s.professional_id is null)
       )
       and public.is_current_organization_plan(p.id)
       and (
         public.is_manager()
         or (
           public.has_permission('planos')
           and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')
         )
       )
  )
);

create or replace function public.set_subscription_payment_status(
  p_subscriber_id text,
  p_due_date text,
  p_status text,
  p_paid_at text default null,
  p_amount double precision default 0,
  p_payment_method text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_sub public.subscribers;
  plan_duration text;
  plan_price double precision;
  payment_row public.subscription_payments;
  next_payment_row public.subscription_payments;
  next_due text;
begin
  if p_status not in ('pago', 'pendente', 'vencido') then
    raise exception 'invalid subscription payment status';
  end if;
  if p_amount < 0 then
    raise exception 'payment amount must be non-negative';
  end if;
  if p_status = 'pago' and (p_paid_at is null or p_payment_method not in ('debito', 'credito', 'pix', 'dinheiro')) then
    raise exception 'paid subscriptions require payment date and method';
  end if;

  select * into current_sub
    from public.subscribers
   where id = p_subscriber_id
     and organization_id = public.current_organization_id()
   for update;
  if current_sub.id is null then
    raise exception 'subscriber not found';
  end if;

  if not (
    public.is_manager()
    or (
      public.has_permission('planos')
      and (
        current_sub.professional_id = public.current_professional_id()
        or public.current_user_role() = 'recepcao'
      )
    )
  ) then
    raise exception 'user does not have permission to update subscription payments';
  end if;

  select duration, price into plan_duration, plan_price
    from public.subscription_plans
   where id = current_sub.plan_id
     and organization_id = current_sub.organization_id;
  if plan_duration is null then
    raise exception 'subscription plan not found';
  end if;

  insert into public.subscription_payments (
    subscriber_id, due_date, paid_at, amount, payment_method, status, note, organization_id
  )
  values (
    current_sub.id,
    coalesce(nullif(p_due_date, ''), current_sub.next_payment),
    case when p_status = 'pago' then p_paid_at else null end,
    p_amount,
    case when p_status = 'pago' then p_payment_method else null end,
    p_status,
    nullif(btrim(coalesce(p_note, '')), ''),
    current_sub.organization_id
  )
  on conflict (subscriber_id, due_date) do update set
    paid_at = excluded.paid_at,
    amount = excluded.amount,
    payment_method = excluded.payment_method,
    status = excluded.status,
    note = excluded.note
  returning * into payment_row;

  if p_status = 'pago' then
    if current_sub.next_payment = payment_row.due_date then
      next_due := public.subscription_next_due(payment_row.due_date, plan_duration);
      update public.subscribers
         set next_payment = next_due, status = 'ativo'
       where id = current_sub.id;
    else
      next_due := current_sub.next_payment;
    end if;

    insert into public.subscription_payments (
      subscriber_id, due_date, amount, status, organization_id
    )
    values (
      current_sub.id, next_due, coalesce(plan_price, 0), 'pendente', current_sub.organization_id
    )
    on conflict (subscriber_id, due_date) do nothing;

    select * into next_payment_row
      from public.subscription_payments
     where subscriber_id = current_sub.id
       and due_date = next_due
       and organization_id = current_sub.organization_id;
  else
    update public.subscribers
       set status = p_status
     where id = current_sub.id;
  end if;

  return jsonb_build_object(
    'payment', to_jsonb(payment_row),
    'subscriber', to_jsonb((select s from public.subscribers s where s.id = current_sub.id)),
    'next_payment', case when next_payment_row.id is null then null else to_jsonb(next_payment_row) end
  );
end;
$$;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-28.2')
on conflict (key) do update
set value = excluded.value, updated_at = now();

commit;

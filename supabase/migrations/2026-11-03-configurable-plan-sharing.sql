begin;

alter table public.subscription_plans
  add column if not exists salon_share_percent numeric(5, 2);

alter table public.subscribers
  add column if not exists salon_share_percent_snapshot numeric(5, 2);

alter table public.subscription_payments
  add column if not exists salon_share_percent_snapshot numeric(5, 2);

alter table public.subscribers
  drop constraint if exists subscribers_salon_share_snapshot_range;
alter table public.subscribers
  add constraint subscribers_salon_share_snapshot_range
  check (
    salon_share_percent_snapshot is null
    or salon_share_percent_snapshot between 0 and 100
  );

alter table public.subscription_plans
  drop constraint if exists subscription_plans_salon_share_percent_range;
alter table public.subscription_plans
  add constraint subscription_plans_salon_share_percent_range
  check (salon_share_percent is null or salon_share_percent between 0 and 100);

alter table public.subscription_payments
  drop constraint if exists subscription_payments_salon_share_snapshot_range;
alter table public.subscription_payments
  add constraint subscription_payments_salon_share_snapshot_range
  check (
    salon_share_percent_snapshot is null
    or salon_share_percent_snapshot between 0 and 100
  );

comment on column public.subscription_plans.salon_share_percent is
  'Configured salon share for future paid plan receipts and uses; null preserves legacy commission behavior.';
comment on column public.subscribers.salon_share_percent_snapshot is
  'Salon share captured for the current manual-use cycle; null preserves legacy commission behavior.';
comment on column public.subscription_payments.salon_share_percent_snapshot is
  'Salon share captured when this payment first becomes paid; null means no historical split is known.';

create or replace function public.snapshot_subscription_plan_share_on_paid_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pago' or new.salon_share_percent_snapshot is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'pago' then
    return new;
  end if;

  select plan.salon_share_percent
    into new.salon_share_percent_snapshot
    from public.subscribers subscriber
    join public.subscription_plans plan
      on plan.id = subscriber.plan_id
     and plan.organization_id = subscriber.organization_id
   where subscriber.id = new.subscriber_id
     and subscriber.organization_id = new.organization_id;

  update public.subscribers subscriber
     set salon_share_percent_snapshot = new.salon_share_percent_snapshot
   where subscriber.id = new.subscriber_id
     and subscriber.organization_id = new.organization_id
     and not exists (
       select 1
         from public.appointments appointment
        where appointment.plan_subscriber_id = subscriber.id
          and appointment.organization_id = subscriber.organization_id
          and appointment.status in ('confirmed', 'completed')
          and appointment.attendance_recorded_at >= subscriber.usage_started_at
     );

  return new;
end;
$$;

revoke all on function public.snapshot_subscription_plan_share_on_paid_payment()
  from public, anon, authenticated;
drop trigger if exists subscription_payments_plan_share_snapshot
  on public.subscription_payments;
create trigger subscription_payments_plan_share_snapshot
before insert or update on public.subscription_payments
for each row execute function public.snapshot_subscription_plan_share_on_paid_payment();

create or replace function public.snapshot_subscriber_plan_share_for_usage_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid_share_percent numeric(5, 2);
begin
  if new.plan_id is distinct from old.plan_id then
    select plan.salon_share_percent
      into new.salon_share_percent_snapshot
      from public.subscription_plans plan
     where plan.id = new.plan_id
       and plan.organization_id = new.organization_id;
  elsif new.usage_started_at is distinct from old.usage_started_at then
    select payment.salon_share_percent_snapshot
      into v_paid_share_percent
      from public.subscription_payments payment
     where payment.subscriber_id = new.id
       and payment.organization_id = new.organization_id
       and payment.status = 'pago'
     order by coalesce(payment.paid_at, payment.due_date) desc,
              payment.updated_at desc,
              payment.id desc
     limit 1;
    if found then
      new.salon_share_percent_snapshot := v_paid_share_percent;
    else
      new.salon_share_percent_snapshot := old.salon_share_percent_snapshot;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_subscriber_plan_share_for_usage_cycle()
  from public, anon, authenticated;
drop trigger if exists subscribers_plan_share_cycle_snapshot
  on public.subscribers;
create trigger subscribers_plan_share_cycle_snapshot
before update of plan_id, usage_started_at on public.subscribers
for each row execute function public.snapshot_subscriber_plan_share_for_usage_cycle();

create or replace function public.validate_plan_appointment_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber public.subscribers;
  v_plan public.subscription_plans;
  v_service_limit integer;
  v_total_uses integer;
  v_used integer;
  v_total_used integer;
  v_usage_ordinal integer;
  v_pool_cents numeric;
  v_base_cents numeric;
  v_remainder_cents numeric;
  v_today date;
  v_subscriber_phone text;
  v_client_phone text;
  v_client_name text;
begin
  if tg_op = 'UPDATE'
     and old.plan_subscriber_id is not null
     and new.plan_subscriber_id is null then
    new.plan_usage_value := old.plan_usage_value;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.plan_subscriber_id is not null
     and new.plan_subscriber_id is not distinct from old.plan_subscriber_id
     and new.organization_id is not distinct from old.organization_id
     and new.service_id is not distinct from old.service_id
     and new.service is not distinct from old.service
     and new.client_id is not distinct from old.client_id
     and new.status is not distinct from old.status
     and new.attendance_recorded_at is not distinct from old.attendance_recorded_at then
    new.value := 0;
    new.plan_usage_value := old.plan_usage_value;
    return new;
  end if;

  if new.plan_subscriber_id is null then
    new.plan_usage_value := 0;
    return new;
  end if;

  new.value := 0;

  if coalesce(auth.role(), '') <> 'service_role'
     and new.organization_id is distinct from public.current_organization_id() then
    raise exception 'plan_usage_wrong_organization' using errcode = '42501';
  end if;

  select subscriber.*
    into v_subscriber
    from public.subscribers subscriber
   where subscriber.id = new.plan_subscriber_id
     and subscriber.organization_id = new.organization_id
   for update;
  if not found then
    raise exception 'plan_subscriber_not_found' using errcode = 'P0001';
  end if;

  select plan.*
    into v_plan
    from public.subscription_plans plan
   where plan.id = v_subscriber.plan_id
     and plan.organization_id = v_subscriber.organization_id;
  if not found then
    raise exception 'plan_subscriber_plan_not_found' using errcode = 'P0001';
  end if;

  v_today := timezone('America/Sao_Paulo', clock_timestamp())::date;
  if v_subscriber.status <> 'ativo'
     or v_subscriber.next_payment::date < v_today then
    raise exception 'plan_subscriber_inactive' using errcode = 'P0001';
  end if;

  v_subscriber_phone := regexp_replace(coalesce(v_subscriber.phone, ''), '[^0-9]', '', 'g');
  if left(v_subscriber_phone, 2) = '55' and length(v_subscriber_phone) in (12, 13) then
    v_subscriber_phone := substring(v_subscriber_phone from 3);
  end if;
  if new.client_id is null then
    raise exception 'plan_subscriber_client_mismatch' using errcode = 'P0001';
  end if;

  select client.whatsapp, client.name
    into v_client_phone, v_client_name
    from public.clients client
   where client.id = new.client_id
     and client.organization_id = new.organization_id;
  if not found then
    raise exception 'plan_subscriber_client_mismatch' using errcode = 'P0001';
  end if;

  v_client_phone := regexp_replace(coalesce(v_client_phone, ''), '[^0-9]', '', 'g');
  if left(v_client_phone, 2) = '55' and length(v_client_phone) in (12, 13) then
    v_client_phone := substring(v_client_phone from 3);
  end if;
  if not (
    (v_subscriber_phone <> '' and v_client_phone = v_subscriber_phone)
    or (
      v_subscriber_phone = ''
      and lower(btrim(v_client_name)) = lower(btrim(v_subscriber.name))
    )
  ) then
    raise exception 'plan_subscriber_client_mismatch' using errcode = 'P0001';
  end if;

  if new.service_id is null or not exists (
    select 1
      from public.organization_settings settings
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(settings.payload->'services') = 'array'
            then settings.payload->'services'
          else '[]'::jsonb
        end
      ) as configured_service(value)
     where settings.organization_id = new.organization_id
       and configured_service.value->>'id' = new.service_id
       and configured_service.value->>'name' = new.service
       and coalesce((configured_service.value->>'isActive')::boolean, true)
  ) then
    raise exception 'plan_service_not_configured' using errcode = 'P0001';
  end if;

  select max(
           case
             when coalesce(service.value->>'usesPerCycle', '') ~ '^[0-9]+$'
               then (service.value->>'usesPerCycle')::integer
             else 0
           end
         )
    into v_service_limit
    from jsonb_array_elements(
      case when jsonb_typeof(v_plan.services) = 'array' then v_plan.services else '[]'::jsonb end
    ) as service(value)
   where jsonb_typeof(service.value) = 'object'
     and service.value->>'serviceId' = new.service_id;

  select coalesce(sum(
           case
             when coalesce(service.value->>'usesPerCycle', '') ~ '^[0-9]+$'
               then greatest((service.value->>'usesPerCycle')::integer, 0)
             else 0
           end
         ), 0)
    into v_total_uses
    from jsonb_array_elements(
      case when jsonb_typeof(v_plan.services) = 'array' then v_plan.services else '[]'::jsonb end
    ) as service(value)
   where jsonb_typeof(service.value) = 'object';

  if coalesce(v_service_limit, 0) < 1 or v_total_uses < 1 then
    raise exception 'plan_service_not_included' using errcode = 'P0001';
  end if;

  if new.status not in ('confirmed', 'completed') or new.attendance_recorded_at is null then
    new.plan_usage_value := 0;
    return new;
  end if;

  select count(*)::integer
    into v_used
    from public.appointments appointment
   where appointment.plan_subscriber_id = v_subscriber.id
     and appointment.service_id = new.service_id
     and appointment.organization_id = new.organization_id
     and appointment.status in ('confirmed', 'completed')
     and appointment.attendance_recorded_at >= v_subscriber.usage_started_at
     and (tg_op <> 'UPDATE' or appointment.id <> new.id);

  if v_used >= v_service_limit then
    raise exception 'plan_usage_exhausted' using errcode = 'P0001';
  end if;

  if v_subscriber.salon_share_percent_snapshot is null then
    new.plan_usage_value := v_plan.price / v_total_uses;
    return new;
  end if;

  select count(*)::integer
    into v_total_used
    from public.appointments appointment
   where appointment.plan_subscriber_id = v_subscriber.id
     and appointment.organization_id = new.organization_id
     and appointment.status in ('confirmed', 'completed')
     and appointment.attendance_recorded_at >= v_subscriber.usage_started_at
     and (tg_op <> 'UPDATE' or appointment.id <> new.id);

  if v_total_used >= v_total_uses then
    raise exception 'plan_usage_exhausted' using errcode = 'P0001';
  end if;

  v_usage_ordinal := v_total_used + 1;
  v_pool_cents := round(
    v_plan.price::numeric * 100
    - round(v_plan.price::numeric * 100 * v_subscriber.salon_share_percent_snapshot / 100)
  );
  v_base_cents := trunc(v_pool_cents / v_total_uses);
  v_remainder_cents := mod(v_pool_cents, v_total_uses);
  new.plan_usage_value := ((
    v_base_cents + case when v_usage_ordinal <= v_remainder_cents then 1 else 0 end
  ) / 100::numeric)::double precision;
  new.service_commission_rate_snapshot := 1;

  return new;
end;
$$;

revoke all on function public.validate_plan_appointment_usage()
  from public, anon, authenticated;
drop trigger if exists appointments_plan_usage_validation on public.appointments;
create trigger appointments_plan_usage_validation
before insert or update of
  client, client_id, organization_id, plan_subscriber_id, service, service_id,
  status, attendance_recorded_at, value, plan_usage_value
on public.appointments
for each row execute function public.validate_plan_appointment_usage();

create or replace function public.validate_appointment_professional_commissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment jsonb;
  v_assignments jsonb;
  v_professional_id text;
  v_assignment_count integer;
  v_distinct_count integer;
  v_manual_total numeric := 0;
  v_commission_base numeric;
  v_expected_total numeric;
  v_plan_salon_share_percent numeric;
begin
  if new.plan_subscriber_id is not null then
    select subscriber.salon_share_percent_snapshot
      into v_plan_salon_share_percent
      from public.subscribers subscriber
      join public.subscription_plans plan
        on plan.id = subscriber.plan_id
       and plan.organization_id = subscriber.organization_id
     where subscriber.id = new.plan_subscriber_id
       and subscriber.organization_id = new.organization_id;
  end if;

  if tg_op = 'INSERT' then
    if new.attendance_recorded_at is null and new.status = 'completed' then
      new.attendance_recorded_at := now();
    end if;
    new.service_commission_rate_snapshot := case
      when new.attendance_recorded_at is null then null
      when v_plan_salon_share_percent is not null then 1
      else 0.5
    end;
  else
    new.service_commission_rate_snapshot := old.service_commission_rate_snapshot;
    if old.attendance_recorded_at is null
       and new.attendance_recorded_at is null
       and old.status is distinct from 'completed'
       and new.status = 'completed' then
      new.attendance_recorded_at := now();
    end if;
    if old.service_commission_rate_snapshot is null
       and old.attendance_recorded_at is null
       and new.attendance_recorded_at is not null then
      new.service_commission_rate_snapshot := case
        when v_plan_salon_share_percent is not null then 1
        else 0.5
      end;
    end if;
  end if;

  v_assignments := coalesce(new.professional_commissions, '[]'::jsonb);
  if jsonb_typeof(v_assignments) <> 'array' then
    raise exception 'manual_commissions_must_be_an_array' using errcode = 'P0001';
  end if;
  new.professional_commissions := v_assignments;
  v_assignment_count := jsonb_array_length(v_assignments);

  if v_assignment_count = 0 then
    return new;
  end if;
  if v_assignment_count < 2 then
    raise exception 'manual_commissions_require_multiple_professionals' using errcode = 'P0001';
  end if;

  select count(distinct value->>'professionalId')::integer
    into v_distinct_count
    from jsonb_array_elements(v_assignments) as assignment(value);
  if v_distinct_count <> v_assignment_count then
    raise exception 'duplicate_manual_commission_professional' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from jsonb_array_elements(v_assignments) as assignment(value)
     where assignment.value->>'professionalId' = new.professional_id
  ) then
    raise exception 'primary_professional_missing_from_manual_commissions' using errcode = 'P0001';
  end if;

  for v_assignment in
    select value from jsonb_array_elements(v_assignments) as assignment(value)
  loop
    v_professional_id := nullif(btrim(v_assignment->>'professionalId'), '');
    if jsonb_typeof(v_assignment) <> 'object'
       or v_professional_id is null
       or coalesce(v_assignment->>'amount', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'invalid_manual_commission_assignment' using errcode = 'P0001';
    end if;

    v_manual_total := v_manual_total + (v_assignment->>'amount')::numeric;

    if not exists (
      select 1
        from public.professionals professional
       where professional.id = v_professional_id
         and professional.organization_id = new.organization_id
         and professional.is_active
    ) then
      raise exception 'manual_commission_professional_not_active' using errcode = 'P0001';
    end if;
  end loop;

  if new.service_commission_rate_snapshot is not null then
    v_commission_base := coalesce(
      nullif(new.plan_usage_value, 0)::numeric,
      new.value::numeric,
      0::numeric
    );
    v_expected_total := round(
      v_commission_base * new.service_commission_rate_snapshot::numeric,
      2
    );
    if round(v_manual_total, 2) <> v_expected_total then
      raise exception 'manual_commissions_must_equal_service_share' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_appointment_professional_commissions()
  from public, anon, authenticated;
drop trigger if exists appointments_manual_commissions_validation on public.appointments;
create trigger appointments_manual_commissions_validation
before insert or update of
  professional_commissions,
  professional_id,
  organization_id,
  value,
  plan_usage_value,
  plan_subscriber_id,
  attendance_recorded_at,
  status,
  service_commission_rate_snapshot
on public.appointments
for each row execute function public.validate_appointment_professional_commissions();

create or replace function public.validate_configured_plan_manual_commission_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_salon_share_percent numeric;
  v_assignment_count integer;
  v_manual_total numeric;
  v_expected_total numeric;
begin
  if tg_op = 'UPDATE' and old.attendance_recorded_at is not null then
    return new;
  end if;

  if new.plan_subscriber_id is null
     or new.status not in ('confirmed', 'completed')
     or new.attendance_recorded_at is null then
    return new;
  end if;

  select subscriber.salon_share_percent_snapshot
    into v_plan_salon_share_percent
    from public.subscribers subscriber
    join public.subscription_plans plan
      on plan.id = subscriber.plan_id
     and plan.organization_id = subscriber.organization_id
   where subscriber.id = new.plan_subscriber_id
     and subscriber.organization_id = new.organization_id;

  if v_plan_salon_share_percent is null then
    return new;
  end if;

  new.service_commission_rate_snapshot := 1;
  v_assignment_count := jsonb_array_length(coalesce(new.professional_commissions, '[]'::jsonb));
  if v_assignment_count <= 1 then
    return new;
  end if;

  select coalesce(sum((assignment.value->>'amount')::numeric), 0)
    into v_manual_total
    from jsonb_array_elements(new.professional_commissions) as assignment(value);
  v_expected_total := round(coalesce(new.plan_usage_value, 0)::numeric, 2);
  if round(v_manual_total, 2) <> v_expected_total then
    raise exception 'plan_manual_commissions_must_equal_professional_pool'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_configured_plan_manual_commission_pool()
  from public, anon, authenticated;
drop trigger if exists zzz_appointments_configured_plan_commission_validation
  on public.appointments;
create trigger zzz_appointments_configured_plan_commission_validation
before insert or update of
  professional_commissions,
  professional_id,
  organization_id,
  plan_subscriber_id,
  plan_usage_value,
  attendance_recorded_at,
  status,
  service_commission_rate_snapshot
on public.appointments
for each row execute function public.validate_configured_plan_manual_commission_pool();

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-03.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

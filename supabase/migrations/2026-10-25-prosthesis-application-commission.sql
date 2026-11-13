begin;

alter table public.products
  add column if not exists is_prosthesis_capillary boolean not null default false;

-- Preserve the existing product classification once, then use only this flag
-- for future appointment cost snapshots.
update public.products
   set is_prosthesis_capillary = true
 where is_prosthesis_capillary = false
   and translate(
     lower(coalesce(name, '') || ' ' || coalesce(category, '')),
     'áàâãéêíóôõúüç',
     'aaaaeeiooouuc'
   ) like any (array['%protese%', '%capilar%']);

alter table public.appointments
  add column if not exists prosthesis_cost_snapshot numeric(12, 2),
  add column if not exists prosthesis_commission_rule_snapshot boolean not null default false;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'appointments_prosthesis_cost_snapshot_nonnegative'
       and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_prosthesis_cost_snapshot_nonnegative
      check (prosthesis_cost_snapshot is null or prosthesis_cost_snapshot >= 0);
  end if;
end
$$;

create or replace function public.snapshot_prosthesis_application_commission()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_is_new_attendance boolean;
  v_is_prosthesis_service boolean;
begin
  if tg_op = 'UPDATE' then
    new.prosthesis_commission_rule_snapshot := old.prosthesis_commission_rule_snapshot;
    new.prosthesis_cost_snapshot := old.prosthesis_cost_snapshot;
    if old.prosthesis_commission_rule_snapshot
       or old.attendance_recorded_at is not null
       or old.status = 'completed' then
      return new;
    end if;
    v_is_new_attendance :=
      (old.status is distinct from 'completed' and new.status = 'completed')
      or (old.attendance_recorded_at is null and new.attendance_recorded_at is not null);
  else
    v_is_new_attendance := new.attendance_recorded_at is not null or new.status = 'completed';
  end if;

  if not v_is_new_attendance then
    return new;
  end if;

  if new.attendance_recorded_at is null and new.status = 'completed' then
    new.attendance_recorded_at := now();
  end if;

  select exists (
    select 1
      from public.organization_settings settings
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(settings.payload->'services') = 'array'
            then settings.payload->'services'
          else '[]'::jsonb
        end
      ) as configured(value)
     where settings.organization_id = new.organization_id
       and (
         configured.value->>'id' = new.service_id
         or configured.value->>'name' = new.service
       )
       and configured.value->>'commissionKey' = 'protese'
  ) into v_is_prosthesis_service;

  if not v_is_prosthesis_service then
    v_is_prosthesis_service :=
      translate(lower(new.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%protese%';
  end if;

  if not v_is_prosthesis_service then
    return new;
  end if;

  new.prosthesis_commission_rule_snapshot := true;
  select round(coalesce(sum(
    product.cost::numeric * case
      when coalesce(item.value->>'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
       and (item.value->>'quantity')::numeric > 0
        then (item.value->>'quantity')::numeric
      else 0::numeric
    end
  ), 0), 2)
    into new.prosthesis_cost_snapshot
    from jsonb_array_elements(
      case
        when jsonb_typeof(new.products) = 'array' then new.products
        else '[]'::jsonb
      end
    ) as item(value)
    join public.products product
      on product.id = item.value->>'productId'
     and product.organization_id = new.organization_id
   where product.is_prosthesis_capillary;

  return new;
end;
$$;

revoke all on function public.snapshot_prosthesis_application_commission()
  from public, anon, authenticated;
drop trigger if exists appointments_00_prosthesis_commission_snapshot on public.appointments;
create trigger appointments_00_prosthesis_commission_snapshot
before insert or update of
  status,
  attendance_recorded_at,
  service,
  service_id,
  products,
  organization_id
on public.appointments
for each row execute function public.snapshot_prosthesis_application_commission();

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
  v_professional_name text;
  v_assignment_count integer;
  v_distinct_count integer;
  v_manual_total numeric := 0;
  v_commission_base numeric;
  v_expected_total numeric;
  v_expected_assignment numeric;
begin
  if tg_op = 'INSERT' then
    if new.attendance_recorded_at is null and new.status = 'completed' then
      new.attendance_recorded_at := now();
    end if;
    new.service_commission_rate_snapshot := case
      when new.attendance_recorded_at is not null then 0.5
      else null
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
      new.service_commission_rate_snapshot := 0.5;
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

    select professional.name
      into v_professional_name
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = new.organization_id
       and professional.is_active;
    if not found then
      raise exception 'manual_commission_professional_not_active' using errcode = 'P0001';
    end if;

    if new.prosthesis_commission_rule_snapshot then
      v_expected_assignment := case
        when lower(btrim(v_professional_name)) = 'marcos macedo'
          then round(greatest(
            new.value::numeric - coalesce(new.prosthesis_cost_snapshot, 0),
            0
          ) * 0.5, 2)
        else 140.00
      end;
      if round((v_assignment->>'amount')::numeric, 2) <> v_expected_assignment then
        raise exception 'prosthesis_commission_amount_mismatch' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  if not new.prosthesis_commission_rule_snapshot
     and new.service_commission_rate_snapshot is not null then
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

do $$
begin
  if to_regprocedure('public.get_my_financial_earnings_before_prosthesis_rule(date,date,text)') is null then
    execute 'alter function public.get_my_financial_earnings(date, date, text) rename to get_my_financial_earnings_before_prosthesis_rule';
  end if;
  if to_regprocedure('public.get_my_manual_appointment_commissions_before_prosthesis_rule(date,date,text)') is null then
    execute 'alter function public.get_my_manual_appointment_commissions(date, date, text) rename to get_my_manual_appointment_commissions_before_prosthesis_rule';
  end if;
end
$$;

revoke all on function public.get_my_financial_earnings_before_prosthesis_rule(date, date, text)
  from public, anon, authenticated;
revoke all on function public.get_my_manual_appointment_commissions_before_prosthesis_rule(date, date, text)
  from public, anon, authenticated;

create or replace function public.get_my_financial_earnings(
  p_start_date date,
  p_end_date date,
  p_professional_id text default null
)
returns table (
  entry_id text,
  entry_date date,
  kind text,
  source text,
  attribution text,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_professional_id text;
begin
  v_organization_id := public.current_organization_id();
  if public.is_manager() then
    v_professional_id := coalesce(p_professional_id, public.current_professional_id());
  else
    v_professional_id := public.current_professional_id();
  end if;

  return query
  with base_rows as materialized (
    select *
      from public.get_my_financial_earnings_before_prosthesis_rule(
        p_start_date, p_end_date, p_professional_id
      )
  ),
  adjusted_rows as (
    select
      base.entry_id,
      base.entry_date,
      base.kind,
      base.source,
      base.attribution,
      case
        when base.entry_id like '%:performer'
         and appointment.prosthesis_commission_rule_snapshot
          then case
            when lower(btrim(performer.name)) = 'marcos macedo'
              then round(greatest(
                appointment.value::numeric - coalesce(appointment.prosthesis_cost_snapshot, 0),
                0
              ) * 0.5, 2)
            else 140.00
          end
        else base.amount
      end as amount
    from base_rows base
    left join public.appointments appointment
      on appointment.id = split_part(base.entry_id, ':', 1)
    left join public.professionals performer
      on performer.id = appointment.professional_id
     and performer.organization_id = appointment.organization_id
    where not (
      base.entry_id like '%:performer'
      and (
        coalesce(jsonb_array_length(appointment.professional_commissions), 0) > 1
        or appointment.prosthesis_commission_rule_snapshot
      )
    )
  ),
  special_single_performer_rows as (
    select
      appointment.id || ':performer' as entry_id,
      appointment.date::date as entry_date,
      'commission'::text as kind,
      'Comissão por aplicação de prótese capilar'::text as source,
      'Atendimento'::text as attribution,
      case
        when lower(btrim(performer.name)) = 'marcos macedo'
          then round(greatest(
            appointment.value::numeric - coalesce(appointment.prosthesis_cost_snapshot, 0),
            0
          ) * 0.5, 2)
        else 140.00
      end as amount
    from public.appointments appointment
    join public.professionals performer
      on performer.id = appointment.professional_id
     and performer.organization_id = appointment.organization_id
    where appointment.organization_id = v_organization_id
      and performer.id = v_professional_id
      and appointment.date::date between p_start_date and p_end_date
      and appointment.status in ('confirmed', 'completed')
      and appointment.attendance_recorded_at is not null
      and appointment.prosthesis_commission_rule_snapshot
      and coalesce(jsonb_array_length(appointment.professional_commissions), 0) <= 1
  )
  select * from adjusted_rows
  union all
  select * from special_single_performer_rows
  where amount > 0;
end;
$$;

create or replace function public.get_my_manual_appointment_commissions(
  p_start_date date,
  p_end_date date,
  p_professional_id text default null
)
returns table (
  entry_id text,
  entry_date date,
  kind text,
  source text,
  attribution text,
  amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    base.entry_id,
    base.entry_date,
    base.kind,
    case
      when appointment.prosthesis_commission_rule_snapshot
        then 'Comissão por aplicação de prótese capilar'
      else base.source
    end as source,
    base.attribution,
    case
      when appointment.prosthesis_commission_rule_snapshot
       and lower(btrim(assigned_professional.name)) = 'marcos macedo'
        then round(greatest(
          appointment.value::numeric - coalesce(appointment.prosthesis_cost_snapshot, 0),
          0
        ) * 0.5, 2)
      when appointment.prosthesis_commission_rule_snapshot then 140.00
      else base.amount
    end as amount
  from public.get_my_manual_appointment_commissions_before_prosthesis_rule(
    p_start_date, p_end_date, p_professional_id
  ) base
  left join public.appointments appointment
    on appointment.id = split_part(base.entry_id, ':', 1)
  left join public.professionals assigned_professional
    on assigned_professional.id = split_part(base.entry_id, ':', 3)
   and assigned_professional.organization_id = appointment.organization_id;
end;
$$;

revoke all on function public.get_my_financial_earnings(date, date, text)
  from public, anon;
grant execute on function public.get_my_financial_earnings(date, date, text)
  to authenticated;
revoke all on function public.get_my_manual_appointment_commissions(date, date, text)
  from public, anon;
grant execute on function public.get_my_manual_appointment_commissions(date, date, text)
  to authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-25.2')
on conflict (key) do update
  set value = case
        when public.schema_metadata.value < excluded.value then excluded.value
        else public.schema_metadata.value
      end,
      updated_at = now();

notify pgrst, 'reload schema';

commit;

begin;

-- The RETURNS TABLE output field "amount" is also a PL/pgSQL variable.
-- Qualify the query column to avoid an ambiguous-column error at runtime.
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
  where special_single_performer_rows.amount > 0;
end;
$$;

revoke all on function public.get_my_financial_earnings(date, date, text)
  from public, anon;
grant execute on function public.get_my_financial_earnings(date, date, text)
  to authenticated;

-- Advance the app marker only when this project already has the preceding
-- schema version. Older production projects can receive the RPC fix without
-- being marked as if unrelated schema updates had also been applied.
update public.schema_metadata
   set value = '2026-11-12.2',
       updated_at = now()
 where key = 'app_schema_version'
   and value = '2026-11-12.1';

notify pgrst, 'reload schema';

commit;

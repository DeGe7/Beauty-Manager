begin;

create table if not exists public.appointment_deletion_archive (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id text not null,
  deleted_at timestamptz not null default clock_timestamp(),
  deleted_by uuid,
  deleted_by_role text,
  appointment_data jsonb not null
);

create index if not exists appointment_deletion_archive_org_deleted_at_idx
  on public.appointment_deletion_archive (organization_id, deleted_at desc);

alter table public.appointment_deletion_archive enable row level security;
revoke all on table public.appointment_deletion_archive from public, anon, authenticated;

comment on table public.appointment_deletion_archive is
  'Restricted recovery archive for appointments removed from the live table.';

create or replace function public.archive_deleted_appointment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.appointment_deletion_archive (
    organization_id,
    appointment_id,
    deleted_by,
    deleted_by_role,
    appointment_data
  )
  values (
    old.organization_id,
    old.id,
    auth.uid(),
    public.current_user_role(),
    to_jsonb(old)
  );

  return old;
end;
$$;

revoke all on function public.archive_deleted_appointment()
  from public, anon, authenticated;

drop trigger if exists appointments_archive_delete on public.appointments;
create trigger appointments_archive_delete
after delete on public.appointments
for each row execute function public.archive_deleted_appointment();

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-24.2')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

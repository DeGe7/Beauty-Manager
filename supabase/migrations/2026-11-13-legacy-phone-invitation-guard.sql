begin;

create or replace function public.enforce_email_only_invitation_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.phone is not null
     and old.accepted_at is null
     and new.accepted_at is not null then
    raise exception 'phone invitations are disabled';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_email_only_invitation_acceptance()
  from public, anon, authenticated;

drop trigger if exists organization_invitations_email_only_acceptance
  on public.organization_invitations;
create trigger organization_invitations_email_only_acceptance
before update of accepted_at on public.organization_invitations
for each row
execute function public.enforce_email_only_invitation_acceptance();

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-13.4')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

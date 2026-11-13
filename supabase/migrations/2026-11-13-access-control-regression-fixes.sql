begin;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() = any(array['gestor', 'dev-admin']),
    false
  );
$$;

revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

-- Retired objects may remain in a project upgraded from an older schema even
-- though they are absent from the canonical schema source.
drop function if exists public.create_organization_invitation_by_phone(text, text, integer);
drop table if exists public.chatwoot_integrations cascade;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-13.3')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

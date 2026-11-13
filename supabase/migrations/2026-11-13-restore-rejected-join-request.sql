begin;

alter table public.organization_join_requests
  add column if not exists restored_at timestamptz;

alter table public.organization_join_request_events
  drop constraint if exists organization_join_request_events_event_type_check;

alter table public.organization_join_request_events
  add constraint organization_join_request_events_event_type_check
  check (
    event_type in (
      'request_submitted',
      'request_approved',
      'request_rejected',
      'request_archived',
      'request_restored',
      'request_reopened',
      'invitation_created',
      'invitation_email_status',
      'invitation_revoked',
      'invitation_accepted'
    )
  );

create or replace function public.restore_rejected_organization_join_request(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_restored_at timestamptz;
  v_actor_name text;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'only managers can restore rejected access requests';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    raise exception 'active organization required';
  end if;

  update public.organization_join_requests as request
     set hidden_at = null,
         restored_at = clock_timestamp()
   where request.id = p_request_id
     and request.organization_id = v_organization_id
     and request.status = 'rejected'
     and request.hidden_at is not null
  returning request.restored_at into v_restored_at;

  if not found then
    raise exception 'manually archived rejected access request not found';
  end if;

  select nullif(btrim(profile.full_name), '')
    into v_actor_name
    from public.profiles as profile
   where profile.id = auth.uid();

  insert into public.organization_join_request_events (
    event_key,
    organization_id,
    request_id,
    event_type,
    actor_id,
    actor_name,
    metadata,
    created_at
  ) values (
    'request:' || p_request_id::text || ':restored:' ||
      to_char(v_restored_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
    v_organization_id,
    p_request_id,
    'request_restored',
    auth.uid(),
    v_actor_name,
    jsonb_build_object('restored_at', v_restored_at),
    v_restored_at
  )
  on conflict (event_key) do nothing;

  return v_restored_at;
end;
$$;

revoke all on function public.restore_rejected_organization_join_request(uuid)
  from public, anon, authenticated;
grant execute on function public.restore_rejected_organization_join_request(uuid)
  to authenticated;

-- Only advance projects whose preceding schema version is known to be complete.
update public.schema_metadata
   set value = '2026-11-13.1',
       updated_at = now()
 where key = 'app_schema_version'
   and value = '2026-11-12.2';

notify pgrst, 'reload schema';

commit;

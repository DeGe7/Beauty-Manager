begin;

create or replace function public.record_organization_join_request_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type_value text;
  event_key_value text;
  actor_id_value uuid;
  actor_name_value text;
  event_time_value timestamptz;
  event_metadata_value jsonb;
begin
  if tg_op = 'INSERT' then
    event_type_value := 'request_submitted';
    event_key_value := 'request:' || new.id::text || ':submitted';
    actor_id_value := new.user_id;
    actor_name_value := new.applicant_name;
    event_time_value := new.requested_at;
    event_metadata_value := '{}'::jsonb;
  elsif old.status is distinct from new.status then
    event_type_value := case
      when new.status = 'approved' then 'request_approved'
      when new.status = 'rejected' then 'request_rejected'
      when new.status = 'pending' then 'request_reopened'
      else null
    end;

    if event_type_value is null then
      return new;
    end if;

    actor_id_value := coalesce(auth.uid(), new.reviewed_by);
    -- now() is fixed for the transaction, so repeated review transitions in
    -- one transaction would otherwise collide on the unique event key.
    event_time_value := clock_timestamp();
    event_key_value := format(
      'request:%s:%s:%s',
      new.id,
      event_type_value,
      event_time_value::text
    );
    event_metadata_value := jsonb_strip_nulls(jsonb_build_object(
      'previous_status', old.status,
      'new_status', new.status,
      'professional_id', new.professional_id
    ));

    if actor_id_value is not null then
      select coalesce(
        nullif(btrim(profile.full_name), ''),
        nullif(btrim(profile.email), ''),
        'Usuário'
      )
        into actor_name_value
        from public.profiles as profile
       where profile.id = actor_id_value;
    end if;
    actor_name_value := coalesce(actor_name_value, 'Sistema');
  else
    return new;
  end if;

  insert into public.organization_join_request_events (
    event_key, organization_id, request_id, event_type, actor_id, actor_name, metadata, created_at
  )
  values (
    event_key_value,
    new.organization_id,
    new.id,
    event_type_value,
    actor_id_value,
    actor_name_value,
    event_metadata_value,
    event_time_value
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.record_organization_join_request_event()
  from public, anon, authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-13.5')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;

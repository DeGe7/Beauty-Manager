-- Multi-salon SaaS: one account may belong to multiple isolated organizations.
-- Apply only after reviewing the complete migration.
begin;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.default_organization_id
        from public.profiles p
       where p.id = auth.uid()
         and exists (
           select 1
             from public.organization_members m
            where m.organization_id = p.default_organization_id
              and m.user_id = auth.uid()
              and m.is_active
         )
    ),
    (
      select m.organization_id
        from public.organization_members m
       where m.user_id = auth.uid()
         and m.is_active
       order by m.created_at, m.organization_id
       limit 1
    )
  );
$$;

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
for select to authenticated using (
  exists (
    select 1
      from public.organization_members m
     where m.organization_id = organizations.id
       and m.user_id = auth.uid()
       and m.is_active
  )
);

create or replace function public.list_my_organizations()
returns table (
  organization_id uuid,
  organization_name text,
  role text,
  professional_id text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id, o.name, m.role, m.professional_id
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = auth.uid()
     and m.is_active
   order by m.created_at, m.organization_id;
$$;
revoke all on function public.list_my_organizations() from public, anon;
grant execute on function public.list_my_organizations() to authenticated;

create or replace function public.switch_current_organization(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_organization_id is null or not exists (
    select 1
      from public.organization_members m
     where m.organization_id = p_organization_id
       and m.user_id = auth.uid()
       and m.is_active
  ) then
    raise exception 'active organization membership required';
  end if;

  perform set_config('barber_manager.allow_context_update', 'on', true);
  update public.profiles
     set default_organization_id = p_organization_id,
         updated_at = now()
   where id = auth.uid();
  if not found then
    raise exception 'profile not found';
  end if;
  return p_organization_id;
end;
$$;
revoke all on function public.switch_current_organization(uuid) from public, anon;
grant execute on function public.switch_current_organization(uuid) to authenticated;

create or replace function public.bootstrap_organization(
  p_name text,
  p_cnpj text default '',
  p_address text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_organization_id uuid;
  creation_enabled boolean;
  has_active_membership boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select coalesce((
    select enabled
      from public.deployment_settings
     where setting_key = 'organization_creation_enabled'
  ), false) into creation_enabled;
  if not creation_enabled then
    raise exception 'organization creation is disabled for this deployment';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('organization-create:' || auth.uid()::text, 0)
  );

  select exists (
    select 1
      from public.organization_members m
     where m.user_id = auth.uid()
       and m.is_active
  ) into has_active_membership;

  if has_active_membership and public.current_user_role() not in ('gestor', 'dev-admin') then
    raise exception 'only an organization manager can create another organization';
  end if;

  if not has_active_membership and exists (
    select 1
      from auth.users u
      join public.organization_invitations i
        on (
          (i.email is not null and lower(i.email) = lower(coalesce(u.email, '')))
          or (i.phone is not null and i.phone = u.phone)
        )
     where u.id = auth.uid()
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    raise exception 'accept your pending invitation before creating an organization';
  end if;

  if nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 120 then
    raise exception 'organization name must be between 1 and 120 characters';
  end if;

  insert into public.organizations (name, cnpj, address)
  values (btrim(p_name), coalesce(p_cnpj, ''), coalesce(p_address, ''))
  returning id into new_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_organization_id, auth.uid(), 'gestor');

  perform set_config('barber_manager.allow_context_update', 'on', true);
  update public.profiles
     set default_organization_id = new_organization_id,
         updated_at = now()
   where id = auth.uid();

  insert into public.organization_settings (organization_id, payload)
  values (new_organization_id, '{}'::jsonb);

  return new_organization_id;
end;
$$;
revoke all on function public.bootstrap_organization(text, text, text) from public, anon;
grant execute on function public.bootstrap_organization(text, text, text) to authenticated;

create or replace function public.get_onboarding_options()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  has_active_membership boolean;
  creation_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select exists (
    select 1
      from public.organization_members m
     where m.user_id = auth.uid()
       and m.is_active
  ) into has_active_membership;

  select coalesce((
    select enabled
      from public.deployment_settings
     where setting_key = 'organization_creation_enabled'
  ), false) into creation_enabled;

  return jsonb_build_object(
    'can_create_organization',
      creation_enabled and (
        not has_active_membership
        or public.current_user_role() in ('gestor', 'dev-admin')
      ),
    -- Join requests must come from the organization-specific link shared by
    -- its manager; never guess a tenant from a global organization count.
    'can_request_access', false
  );
end;
$$;
revoke all on function public.get_onboarding_options() from public, anon;
grant execute on function public.get_onboarding_options() to authenticated;

create or replace function public.get_public_organization_name(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
    from public.organizations o
   where o.id = p_organization_id;
$$;
revoke all on function public.get_public_organization_name(uuid) from public;
grant execute on function public.get_public_organization_name(uuid) to anon, authenticated;

create table if not exists public.organization_join_request_rate_limits (
  requester_hash text primary key check (requester_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
create index if not exists organization_join_request_rate_limits_window_idx
  on public.organization_join_request_rate_limits (window_started_at);
alter table public.organization_join_request_rate_limits enable row level security;
revoke all on table public.organization_join_request_rate_limits from public, anon, authenticated;

-- Preserve the email-only request invariant on projects whose schema history
-- did not contain the earlier one-time trigger migration.
create or replace function public.enforce_email_only_join_requests()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.applicant_phone is not null then
      raise exception 'phone access requests are disabled';
    end if;
    if nullif(btrim(coalesce(new.applicant_email, '')), '') is null then
      raise exception 'applicant email is required';
    end if;
  elsif tg_op = 'UPDATE'
     and new.status = 'approved'
     and old.status is distinct from 'approved'
     and nullif(btrim(coalesce(new.applicant_email, '')), '') is null then
    raise exception 'phone access requests must be resubmitted with email';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_email_only_join_requests() from public, anon, authenticated;
drop trigger if exists organization_join_requests_email_only on public.organization_join_requests;
create trigger organization_join_requests_email_only
before insert or update of status on public.organization_join_requests
for each row execute function public.enforce_email_only_join_requests();

drop function if exists public.request_organization_join(text, text, text);
create or replace function public.request_organization_join(
  p_organization_id uuid,
  p_applicant_name text,
  p_applicant_email text default null,
  p_applicant_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_organization_id uuid := p_organization_id;
  normalized_name text;
  normalized_email text;
  normalized_phone text;
  contact_key text;
  request_headers jsonb;
  requester_identity text;
  requester_key_hash text;
  request_limit integer;
  requests_in_window integer;
  window_started_at timestamptz;
  retry_after_seconds integer;
  join_request public.organization_join_requests;
begin
  if target_organization_id is null or not exists (
    select 1 from public.organizations o where o.id = target_organization_id
  ) then
    raise exception 'target organization not found';
  end if;

  if auth.uid() is not null and exists (
    select 1
      from public.organization_members m
     where m.organization_id = target_organization_id
       and m.user_id = auth.uid()
       and m.is_active
  ) then
    raise exception 'account already belongs to this organization';
  end if;

  normalized_name := btrim(coalesce(p_applicant_name, ''));
  normalized_email := lower(nullif(btrim(coalesce(p_applicant_email, '')), ''));
  normalized_phone := nullif(btrim(coalesce(p_applicant_phone, '')), '');

  if length(normalized_name) < 2 or length(normalized_name) > 100 then
    raise exception 'applicant name must be between 2 and 100 characters';
  end if;
  if (normalized_email is null) = (normalized_phone is null) then
    raise exception 'provide exactly one contact method';
  end if;
  if normalized_email is not null and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'valid email is required';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'valid E.164 phone is required';
  end if;

  if exists (
    select 1
      from public.organization_invitations i
     where i.organization_id = target_organization_id
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
       and (
         (normalized_email is not null and lower(i.email) = normalized_email)
         or (normalized_phone is not null and i.phone = normalized_phone)
       )
  ) then
    raise exception 'use the pending invitation for this contact';
  end if;

  if exists (
    select 1
      from public.organization_join_requests r
     where r.organization_id = target_organization_id
       and r.status = 'approved'
       and (
         (normalized_email is not null and lower(r.applicant_email) = normalized_email)
         or (normalized_phone is not null and r.applicant_phone = normalized_phone)
       )
  ) then
    raise exception 'this contact already has an approved access request';
  end if;

  contact_key := coalesce(normalized_email, normalized_phone);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || contact_key, 0));

  select * into join_request
    from public.organization_join_requests r
   where r.organization_id = target_organization_id
     and r.status = 'pending'
     and (
       (normalized_email is not null and lower(r.applicant_email) = normalized_email)
       or (normalized_phone is not null and r.applicant_phone = normalized_phone)
     )
   order by r.requested_at desc
   limit 1;

  if join_request.id is null then
    if (
      select count(*)
        from public.organization_join_requests r
       where r.organization_id = target_organization_id
         and r.requested_at > now() - interval '1 hour'
         and (
           (normalized_email is not null and lower(r.applicant_email) = normalized_email)
           or (normalized_phone is not null and r.applicant_phone = normalized_phone)
         )
    ) >= 3 then
      raise exception 'too many access requests for this contact';
    end if;

    request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
    requester_identity := coalesce(
      nullif(btrim(request_headers ->> 'cf-connecting-ip'), ''),
      nullif(btrim(request_headers ->> 'x-real-ip'), ''),
      nullif(btrim(reverse(split_part(reverse(coalesce(request_headers ->> 'x-forwarded-for', '')), ',', 1))), ''),
      'name:' || lower(regexp_replace(normalized_name, '\s+', ' ', 'g'))
    );
    request_limit := case when requester_identity like 'name:%' then 3 else 10 end;
    requester_key_hash := encode(
      extensions.digest(target_organization_id::text || ':' || requester_identity, 'sha256'),
      'hex'
    );

    delete from public.organization_join_request_rate_limits as expired_limit
     where expired_limit.window_started_at <= now() - interval '1 hour';

    insert into public.organization_join_request_rate_limits as current_limit (
      requester_hash, window_started_at, request_count
    ) values (requester_key_hash, now(), 1)
    on conflict (requester_hash) do update
       set window_started_at = case
             when current_limit.window_started_at <= now() - interval '1 hour' then now()
             else current_limit.window_started_at
           end,
           request_count = case
             when current_limit.window_started_at <= now() - interval '1 hour' then 1
             else least(current_limit.request_count + 1, request_limit + 1)
           end
    returning current_limit.request_count, current_limit.window_started_at
         into requests_in_window, window_started_at;

    if requests_in_window > request_limit then
      retry_after_seconds := greatest(
        1,
        ceil(extract(epoch from window_started_at + interval '1 hour' - now()))::integer
      );
      return jsonb_build_object(
        'rate_limited', true,
        'retry_after_seconds', retry_after_seconds
      );
    end if;

    insert into public.organization_join_requests (
      organization_id, user_id, applicant_name, applicant_email, applicant_phone
    ) values (
      target_organization_id, auth.uid(), normalized_name, normalized_email, normalized_phone
    )
    returning * into join_request;
  end if;

  return jsonb_build_object(
    'id', join_request.id,
    'applicant_name', join_request.applicant_name,
    'applicant_email', join_request.applicant_email,
    'applicant_phone', join_request.applicant_phone,
    'status', join_request.status,
    'professional_id', join_request.professional_id,
    'requested_at', join_request.requested_at,
    'reviewed_at', join_request.reviewed_at
  );
end;
$$;
revoke all on function public.request_organization_join(uuid, text, text, text) from public;
grant execute on function public.request_organization_join(uuid, text, text, text) to anon, authenticated;

create or replace function public.accept_organization_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.organization_invitations;
  current_email text;
  current_phone text;
  current_phone_confirmed boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if nullif(btrim(coalesce(p_token, '')), '') is null then
    raise exception 'invitation token is required';
  end if;

  select *
    into invitation
    from public.organization_invitations
   where token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
   for update;
  if invitation.id is null then raise exception 'invitation not found or invalid'; end if;
  if invitation.revoked_at is not null then raise exception 'invitation was revoked'; end if;
  if invitation.accepted_at is not null then raise exception 'invitation was already used'; end if;
  if invitation.expires_at <= now() then raise exception 'invitation has expired'; end if;

  select lower(email), phone, phone_confirmed_at is not null
    into current_email, current_phone, current_phone_confirmed
    from auth.users
   where id = auth.uid();
  if invitation.phone is not null then
    if current_phone is null or current_phone_confirmed is not true then
      raise exception 'invitation phone not confirmed';
    end if;
    if current_phone <> invitation.phone then raise exception 'this invitation belongs to another phone'; end if;
  elsif current_email is null or current_email <> lower(invitation.email) then
    raise exception 'this invitation belongs to another email';
  end if;
  if exists (
    select 1 from public.organization_members
     where organization_id = invitation.organization_id
       and user_id = auth.uid()
       and is_active
  ) then
    raise exception 'you already belong to this organization';
  end if;
  if exists (
    select 1 from public.organization_members
     where organization_id = invitation.organization_id
       and professional_id = invitation.professional_id
       and is_active
  ) then
    raise exception 'professional is already linked to another account';
  end if;

  insert into public.organization_members (organization_id, user_id, role, professional_id)
  values (invitation.organization_id, auth.uid(), invitation.role, invitation.professional_id);
  perform set_config('barber_manager.allow_context_update', 'on', true);
  update public.profiles
     set default_organization_id = invitation.organization_id,
         updated_at = now()
   where id = auth.uid();
  update public.organization_invitations
     set accepted_at = now(),
         accepted_by = auth.uid()
   where id = invitation.id;

  return jsonb_build_object(
    'organization_id', invitation.organization_id,
    'role', invitation.role,
    'professional_id', invitation.professional_id
  );
end;
$$;
revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

create or replace function public.approve_organization_join_request(
  p_request_id uuid,
  p_professional_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  join_request public.organization_join_requests;
  professional public.professionals;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'only managers can approve access requests';
  end if;

  select * into join_request
    from public.organization_join_requests
   where id = p_request_id
     and organization_id = public.current_organization_id()
     and status = 'pending'
   for update;
  if join_request.id is null then raise exception 'pending access request not found'; end if;

  select * into professional
    from public.professionals
   where id = p_professional_id
     and organization_id = join_request.organization_id
     and is_active
   for update;
  if professional.id is null then raise exception 'active professional profile not found'; end if;

  if join_request.user_id is not null and exists (
    select 1
      from public.organization_members
     where user_id = join_request.user_id
       and organization_id = join_request.organization_id
       and is_active
  ) then
    raise exception 'applicant already belongs to this organization';
  end if;
  if exists (
    select 1
      from public.organization_members
     where organization_id = join_request.organization_id
       and professional_id = professional.id
       and is_active
  ) or exists (
    select 1
      from public.organization_join_requests
     where organization_id = join_request.organization_id
       and professional_id = professional.id
       and status = 'approved'
       and id <> join_request.id
  ) then
    raise exception 'professional profile is already linked or reserved';
  end if;

  update public.organization_join_requests
     set status = 'approved',
         professional_id = professional.id,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = join_request.id;

  return jsonb_build_object(
    'organization_id', join_request.organization_id,
    'professional_id', professional.id,
    'role', professional.role
  );
end;
$$;
revoke all on function public.approve_organization_join_request(uuid, text) from public, anon;
grant execute on function public.approve_organization_join_request(uuid, text) to authenticated;

insert into public.deployment_settings (setting_key, enabled)
values ('organization_creation_enabled', true)
on conflict (setting_key) do update
  set enabled = true, updated_at = now();

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-13.2')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
commit;

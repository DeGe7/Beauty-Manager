 -- Beauty Manager — Supabase source of truth
 -- Execute this script once in the Supabase SQL Editor.
 -- It replaces the temporary Replit/Drizzle model with a tenant-safe model.

 create extension if not exists "pgcrypto";

 -- Updated only after the complete source schema has been applied.
 create table if not exists public.schema_metadata (
   key text primary key,
   value text not null,
   updated_at timestamptz not null default now()
 );

 -- ----------------------------------------------------------------------------
 -- Identity and tenancy
 -- ----------------------------------------------------------------------------

 create table if not exists public.organizations (
   id uuid primary key default gen_random_uuid(),
   name text not null check (btrim(name) <> ''),
   cnpj text not null default '',
   address text not null default '',
   logo_url text,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

  create table if not exists public.deployment_settings (
    setting_key text primary key check (setting_key = 'organization_creation_enabled'),
    enabled boolean not null default false,
    updated_at timestamptz not null default now()
  );

 create table if not exists public.profiles (
   id uuid primary key references auth.users(id) on delete cascade,
   email text not null default '',
   full_name text not null default 'Usuário',
   avatar_url text,
   default_organization_id uuid references public.organizations(id) on delete set null,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.professionals (
   id text primary key default gen_random_uuid()::text,
   name text not null,
   role text not null default 'barbeiro'
     check (role in ('barbeiro', 'manicure', 'vendedor', 'gestor')),
   initials text not null default '',
   color text not null default '#3b82f6',
   is_active boolean not null default true,
   commissions jsonb not null default '{}'::jsonb,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.organization_members (
   organization_id uuid not null references public.organizations(id) on delete cascade,
     user_id uuid references public.profiles(id) on delete set null,
   role text not null check (btrim(role) <> ''),
   professional_id text references public.professionals(id) on delete set null,
   is_active boolean not null default true,
   created_at timestamptz not null default now(),
   granted_by uuid references public.profiles(id) on delete set null,
   granted_by_name text,
   granted_at timestamptz,
   primary key (organization_id, user_id)
 );

 create table if not exists public.organization_invitations (
   id uuid primary key default gen_random_uuid(),
   organization_id uuid not null references public.organizations(id) on delete cascade,
    email text,
    phone text,
   professional_id text references public.professionals(id) on delete set null,
   role text not null check (btrim(role) <> ''),
   token_hash text not null unique,
   expires_at timestamptz not null,
   accepted_at timestamptz,
   accepted_by uuid references public.profiles(id) on delete set null,
   revoked_at timestamptz,
   revoked_by uuid references public.profiles(id) on delete set null,
   revoked_by_name text,
   invited_by uuid not null references public.profiles(id) on delete restrict,
   invited_by_name text,
    resend_email_id text,
    email_delivery_status text check (
      email_delivery_status in ('sent', 'delayed', 'delivered', 'bounced', 'failed', 'complained')
    ),
    email_delivery_updated_at timestamptz,
   created_at timestamptz not null default now(),
    check (
      (email is not null and btrim(email) <> '' and phone is null)
      or (email is null and phone is not null and phone ~ '^\+[1-9][0-9]{7,14}$')
    ),
    check (accepted_at is null or revoked_at is null)
 );
 alter table public.organization_invitations
   add column if not exists resend_email_id text,
   add column if not exists email_delivery_status text,
   add column if not exists email_delivery_updated_at timestamptz;
 alter table public.organization_invitations
   drop constraint if exists organization_invitations_email_delivery_status_check;
 alter table public.organization_invitations
   add constraint organization_invitations_email_delivery_status_check
   check (
     email_delivery_status is null or email_delivery_status in (
       'sent', 'delayed', 'delivered', 'bounced', 'failed', 'complained'
     )
   );

 create or replace function public.record_organization_invitation_creator()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'Usuário')
     into new.invited_by_name
     from public.profiles
    where id = new.invited_by;
   new.invited_by_name := coalesce(new.invited_by_name, 'Usuário');
   return new;
 end;
 $$;
 revoke all on function public.record_organization_invitation_creator() from public, anon, authenticated;
 drop trigger if exists organization_invitations_record_creator on public.organization_invitations;
 create trigger organization_invitations_record_creator
 before insert on public.organization_invitations
 for each row execute function public.record_organization_invitation_creator();

 create or replace function public.record_organization_invitation_revocation()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if old.revoked_at is null and new.revoked_at is not null then
     new.revoked_by := auth.uid();
     if new.revoked_by is not null then
       select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'Usuário')
         into new.revoked_by_name
         from public.profiles
        where id = new.revoked_by;
       new.revoked_by_name := coalesce(new.revoked_by_name, 'Usuário');
     else
       new.revoked_by_name := null;
     end if;
   end if;
   return new;
 end;
 $$;
 revoke all on function public.record_organization_invitation_revocation() from public, anon, authenticated;
 drop trigger if exists organization_invitations_record_revocation on public.organization_invitations;
 create trigger organization_invitations_record_revocation
 before update of revoked_at on public.organization_invitations
 for each row execute function public.record_organization_invitation_revocation();

 create or replace function public.record_organization_member_grant()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if new.role = 'gestor' and new.granted_by is not null then
     new.granted_at := now();
     select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'Usuário')
       into new.granted_by_name
       from public.profiles
      where id = new.granted_by;
     new.granted_by_name := coalesce(new.granted_by_name, 'Usuário');
   end if;
   return new;
 end;
 $$;
 revoke all on function public.record_organization_member_grant() from public, anon, authenticated;
 drop trigger if exists organization_members_record_grant on public.organization_members;
 create trigger organization_members_record_grant
 before insert on public.organization_members
 for each row execute function public.record_organization_member_grant();

  create table if not exists public.organization_join_requests (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    applicant_name text not null check (btrim(applicant_name) <> ''),
    applicant_email text,
    applicant_phone text,
    status text not null default 'pending'
      check (status in ('pending', 'approved', 'rejected')),
    professional_id text references public.professionals(id) on delete set null,
    requested_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete restrict,
    hidden_at timestamptz,
    restored_at timestamptz,
    check (
      (applicant_email is not null and btrim(applicant_email) <> '')
      or (applicant_phone is not null and btrim(applicant_phone) <> '')
    ),
    check (
      status <> 'pending'
      or (professional_id is null and reviewed_at is null and reviewed_by is null)
    )
  );

 create index if not exists professionals_organization_idx
   on public.professionals (organization_id, is_active);
 create index if not exists members_user_idx
   on public.organization_members (user_id, is_active);
 create index if not exists invitations_organization_status_idx
   on public.organization_invitations (organization_id, created_at desc);
 create index if not exists invitations_email_idx
   on public.organization_invitations (lower(email), created_at desc);
 create unique index if not exists invitations_resend_email_id_idx
   on public.organization_invitations (resend_email_id)
   where resend_email_id is not null;
  create index if not exists invitations_phone_idx
    on public.organization_invitations (phone, created_at desc)
    where phone is not null;
  create index if not exists organization_join_requests_organization_status_idx
    on public.organization_join_requests (organization_id, status, requested_at desc);
  create table if not exists public.organization_join_request_rate_limits (
    requester_hash text primary key check (requester_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz not null,
    request_count integer not null check (request_count >= 0)
  );
  create index if not exists organization_join_request_rate_limits_window_idx
    on public.organization_join_request_rate_limits (window_started_at);

 create table if not exists public.communication_sends (
   id uuid primary key default gen_random_uuid(),
   organization_id uuid not null references public.organizations(id) on delete cascade,
   channel text not null check (channel in ('whatsapp', 'email')),
   kind text not null check (kind in ('campaign', 'invitation')),
   campaign_id text,
   campaign_label text,
   recipient_id text,
   recipient_name text not null check (btrim(recipient_name) <> ''),
   recipient_address text not null check (btrim(recipient_address) <> ''),
   message text not null check (btrim(message) <> ''),
   status text not null check (status in ('initiated', 'failed')),
   failure_reason text,
   consented_at timestamptz not null default now(),
   sent_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
   created_at timestamptz not null default now()
 );

 create index if not exists communication_sends_organization_created_idx
   on public.communication_sends (organization_id, created_at desc);
 create index if not exists communication_sends_recipient_idx
   on public.communication_sends (organization_id, recipient_id, created_at desc);

 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array['professionals', 'organization_members', 'organization_invitations'] loop
     execute format('alter table public.%I drop constraint if exists %I', table_name, table_name || '_role_check');
     execute format('alter table public.%I drop constraint if exists %I', table_name, table_name || '_role_not_blank');
     execute format('alter table public.%I add constraint %I check (btrim(role) <> '''')', table_name, table_name || '_role_not_blank');
   end loop;
 end;
 $$;

 create or replace function public.current_organization_id()
 returns uuid
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select coalesce(
     (select default_organization_id from public.profiles where id = auth.uid()),
     (select organization_id
        from public.organization_members
       where user_id = auth.uid() and is_active
       order by created_at
       limit 1)
   );
 $$;

 create or replace function public.current_user_role()
 returns text
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select role
     from public.organization_members
    where user_id = auth.uid()
      and organization_id = public.current_organization_id()
      and is_active
    limit 1;
 $$;

 create or replace function public.current_professional_id()
 returns text
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select professional_id
     from public.organization_members
    where user_id = auth.uid()
      and organization_id = public.current_organization_id()
      and is_active
      and (
        professional_id is null
        or exists (
          select 1
            from public.professionals
           where professionals.id = organization_members.professional_id
             and professionals.organization_id = organization_members.organization_id
        )
      )
    limit 1;
 $$;

 create or replace function public.is_current_organization_professional(target_professional_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select (target_professional_id is null and public.current_user_role() in ('gestor', 'dev-admin'))
     or exists (
       select 1
         from public.professionals
        where id = target_professional_id
          and organization_id = public.current_organization_id()
     );
 $$;

 create or replace function public.is_manager()
 returns boolean
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select public.current_user_role() = any(array['gestor', 'dev-admin']);
 $$;

  create or replace function public.list_professional_account_emails()
  returns table (
    professional_id text,
    email text
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
  declare
    v_organization_id uuid;
  begin
    if auth.uid() is null then
      raise exception 'authentication required'
        using errcode = '28000';
    end if;

    v_organization_id := public.current_organization_id();

    if v_organization_id is null or not public.is_manager() then
      raise exception 'manager access required'
        using errcode = '42501';
    end if;

    return query
    select m.professional_id, u.email::text
      from public.organization_members as m
      join auth.users as u on u.id = m.user_id
     where m.organization_id = v_organization_id
       and m.is_active = true
       and m.professional_id is not null
       and nullif(btrim(u.email), '') is not null
     order by m.professional_id;
  end;
  $function$;

 create or replace function public.has_any_role(allowed_roles text[])
 returns boolean
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select public.current_user_role() = any(allowed_roles);
 $$;

 -- ----------------------------------------------------------------------------
 -- Business data
 -- ----------------------------------------------------------------------------

 create table if not exists public.organization_settings (
   organization_id uuid primary key references public.organizations(id) on delete cascade,
   payload jsonb not null default '{}'::jsonb,
   updated_at timestamptz not null default now()
 );

 create or replace function public.default_service_catalog()
 returns jsonb
 language sql
 immutable
 set search_path = public, pg_temp
 as $$
   select jsonb_build_array(
     jsonb_build_object('id', 'service-barbearia', 'name', 'Barbearia', 'category', 'Barbearia', 'price', 0, 'duration', 30, 'commissionKey', 'barbearia', 'isActive', true, 'sortOrder', 1),
     jsonb_build_object('id', 'service-manutencao', 'name', 'Manutenção', 'category', 'Barbearia', 'price', 0, 'duration', 30, 'commissionKey', 'manutencao', 'isActive', true, 'sortOrder', 2),
     jsonb_build_object('id', 'service-manicure', 'name', 'Manicure', 'category', 'Salão de Beleza', 'price', 0, 'duration', 60, 'commissionKey', 'manicure', 'isActive', true, 'sortOrder', 3),
     jsonb_build_object('id', 'service-protese', 'name', 'Prótese Capilar', 'category', 'Prótese', 'price', 0, 'duration', 120, 'commissionKey', 'protese', 'isActive', true, 'sortOrder', 4),
     jsonb_build_object('id', 'service-mentoria', 'name', 'Mentoria', 'category', 'Prótese', 'price', 0, 'duration', 120, 'commissionKey', 'mentoria', 'isActive', true, 'sortOrder', 5)
   );
 $$;

 create or replace function public.ensure_default_service_catalog()
 returns trigger
 language plpgsql
 security definer
 set search_path = public, pg_temp
 as $$
 begin
   if (
     case
       when jsonb_typeof(coalesce(new.payload, '{}'::jsonb)->'services') = 'array'
         then jsonb_array_length(new.payload->'services') = 0
       else true
     end
   ) then
     new.payload := jsonb_set(
       coalesce(new.payload, '{}'::jsonb),
       '{services}',
       public.default_service_catalog(),
       true
     );
   end if;
   return new;
 end;
 $$;

 revoke all on function public.default_service_catalog() from public, anon, authenticated;
 revoke all on function public.ensure_default_service_catalog() from public, anon, authenticated;

 drop trigger if exists organization_settings_default_services on public.organization_settings;
 create trigger organization_settings_default_services
 before insert or update of payload on public.organization_settings
 for each row execute function public.ensure_default_service_catalog();

 create table if not exists public.appointments (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   time text not null,
   client text not null,
   client_phone text,
   client_id text,
   professional_id text references public.professionals(id) on delete set null,
   seller_professional_id text references public.professionals(id) on delete set null,
   seller_is_company boolean not null default false,
   service text not null,
    service_description text,
     service_id text,
     plan_subscriber_id text,
     plan_usage_value double precision not null default 0 check (plan_usage_value >= 0),
     professional_commissions jsonb not null default '[]'::jsonb,
    service_commission_rate_snapshot numeric(5, 4),
   duration integer not null default 30 check (duration > 0),
   status text not null default 'pending'
     check (status in ('confirmed', 'pending', 'checked_in', 'completed', 'no_show', 'cancelled')),
   checked_in_at text,
   completed_at text,
   value double precision not null default 0 check (value >= 0),
   tip double precision not null default 0 check (tip >= 0),
   products jsonb not null default '[]'::jsonb,
   pay_method text not null default 'pix',
   payment_splits jsonb not null default '[]'::jsonb,
   notes text,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   attendance_recorded_at timestamptz,
   updated_at timestamptz not null default now(),
   constraint appointments_seller_company_check
     check (not seller_is_company or seller_professional_id is null)
 );

 -- Persist sales attribution separately from the professional who performed the service.
 -- Existing appointments remain unchanged and default to a non-company, unattributed sale.
 alter table public.appointments
   add column if not exists seller_professional_id text,
    add column if not exists seller_is_company boolean not null default false,
    add column if not exists service_description text;

 do $$
 begin
   if not exists (
     select 1 from pg_constraint
      where conname = 'appointments_seller_company_check'
        and conrelid = 'public.appointments'::regclass
   ) then
     alter table public.appointments
       add constraint appointments_seller_company_check
       check (not seller_is_company or seller_professional_id is null);
   end if;
 end
 $$;

 create or replace function public.validate_appointment_attribution()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if new.professional_id is not null and not exists (
     select 1 from public.professionals
      where id = new.professional_id
        and organization_id = new.organization_id
   ) then
     raise exception 'appointment professional must belong to the appointment organization';
   end if;

   if new.seller_professional_id is not null and not exists (
     select 1 from public.professionals
      where id = new.seller_professional_id
        and organization_id = new.organization_id
   ) then
     raise exception 'appointment seller must belong to the appointment organization';
   end if;

   if new.seller_is_company and new.seller_professional_id is not null then
     raise exception 'company-attributed appointments cannot have a professional seller';
   end if;
   return new;
 end;
 $$;
 revoke all on function public.validate_appointment_attribution() from public, anon, authenticated;
 drop trigger if exists appointments_validate_attribution on public.appointments;
 create trigger appointments_validate_attribution
 before insert or update of professional_id, seller_professional_id, seller_is_company, organization_id
 on public.appointments
 for each row execute function public.validate_appointment_attribution();

 create table if not exists public.blocks (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   professional_id text references public.professionals(id) on delete set null,
   slots jsonb not null default '[]'::jsonb,
   reason text not null default '',
   notes text,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.clients (
   id text primary key default gen_random_uuid()::text,
   name text not null,
   email text not null default '',
   whatsapp text not null default '',
   birthday text,
   source text,
   source_other text,
   interest text not null default 'barbearia'
     check (interest in ('barbearia', 'salao', 'protese')),
   created_at timestamptz not null default now(),
   visits jsonb not null default '[]'::jsonb,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   updated_at timestamptz not null default now()
 );

  do $$
  begin
    if not exists (
      select 1
        from pg_constraint
       where conname = 'appointments_client_id_fkey'
         and conrelid = 'public.appointments'::regclass
    ) then
      alter table public.appointments
        add constraint appointments_client_id_fkey
        foreign key (client_id) references public.clients(id) on delete set null;
    end if;
  end
  $$;

  create index if not exists appointments_client_id_idx
    on public.appointments (client_id)
    where client_id is not null;

 create table if not exists public.products (
   id text primary key default gen_random_uuid()::text,
   name text not null,
   category text not null default '',
   price double precision not null default 0 check (price >= 0),
   cost double precision not null default 0 check (cost >= 0),
   stock integer not null default 0 check (stock >= 0),
   min_stock integer not null default 0 check (min_stock >= 0),
   is_active boolean not null default true,
   is_prosthesis_capillary boolean not null default false,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.expenses (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   description text not null,
   amount double precision not null default 0 check (amount >= 0),
   category text not null default 'Outros',
   payment_method text check (payment_method in ('debito', 'credito', 'pix', 'dinheiro')),
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now()
 );

 alter table public.expenses
   add column if not exists payment_method text;

 do $$
 begin
   if not exists (
     select 1
     from pg_constraint
     where conname = 'expenses_payment_method_check'
       and conrelid = 'public.expenses'::regclass
   ) then
     alter table public.expenses
       add constraint expenses_payment_method_check
       check (payment_method in ('debito', 'credito', 'pix', 'dinheiro'));
   end if;
 end $$;

 create table if not exists public.incomes (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   description text not null,
   amount double precision not null default 0 check (amount >= 0),
    payment_method text check (payment_method in ('debito', 'credito', 'pix', 'dinheiro')),
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now()
 );

  alter table public.incomes
    add column if not exists payment_method text;

  do $$
  begin
    if not exists (
      select 1 from pg_constraint
      where conname = 'incomes_payment_method_check'
        and conrelid = 'public.incomes'::regclass
    ) then
      alter table public.incomes
        add constraint incomes_payment_method_check
        check (payment_method in ('debito', 'credito', 'pix', 'dinheiro'));
    end if;
  end $$;

  create table if not exists public.product_sales (
    id text primary key default gen_random_uuid()::text,
    date text not null,
    client_id text references public.clients(id) on delete set null,
    appointment_id text references public.appointments(id) on delete set null,
    payment_method text not null
      check (payment_method in ('debito', 'credito', 'pix', 'dinheiro')),
    items jsonb not null
      check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
    total double precision not null check (total >= 0),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    reversal_date text check (reversal_date is null or reversal_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
    reversal_reason text check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 500),
    reversed_at timestamptz,
    reversed_by uuid references public.profiles(id) on delete set null
  );

  alter table public.product_sales
    add column if not exists reversal_date text,
    add column if not exists reversal_reason text,
    add column if not exists reversed_at timestamptz,
    add column if not exists reversed_by uuid references public.profiles(id) on delete set null;

  do $$
  begin
    if not exists (
      select 1 from pg_constraint
       where conname = 'product_sales_reversal_date_check'
         and conrelid = 'public.product_sales'::regclass
    ) then
      alter table public.product_sales
        add constraint product_sales_reversal_date_check
        check (reversal_date is null or reversal_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    end if;
    if not exists (
      select 1 from pg_constraint
       where conname = 'product_sales_reversal_reason_check'
         and conrelid = 'public.product_sales'::regclass
    ) then
      alter table public.product_sales
        add constraint product_sales_reversal_reason_check
        check (reversal_reason is null or length(btrim(reversal_reason)) between 3 and 500);
    end if;
    if not exists (
      select 1 from pg_constraint
       where conname = 'product_sales_reversal_state_check'
         and conrelid = 'public.product_sales'::regclass
    ) then
      alter table public.product_sales
        add constraint product_sales_reversal_state_check
        check (
          (reversal_date is null and reversal_reason is null and reversed_at is null)
          or (reversal_date is not null and reversal_reason is not null and reversed_at is not null)
        );
    end if;
  end
  $$;

  create table if not exists public.finance_entry_changes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    entry_type text not null check (entry_type in ('income', 'expense')),
    entry_id text not null,
    changed_by uuid references auth.users(id) on delete set null,
    changed_by_name text not null default 'Usuário',
    changed_at timestamptz not null default now(),
    previous_values jsonb not null,
    new_values jsonb not null
  );

 create table if not exists public.prothesis_sales (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   client text not null,
   whatsapp text,
   value double precision not null default 0 check (value >= 0),
   seller_id text references public.professionals(id) on delete set null,
   installments integer not null default 1 check (installments > 0),
   installments_paid integer not null default 0 check (installments_paid >= 0 and installments_paid <= installments),
   pay_method1 text not null default 'pix',
   pay_amount1 double precision not null default 0 check (pay_amount1 >= 0),
   pay_method2 text,
   pay_amount2 double precision check (pay_amount2 is null or pay_amount2 >= 0),
   last_maintenance text,
   notes text,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.mentoria_sessions (
   id text primary key default gen_random_uuid()::text,
   date text not null,
   client text not null,
   seller_id text references public.professionals(id) on delete set null,
   value double precision not null default 0 check (value >= 0),
   duration_hours integer not null default 2 check (duration_hours > 0),
   status text not null default 'scheduled'
     check (status in ('scheduled', 'completed', 'cancelled')),
   notes text,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.subscription_plans (
   id text primary key default gen_random_uuid()::text,
   name text not null,
   price double precision not null default 0 check (price >= 0),
   services jsonb not null default '[]'::jsonb,
   duration text not null default 'Mensal'
     check (duration in ('Mensal', 'Trimestral', 'Semestral', 'Anual')),
    salon_share_percent numeric(5, 2)
      check (salon_share_percent is null or salon_share_percent between 0 and 100),
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.subscribers (
   id text primary key default gen_random_uuid()::text,
   name text not null,
   phone text not null default '',
   plan_id text not null references public.subscription_plans(id) on delete restrict,
   professional_id text references public.professionals(id) on delete set null,
   start_date text not null,
   next_payment text not null,
   status text not null default 'ativo'
     check (status in ('ativo', 'vencido', 'pendente')),
    usage_started_at timestamptz not null default now(),
    salon_share_percent_snapshot numeric(5, 2)
      check (
        salon_share_percent_snapshot is null
        or salon_share_percent_snapshot between 0 and 100
      ),
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

 create table if not exists public.subscription_payments (
   id text primary key default gen_random_uuid()::text,
   subscriber_id text not null references public.subscribers(id) on delete cascade,
   due_date text not null,
   paid_at text,
   amount double precision not null default 0 check (amount >= 0),
   payment_method text check (payment_method in ('debito', 'credito', 'pix', 'dinheiro')),
   status text not null default 'pendente'
     check (status in ('pago', 'pendente', 'vencido')),
    salon_share_percent_snapshot numeric(5, 2)
      check (
        salon_share_percent_snapshot is null
        or salon_share_percent_snapshot between 0 and 100
      ),
   note text,
   organization_id uuid not null references public.organizations(id) on delete cascade,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now(),
   unique (subscriber_id, due_date)
 );

alter table public.subscription_plans
  add column if not exists salon_share_percent numeric(5, 2);
alter table public.subscription_plans
  drop constraint if exists subscription_plans_salon_share_percent_range;
alter table public.subscription_plans
  add constraint subscription_plans_salon_share_percent_range
  check (salon_share_percent is null or salon_share_percent between 0 and 100);

alter table public.subscribers
  add column if not exists salon_share_percent_snapshot numeric(5, 2);
alter table public.subscribers
  drop constraint if exists subscribers_salon_share_snapshot_range;
alter table public.subscribers
  add constraint subscribers_salon_share_snapshot_range
  check (
    salon_share_percent_snapshot is null
    or salon_share_percent_snapshot between 0 and 100
  );

alter table public.subscription_payments
  add column if not exists salon_share_percent_snapshot numeric(5, 2);
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

 insert into public.subscription_payments (subscriber_id, due_date, amount, status, organization_id)
 select s.id, s.next_payment, coalesce(p.price, 0),
        case when s.status = 'vencido' then 'vencido' else 'pendente' end,
        s.organization_id
   from public.subscribers s
   left join public.subscription_plans p on p.id = s.plan_id
  on conflict (subscriber_id, due_date) do nothing;

 create or replace function public.is_current_organization_plan(target_plan_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path = public
 as $$
   select target_plan_id is not null
     and exists (
       select 1
         from public.subscription_plans
        where id = target_plan_id
          and organization_id = public.current_organization_id()
     );
 $$;

 create or replace function public.default_role_permissions(target_role text)
 returns jsonb
 language sql
 immutable
  set search_path = public
 as $$
   select case target_role
       when 'gestor' then '["dashboard","agenda","controle","clientes","profissionais","vendas","produtos","planos","financeiro","comunicacao","configuracoes"]'::jsonb
       when 'dev-admin' then '["dashboard","agenda","controle","clientes","profissionais","vendas","produtos","planos","financeiro","comunicacao","configuracoes"]'::jsonb
       when 'recepcao' then '["dashboard","agenda","controle","clientes","produtos","planos"]'::jsonb
     when 'barbeiro' then '["dashboard","agenda","controle"]'::jsonb
     when 'manicure' then '["dashboard","agenda","controle"]'::jsonb
       when 'vendedor' then '["dashboard","agenda","clientes","vendas"]'::jsonb
     else '["dashboard"]'::jsonb
   end;
 $$;

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

 create index if not exists appointments_organization_date_idx on public.appointments (organization_id, date, time);
 create index if not exists blocks_organization_date_idx on public.blocks (organization_id, date);
 create index if not exists clients_organization_idx on public.clients (organization_id);
 create index if not exists products_organization_idx on public.products (organization_id, is_active);
 create index if not exists expenses_organization_date_idx on public.expenses (organization_id, date);
 create index if not exists incomes_organization_date_idx on public.incomes (organization_id, date);
 create index if not exists product_sales_organization_date_idx on public.product_sales (organization_id, date desc);
  create index if not exists finance_entry_changes_organization_changed_idx
    on public.finance_entry_changes (organization_id, changed_at desc);
  create index if not exists finance_entry_changes_entry_idx
    on public.finance_entry_changes (organization_id, entry_type, entry_id, changed_at desc);
 create index if not exists prothesis_sales_organization_date_idx on public.prothesis_sales (organization_id, date);
 create index if not exists mentoria_organization_date_idx on public.mentoria_sessions (organization_id, date);
 create index if not exists plans_organization_idx on public.subscription_plans (organization_id);
 create index if not exists subscribers_organization_status_idx on public.subscribers (organization_id, status);
 create index if not exists subscription_payments_organization_due_idx
   on public.subscription_payments (organization_id, due_date desc);
 create index if not exists subscription_payments_subscriber_idx
   on public.subscription_payments (subscriber_id, due_date desc);

 -- ----------------------------------------------------------------------------
 -- Triggers and safe RPCs
 -- ----------------------------------------------------------------------------

 create or replace function public.set_updated_at()
 returns trigger
 language plpgsql
 set search_path = public
 as $$
 begin
   new.updated_at = now();
   return new;
 end;
 $$;

 create or replace function public.enforce_attendance_delete_window()
 returns trigger
 language plpgsql
 set search_path = public
 as $$
 declare
   v_attendance_at timestamptz;
   v_is_attendance boolean;
 begin
   if tg_op = 'INSERT' then
     if new.status = 'completed' or new.attendance_recorded_at is not null then
       new.attendance_recorded_at := clock_timestamp();
     else
       new.attendance_recorded_at := null;
     end if;
     return new;
   elsif tg_op = 'UPDATE' then
     if old.attendance_recorded_at is not null then
       new.attendance_recorded_at := old.attendance_recorded_at;
     elsif new.status = 'completed' and old.status is distinct from 'completed' then
       new.attendance_recorded_at := clock_timestamp();
     elsif old.status = 'completed' then
       new.attendance_recorded_at := old.created_at;
     elsif old.status = 'confirmed'
       and (old.date || ' ' || old.time)::timestamp <= timezone('America/Sao_Paulo', clock_timestamp()) then
       new.attendance_recorded_at := old.created_at;
     elsif new.attendance_recorded_at is not null then
       new.attendance_recorded_at := clock_timestamp();
     else
       new.attendance_recorded_at := null;
     end if;
     return new;
   else
     if auth.role() = 'service_role' then
       return old;
     end if;

     v_attendance_at := old.attendance_recorded_at;
     v_is_attendance := v_attendance_at is not null or old.status = 'completed';
     if not v_is_attendance and old.status = 'confirmed' then
       v_is_attendance :=
         (old.date || ' ' || old.time)::timestamp <= timezone('America/Sao_Paulo', clock_timestamp());
     end if;

     if v_is_attendance and not coalesce(public.is_manager(), false) then
       v_attendance_at := coalesce(v_attendance_at, old.created_at);
       if v_attendance_at <= clock_timestamp() - interval '24 hours' then
         raise exception using
           errcode = 'P0001',
           message = 'attendance_delete_window_expired';
       end if;
     end if;

     return old;
   end if;
 end;
 $$;

 revoke all on function public.enforce_attendance_delete_window()
   from public, anon, authenticated;

  create or replace function public.audit_finance_entry_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    actor_name text;
    changed_entry_type text;
    previous_entry_values jsonb;
    new_entry_values jsonb;
  begin
    if auth.uid() is null then
      raise exception 'financial changes require an authenticated actor';
    end if;

    select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'Usuário')
      into actor_name
      from public.profiles
     where id = auth.uid();

    if TG_TABLE_NAME = 'incomes' then
      changed_entry_type := 'income';
      previous_entry_values := jsonb_build_object(
        'date', OLD.date,
        'description', OLD.description,
        'amount', OLD.amount
      );
      new_entry_values := jsonb_build_object(
        'date', NEW.date,
        'description', NEW.description,
        'amount', NEW.amount
      );
    elsif TG_TABLE_NAME = 'expenses' then
      changed_entry_type := 'expense';
      previous_entry_values := jsonb_build_object(
        'date', OLD.date,
        'description', OLD.description,
        'amount', OLD.amount,
         'category', OLD.category,
         'payment_method', OLD.payment_method
      );
      new_entry_values := jsonb_build_object(
        'date', NEW.date,
        'description', NEW.description,
        'amount', NEW.amount,
         'category', NEW.category,
         'payment_method', NEW.payment_method
      );
    else
      raise exception 'unsupported financial audit table: %', TG_TABLE_NAME;
    end if;

    insert into public.finance_entry_changes (
      organization_id,
      entry_type,
      entry_id,
      changed_by,
      changed_by_name,
      previous_values,
      new_values
    )
    values (
      OLD.organization_id,
      changed_entry_type,
      OLD.id,
      auth.uid(),
      coalesce(actor_name, 'Usuário'),
      previous_entry_values,
      new_entry_values
    );

    return NEW;
  end;
  $$;

  revoke all on function public.audit_finance_entry_update() from public;

  drop trigger if exists expenses_finance_audit on public.expenses;
  create trigger expenses_finance_audit
    after update on public.expenses
    for each row
    when (
      old.date is distinct from new.date
      or old.description is distinct from new.description
      or old.amount is distinct from new.amount
      or old.category is distinct from new.category
      or old.payment_method is distinct from new.payment_method
    )
    execute function public.audit_finance_entry_update();

  drop trigger if exists incomes_finance_audit on public.incomes;
  create trigger incomes_finance_audit
    after update on public.incomes
    for each row
    when (
      old.date is distinct from new.date
      or old.description is distinct from new.description
      or old.amount is distinct from new.amount
    )
    execute function public.audit_finance_entry_update();

 create or replace function public.subscription_next_due(base_date text, plan_duration text)
 returns text
 language plpgsql
 immutable
 set search_path = public
 as $$
 declare
   source_date date;
   target_month date;
   month_count integer;
   source_day integer;
   target_last_day integer;
 begin
   if base_date is null or base_date !~ '^\d{4}-\d{2}-\d{2}$' then
     raise exception 'invalid subscription base date';
   end if;
   source_date := base_date::date;
   month_count := case plan_duration
     when 'Trimestral' then 3
     when 'Semestral' then 6
     when 'Anual' then 12
     else 1
   end;
   -- Keep the original day when possible and clamp it to the target month's
   -- last day when the target month is shorter (for example, Jan 31 -> Feb 28).
   target_month := (date_trunc('month', source_date) + make_interval(months => month_count))::date;
   source_day := extract(day from source_date)::integer;
   target_last_day := extract(day from (date_trunc('month', target_month) + interval '1 month - 1 day'))::integer;
   return to_char(target_month + least(source_day, target_last_day) - 1, 'YYYY-MM-DD');
 end;
 $$;

 create or replace function public.subscription_payment_period_after_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   plan_price double precision;
 begin
   select price into plan_price
     from public.subscription_plans
    where id = new.plan_id
      and organization_id = new.organization_id;
   insert into public.subscription_payments (
     subscriber_id, due_date, amount, status, organization_id
   )
  values (
    new.id,
    new.next_payment,
    coalesce(plan_price, 0),
    case when new.status = 'vencido' then 'vencido' else 'pendente' end,
    new.organization_id
  )
   on conflict (subscriber_id, due_date) do nothing;
   return new;
 end;
 $$;

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
   if current_sub.id is null then raise exception 'subscriber not found'; end if;

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
   if plan_duration is null then raise exception 'subscription plan not found'; end if;

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
      -- A confirmation can be retried after the subscriber has already moved
      -- to the next cycle. In that case, keep the current cycle untouched and
      -- return the already-open pending cycle instead of advancing again.
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
        current_sub.id,
        next_due,
        coalesce(plan_price, 0),
        'pendente',
        current_sub.organization_id
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
     'next_payment', case when p_status = 'pago' then to_jsonb(next_payment_row) else null end
   );
 end;
 $$;

 create or replace function public.assign_current_organization()
 returns trigger
 language plpgsql
 security invoker
 set search_path = public
 as $$
 begin
   if new.organization_id is null then
     new.organization_id = public.current_organization_id();
   end if;
   if new.organization_id is null or new.organization_id <> public.current_organization_id() then
     raise exception 'organization_id does not belong to the current user';
   end if;
   return new;
 end;
 $$;

 create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   resolved_name text;
 begin
   resolved_name := coalesce(
     nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
     nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
     nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
     'Usuário'
   );
   insert into public.profiles (id, email, full_name)
   values (new.id, coalesce(new.email, ''), resolved_name)
   on conflict (id) do update
     set email = excluded.email, full_name = excluded.full_name, updated_at = now();
   return new;
 end;
 $$;

 create or replace function public.sync_user_profile()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   update public.profiles
      set email = coalesce(new.email, ''),
          full_name = coalesce(
            nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
            nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
            full_name
          ),
          updated_at = now()
    where id = new.id;
   return new;
 end;
 $$;

 drop trigger if exists auth_user_created on auth.users;
 create trigger auth_user_created
 after insert on auth.users
 for each row execute function public.handle_new_user();

 drop trigger if exists auth_user_profile_updated on auth.users;
 create trigger auth_user_profile_updated
 after update of email, raw_user_meta_data on auth.users
 for each row execute function public.sync_user_profile();

 drop trigger if exists subscribers_payment_period on public.subscribers;
 create trigger subscribers_payment_period
 after insert on public.subscribers
 for each row execute function public.subscription_payment_period_after_insert();

 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array[
     'organizations', 'profiles', 'professionals', 'organization_settings',
     'appointments', 'blocks', 'clients', 'products', 'prothesis_sales',
     'mentoria_sessions', 'subscription_plans', 'subscribers',
       'subscription_payments'
   ] loop
     execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
     execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_updated_at', table_name);
   end loop;
 end;
 $$;

 drop trigger if exists appointments_attendance_delete_window on public.appointments;
 create trigger appointments_attendance_delete_window
 before insert or update or delete on public.appointments
 for each row execute function public.enforce_attendance_delete_window();

 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array[
     'professionals', 'organization_settings', 'appointments', 'blocks',
     'clients', 'products', 'expenses', 'incomes', 'prothesis_sales',
     'mentoria_sessions', 'subscription_plans', 'subscribers',
     'communication_sends'
   ] loop
     execute format('drop trigger if exists %I on public.%I', table_name || '_assign_organization', table_name);
     execute format('create trigger %I before insert or update on public.%I for each row execute function public.assign_current_organization()', table_name || '_assign_organization', table_name);
   end loop;
 end;
 $$;

 create or replace function public.create_or_get_client_by_phone(
   p_id text,
   p_name text,
   p_email text,
   p_whatsapp text,
   p_birthday text,
   p_source text,
   p_source_other text,
   p_interest text,
   p_created_at text,
   p_initial_visit jsonb
 )
 returns public.clients
 language plpgsql
 security invoker
 set search_path = public
 as $$
 declare
   v_organization_id uuid := public.current_organization_id();
   v_phone_digits text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
   v_normalized_phone text;
   v_client public.clients;
 begin
   if auth.uid() is null then
     raise exception 'Faça login para cadastrar clientes.';
   end if;
   if v_organization_id is null then
     raise exception 'Nenhum estabelecimento ativo foi encontrado.';
   end if;
   if not public.has_permission('clientes') then
     raise exception 'Você não tem permissão para cadastrar clientes.';
   end if;
   if p_initial_visit is not null and jsonb_typeof(p_initial_visit) <> 'object' then
     raise exception 'A visita inicial do cliente é inválida.';
   end if;

   v_normalized_phone := case
     when left(v_phone_digits, 2) = '55' and length(v_phone_digits) in (12, 13)
       then substr(v_phone_digits, 3)
     else v_phone_digits
   end;

   if v_normalized_phone <> '' then
     perform pg_advisory_xact_lock(
       hashtextextended(v_organization_id::text || ':' || v_normalized_phone, 0)
     );

     select clients.*
       into v_client
       from public.clients
      where clients.organization_id = v_organization_id
        and case
          when left(regexp_replace(coalesce(clients.whatsapp, ''), '[^0-9]', '', 'g'), 2) = '55'
            and length(regexp_replace(coalesce(clients.whatsapp, ''), '[^0-9]', '', 'g')) in (12, 13)
            then substr(regexp_replace(coalesce(clients.whatsapp, ''), '[^0-9]', '', 'g'), 3)
          else regexp_replace(coalesce(clients.whatsapp, ''), '[^0-9]', '', 'g')
        end = v_normalized_phone
      order by clients.created_at asc, clients.id asc
      limit 1;

     if found then
       if p_initial_visit is not null
         and nullif(p_initial_visit->>'id', '') is not null
         and not exists (
           select 1
             from jsonb_array_elements(coalesce(v_client.visits, '[]'::jsonb)) as existing_visit(value)
            where existing_visit.value->>'id' = p_initial_visit->>'id'
         ) then
         update public.clients as existing_client
            set visits = coalesce(existing_client.visits, '[]'::jsonb) || jsonb_build_array(p_initial_visit)
          where existing_client.id = v_client.id
            and existing_client.organization_id = v_organization_id
         returning existing_client.* into v_client;
       end if;
       return v_client;
     end if;
   end if;

   insert into public.clients (
     id, name, email, whatsapp, birthday, source, source_other,
     interest, created_at, visits, organization_id
   ) values (
     p_id,
     p_name,
     coalesce(p_email, ''),
     coalesce(p_whatsapp, ''),
     p_birthday,
     p_source,
     p_source_other,
     coalesce(p_interest, 'barbearia'),
     coalesce(nullif(p_created_at, '')::timestamptz, now()),
     case when p_initial_visit is null then '[]'::jsonb else jsonb_build_array(p_initial_visit) end,
     v_organization_id
   )
   returning clients.* into v_client;

   return v_client;
 end;
 $$;

 create or replace function public.bootstrap_organization(p_name text, p_cnpj text default '', p_address text default '')
 returns uuid
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   new_organization_id uuid;
    creation_enabled boolean;
 begin
   if auth.uid() is null then raise exception 'authentication required'; end if;
    select coalesce((
      select enabled
        from public.deployment_settings
       where setting_key = 'organization_creation_enabled'
    ), false) into creation_enabled;
    if not creation_enabled then
      raise exception 'organization creation is disabled for this deployment';
    end if;
    lock table public.organizations in exclusive mode;
   if exists (select 1 from public.organization_members where user_id = auth.uid() and is_active) then
     raise exception 'user already belongs to an organization';
   end if;
    if exists (
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
    if exists (select 1 from public.organizations) then
      raise exception 'this application already has an organization';
    end if;
   if nullif(btrim(p_name), '') is null then raise exception 'organization name is required'; end if;
   insert into public.organizations (name, cnpj, address)
   values (btrim(p_name), coalesce(p_cnpj, ''), coalesce(p_address, ''))
   returning id into new_organization_id;
   insert into public.organization_members (organization_id, user_id, role)
   values (new_organization_id, auth.uid(), 'gestor');
   perform set_config('barber_manager.allow_context_update', 'on', true);
   update public.profiles set default_organization_id = new_organization_id, updated_at = now() where id = auth.uid();
   insert into public.organization_settings (organization_id, payload) values (new_organization_id, '{}'::jsonb);
   return new_organization_id;
 end;
 $$;

 create or replace function public.create_organization_invitation(
   p_professional_id text,
   p_email text,
   p_expires_in_days integer default 7
 )
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   invitation_token text;
   normalized_email text;
   invitation_role text;
   invitation_id uuid;
   invitation_expires_at timestamptz;
 begin
   if auth.uid() is null or not public.is_manager() then
     raise exception 'only managers can create invitations';
   end if;
   normalized_email := lower(btrim(coalesce(p_email, '')));
   if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
     raise exception 'valid email is required';
   end if;
   if p_expires_in_days < 1 or p_expires_in_days > 30 then
     raise exception 'invitation expiry must be between 1 and 30 days';
   end if;

   select case when role = 'gestor' then 'gestor' else role end
     into invitation_role
     from public.professionals
    where id = p_professional_id
      and organization_id = public.current_organization_id()
      and is_active;
   if invitation_role is null then
     raise exception 'active professional not found';
   end if;
   if exists (
     select 1
       from public.organization_members
      where organization_id = public.current_organization_id()
        and professional_id = p_professional_id
        and is_active
   ) then
     raise exception 'professional is already linked to an account';
   end if;

   update public.organization_invitations
      set revoked_at = now()
    where organization_id = public.current_organization_id()
      and lower(email) = normalized_email
      and accepted_at is null
      and revoked_at is null;

  invitation_token := encode(extensions.gen_random_bytes(32), 'hex');
   invitation_expires_at := now() + make_interval(days => p_expires_in_days);
   insert into public.organization_invitations (
     organization_id, email, professional_id, role, token_hash, expires_at, invited_by
   )
   values (
     public.current_organization_id(), normalized_email, p_professional_id,
     invitation_role, encode(extensions.digest(invitation_token, 'sha256'), 'hex'),
     invitation_expires_at, auth.uid()
   )
   returning id into invitation_id;

   return jsonb_build_object(
     'id', invitation_id,
     'token', invitation_token,
     'email', normalized_email,
     'professional_id', p_professional_id,
     'role', invitation_role,
     'expires_at', invitation_expires_at
   );
 end;
 $$;

 create or replace function public.create_reception_invitation(
   p_email text,
   p_expires_in_days integer default 7
 )
 returns jsonb
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   invitation_token text;
   normalized_email text;
   invitation_id uuid;
   invitation_expires_at timestamptz;
 begin
   if auth.uid() is null or not public.is_manager() then
     raise exception 'only managers can create invitations';
   end if;
   normalized_email := lower(btrim(coalesce(p_email, '')));
   if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
     raise exception 'valid email is required';
   end if;
   if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
     raise exception 'invitation expiry must be between 1 and 30 days';
   end if;

   update public.organization_invitations
      set revoked_at = now()
    where organization_id = public.current_organization_id()
      and lower(email) = normalized_email
      and accepted_at is null
      and revoked_at is null;

   invitation_token := encode(extensions.gen_random_bytes(32), 'hex');
   invitation_expires_at := now() + make_interval(days => p_expires_in_days);
   insert into public.organization_invitations (
     organization_id, email, professional_id, role, token_hash, expires_at, invited_by
   )
   values (
     public.current_organization_id(), normalized_email, null, 'recepcao',
     encode(extensions.digest(invitation_token, 'sha256'), 'hex'),
     invitation_expires_at, auth.uid()
   )
   returning id into invitation_id;

   return jsonb_build_object(
     'id', invitation_id,
     'token', invitation_token,
     'email', normalized_email,
     'professional_id', null,
     'role', 'recepcao',
     'expires_at', invitation_expires_at
   );
 end;
 $$;

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
   if invitation.id is null then
     raise exception 'invitation not found or invalid';
   end if;
   if invitation.revoked_at is not null then
     raise exception 'invitation was revoked';
   end if;
   if invitation.accepted_at is not null then
     raise exception 'invitation was already used';
   end if;
   if invitation.expires_at <= now() then
     raise exception 'invitation has expired';
   end if;

    select lower(email), phone, phone_confirmed_at is not null
      into current_email, current_phone, current_phone_confirmed
      from auth.users
     where id = auth.uid();
    if invitation.phone is not null then
      if current_phone is null or current_phone_confirmed is not true then
        raise exception 'invitation phone not confirmed';
      end if;
      if current_phone <> invitation.phone then
        raise exception 'this invitation belongs to another phone';
      end if;
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
      where user_id = auth.uid()
        and organization_id <> invitation.organization_id
        and is_active
   ) then
     raise exception 'your account already belongs to another organization';
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
      set default_organization_id = invitation.organization_id, updated_at = now()
    where id = auth.uid();
   update public.organization_invitations
      set accepted_at = now(), accepted_by = auth.uid()
    where id = invitation.id;

   return jsonb_build_object(
     'organization_id', invitation.organization_id,
     'role', invitation.role,
     'professional_id', invitation.professional_id
   );
 end;
 $$;

   create or replace function public.get_public_organization_invitation_info(p_token text)
   returns jsonb
   language plpgsql
   security definer
   set search_path = public
   as $$
   declare
      invitation_id public.organization_invitations.id%type;
      invitation_organization_id public.organization_invitations.organization_id%type;
      invitation_professional_id public.organization_invitations.professional_id%type;
      invitation_revoked_at public.organization_invitations.revoked_at%type;
      invitation_accepted_at public.organization_invitations.accepted_at%type;
      invitation_expires_at public.organization_invitations.expires_at%type;
      invitation_phone public.organization_invitations.phone%type;
      invitation_email public.organization_invitations.email%type;
       invitation_role public.organization_invitations.role%type;
     invitation_status text;
     organization_name text;
     professional_name text;
   begin
     if nullif(btrim(coalesce(p_token, '')), '') is null then
       return jsonb_build_object('valid', false, 'status', 'invalid', 'channel', null);
     end if;

      select i.id,
             i.organization_id,
             i.professional_id,
             i.revoked_at,
             i.accepted_at,
             i.expires_at,
             i.phone,
              i.email,
              i.role
        into invitation_id,
             invitation_organization_id,
             invitation_professional_id,
             invitation_revoked_at,
             invitation_accepted_at,
             invitation_expires_at,
             invitation_phone,
              invitation_email,
              invitation_role
        from public.organization_invitations i
      where i.token_hash = encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
      limit 1;
      if invitation_id is null then
       return jsonb_build_object('valid', false, 'status', 'invalid', 'channel', null);
     end if;

     invitation_status := case
        when invitation_revoked_at is not null then 'revoked'
        when invitation_accepted_at is not null then 'used'
        when invitation_expires_at <= now() then 'expired'
       else 'valid'
     end;
      if invitation_status = 'valid' then
       select o.name into organization_name
         from public.organizations o
        where o.id = invitation_organization_id;
       if invitation_professional_id is not null then
         select p.name into professional_name
           from public.professionals p
          where p.id = invitation_professional_id
            and p.organization_id = invitation_organization_id;
       elsif invitation_role = 'recepcao' then
         professional_name := 'Recepção';
       end if;
      end if;
     return jsonb_build_object(
       'valid', invitation_status = 'valid',
       'status', invitation_status,
        'channel', case when invitation_phone is not null then 'phone' else 'email' end,
        'email', case when invitation_status = 'valid' and invitation_phone is null then invitation_email else null end,
       'organization_name', case when invitation_status = 'valid' then organization_name else null end,
       'professional_name', case when invitation_status = 'valid' then professional_name else null end
     );
   end;
   $$;

  create or replace function public.get_onboarding_options()
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    organization_count integer;
    has_membership boolean;
    creation_enabled boolean;
  begin
    if auth.uid() is null then raise exception 'authentication required'; end if;
    select exists (
      select 1
        from public.organization_members
       where user_id = auth.uid()
         and is_active
    ) into has_membership;
    select count(*) into organization_count from public.organizations;
    select coalesce((
      select enabled
        from public.deployment_settings
       where setting_key = 'organization_creation_enabled'
    ), false) into creation_enabled;

    return jsonb_build_object(
      'can_create_organization', not has_membership and organization_count = 0 and creation_enabled,
      'can_request_access', not has_membership and organization_count = 1
    );
  end;
  $$;

  drop function if exists public.request_organization_join();
  create or replace function public.request_organization_join(
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
    target_organization_id uuid;
    organization_count integer;
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
    if exists (
      select 1
        from public.organization_members
       where user_id = auth.uid()
         and is_active
    ) then
      raise exception 'account already belongs to an organization';
    end if;

    select count(*) into organization_count from public.organizations;
    if organization_count <> 1 then
      raise exception 'there must be exactly one organization to request access';
    end if;
    select id into target_organization_id from public.organizations limit 1;

    normalized_name := btrim(coalesce(p_applicant_name, ''));
    normalized_email := lower(nullif(btrim(coalesce(p_applicant_email, '')), ''));
    normalized_phone := nullif(btrim(coalesce(p_applicant_phone, '')), '');

    if length(normalized_name) < 2 or length(normalized_name) > 100 then
      raise exception 'applicant name must be between 2 and 100 characters';
    end if;
    if (normalized_email is null) = (normalized_phone is null) then
      raise exception 'provide exactly one contact method';
    end if;
    if normalized_email is not null
       and normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'valid email is required';
    end if;
    if normalized_phone is not null
       and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
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
        from public.organization_join_requests
       where organization_id = target_organization_id
         and status = 'approved'
         and (
           (normalized_email is not null and lower(applicant_email) = normalized_email)
           or (normalized_phone is not null and applicant_phone = normalized_phone)
         )
    ) then
      raise exception 'this contact already has an approved access request';
    end if;

    contact_key := coalesce(normalized_email, normalized_phone);
    perform pg_advisory_xact_lock(
      hashtextextended(target_organization_id::text || ':' || contact_key, 0)
    );

    select * into join_request
      from public.organization_join_requests
     where organization_id = target_organization_id
       and status = 'pending'
       and (
         (normalized_email is not null and lower(applicant_email) = normalized_email)
         or (normalized_phone is not null and applicant_phone = normalized_phone)
       )
     order by requested_at desc
     limit 1;

    if join_request.id is null then
      if (
        select count(*)
          from public.organization_join_requests
         where organization_id = target_organization_id
           and requested_at > now() - interval '1 hour'
           and (
             (normalized_email is not null and lower(applicant_email) = normalized_email)
             or (normalized_phone is not null and applicant_phone = normalized_phone)
           )
      ) >= 3 then
        raise exception 'too many access requests for this contact';
      end if;

      request_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      requester_identity := coalesce(
        nullif(btrim(request_headers ->> 'cf-connecting-ip'), ''),
        nullif(btrim(request_headers ->> 'x-real-ip'), ''),
        nullif(
          btrim(reverse(split_part(reverse(coalesce(request_headers ->> 'x-forwarded-for', '')), ',', 1))),
          ''
        ),
        'name:' || lower(regexp_replace(normalized_name, '\s+', ' ', 'g'))
      );
      request_limit := case
        when requester_identity like 'name:%' then 3
        else 10
      end;
      requester_key_hash := encode(
        extensions.digest(
          target_organization_id::text || ':' || requester_identity,
          'sha256'
        ),
        'hex'
      );

      -- Expired keys are removed as new requests arrive; only active hourly
      -- windows remain in this table.
      delete from public.organization_join_request_rate_limits as expired_limit
       where expired_limit.window_started_at <= now() - interval '1 hour';

      insert into public.organization_join_request_rate_limits as current_limit (
        requester_hash, window_started_at, request_count
      ) values (
        requester_key_hash, now(), 1
      )
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

  create or replace function public.list_organization_join_request_candidates()
  returns table (id text, name text, role text)
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if auth.uid() is null or not public.is_manager() then
      raise exception 'only managers can review access requests';
    end if;

    return query
      select p.id, p.name, p.role
        from public.professionals p
       where p.organization_id = public.current_organization_id()
         and p.is_active
         and not exists (
           select 1
             from public.organization_members m
            where m.organization_id = p.organization_id
              and m.professional_id = p.id
              and m.is_active
         )
       and not exists (
         select 1
           from public.organization_join_requests r
          where r.organization_id = p.organization_id
            and r.professional_id = p.id
            and r.status = 'approved'
       )
       order by p.name;
  end;
  $$;

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
    if join_request.id is null then
      raise exception 'pending access request not found';
    end if;

    select * into professional
      from public.professionals
     where id = p_professional_id
       and organization_id = join_request.organization_id
       and is_active
     for update;
    if professional.id is null then
      raise exception 'active professional profile not found';
    end if;
    if join_request.user_id is not null and exists (
      select 1
        from public.organization_members
       where user_id = join_request.user_id
         and is_active
    ) then
      raise exception 'applicant already belongs to an organization';
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

  create or replace function public.reject_organization_join_request(p_request_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    if auth.uid() is null or not public.is_manager() then
      raise exception 'only managers can reject access requests';
    end if;

    update public.organization_join_requests
       set status = 'rejected',
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where id = p_request_id
       and organization_id = public.current_organization_id()
       and status = 'pending';
    if not found then
      raise exception 'pending access request not found';
    end if;
  end;
  $$;

  create or replace function public.revoke_approved_join_request_invitation(
    p_request_id uuid,
    p_invitation_id uuid
  )
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    invitation public.organization_invitations;
    join_request public.organization_join_requests;
  begin
    if auth.uid() is null or not public.is_manager() then
      raise exception 'only managers can revoke approved-request invitations';
    end if;

    -- Lock the invitation first, matching accept_organization_invitation's lock
    -- order so acceptance and revocation cannot both succeed or deadlock.
    select * into invitation
      from public.organization_invitations
     where id = p_invitation_id
       and organization_id = public.current_organization_id()
     for update;
    if invitation.id is null
       or invitation.accepted_at is not null
       or invitation.revoked_at is not null
       or invitation.expires_at <= now() then
      raise exception 'pending approved-request invitation not found';
    end if;

    select * into join_request
      from public.organization_join_requests
     where id = p_request_id
       and organization_id = public.current_organization_id()
       and status = 'approved'
       and user_id is null
     for update;
    if join_request.id is null
       or join_request.professional_id is distinct from invitation.professional_id
       or not (
         (invitation.email is not null
           and lower(invitation.email) = lower(coalesce(join_request.applicant_email, '')))
         or (invitation.phone is not null
           and invitation.phone = join_request.applicant_phone)
       ) then
      raise exception 'pending approved-request invitation not found';
    end if;

    update public.organization_invitations
       set revoked_at = now()
     where id = invitation.id
       and accepted_at is null
       and revoked_at is null;
    if not found then
      raise exception 'pending approved-request invitation not found';
    end if;

    update public.organization_join_requests
       set status = 'pending',
           professional_id = null,
           reviewed_at = null,
           reviewed_by = null
     where id = join_request.id;
  end;
  $$;

 create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if auth.uid() is null or not public.is_manager() then
     raise exception 'only managers can revoke invitations';
   end if;
   update public.organization_invitations
      set revoked_at = now()
    where id = p_invitation_id
      and organization_id = public.current_organization_id()
      and accepted_at is null
      and revoked_at is null;
   if not found then
     raise exception 'pending invitation not found';
   end if;
 end;
 $$;

 create or replace function public.delete_organization_invitation(p_invitation_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if auth.uid() is null or not public.is_manager() then
     raise exception 'only managers can delete invitations';
   end if;
   delete from public.organization_invitations
    where id = p_invitation_id
      and organization_id = public.current_organization_id();
   if not found then
     raise exception 'invitation not found or not permitted';
   end if;
 end;
 $$;

 create or replace function public.cleanup_historical_organization_invitations()
 returns uuid[]
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   deleted_ids uuid[];
 begin
   if auth.uid() is null or not public.is_manager() then
     raise exception 'only managers can clean invitations';
   end if;

   with deleted as (
     delete from public.organization_invitations
      where organization_id = public.current_organization_id()
        and accepted_at is null
        and (revoked_at is not null or expires_at <= now())
     returning id
   )
   select coalesce(array_agg(id), array[]::uuid[])
     into deleted_ids
     from deleted;

   return deleted_ids;
 end;
 $$;

 create or replace function public.protect_profile_context()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if new.default_organization_id is distinct from old.default_organization_id
      and coalesce(current_setting('barber_manager.allow_context_update', true), 'off') <> 'on' then
      if new.default_organization_id is null
         and not exists (
           select 1
             from public.organizations
            where id = old.default_organization_id
         ) then
        return new;
      end if;
     raise exception 'default organization is managed by the invitation flow';
   end if;
   return new;
 end;
 $$;

 drop trigger if exists profiles_protect_context on public.profiles;
 create trigger profiles_protect_context
 before update on public.profiles
 for each row execute function public.protect_profile_context();

 create or replace function public.adjust_product_stock(p_product_id text, p_delta integer)
 returns public.products
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   updated_product public.products;
 begin
   if auth.uid() is null or public.current_organization_id() is null then raise exception 'authentication required'; end if;
   if p_delta > 0 and not public.has_permission('produtos') then
     raise exception 'user does not have permission to restock products';
   end if;
   update public.products
      set stock = stock + p_delta, updated_at = now()
    where id = p_product_id
      and organization_id = public.current_organization_id()
      and stock + p_delta >= 0
   returning * into updated_product;
   if updated_product.id is null then raise exception 'insufficient stock or product not found'; end if;
   return updated_product;
 end;
 $$;

 create or replace function public.update_organization_details(
   p_name text,
   p_cnpj text default '',
   p_address text default '',
   p_logo_url text default null
 )
 returns public.organizations
 language plpgsql
 security definer
 set search_path = public
 as $$
 declare
   updated_organization public.organizations;
 begin
   if auth.uid() is null or not public.has_any_role(array['gestor', 'dev-admin']) then
     raise exception 'only managers can update organization details';
   end if;
   update public.organizations
      set name = coalesce(nullif(btrim(p_name), ''), name),
          cnpj = coalesce(p_cnpj, ''),
          address = coalesce(p_address, ''),
          logo_url = p_logo_url
    where id = public.current_organization_id()
   returning * into updated_organization;
   if updated_organization.id is null then raise exception 'organization not found'; end if;
   return updated_organization;
 end;
 $$;

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
  for each row
  execute function public.enforce_email_only_join_requests();

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

  revoke all on function public.enforce_email_only_invitation_acceptance() from public, anon, authenticated;

  drop trigger if exists organization_invitations_email_only_acceptance on public.organization_invitations;
  create trigger organization_invitations_email_only_acceptance
  before update of accepted_at on public.organization_invitations
  for each row
  execute function public.enforce_email_only_invitation_acceptance();

  drop function if exists public.create_organization_invitation_by_phone(text, text, integer);

 grant execute on function public.bootstrap_organization(text, text, text) to authenticated;
 grant execute on function public.create_organization_invitation(text, text, integer) to authenticated;
   grant execute on function public.create_reception_invitation(text, integer) to authenticated;
 grant execute on function public.accept_organization_invitation(text) to authenticated;
  grant execute on function public.get_onboarding_options() to authenticated;
  grant execute on function public.request_organization_join(text, text, text) to anon, authenticated;
  grant execute on function public.get_public_organization_invitation_info(text) to anon, authenticated;
  grant execute on function public.list_organization_join_request_candidates() to authenticated;
  grant execute on function public.approve_organization_join_request(uuid, text) to authenticated;
  grant execute on function public.reject_organization_join_request(uuid) to authenticated;
  grant execute on function public.revoke_approved_join_request_invitation(uuid, uuid) to authenticated;
 grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
 grant execute on function public.cleanup_historical_organization_invitations() to authenticated;
 grant execute on function public.adjust_product_stock(text, integer) to authenticated;
 grant execute on function public.update_organization_details(text, text, text, text) to authenticated;
 grant execute on function public.set_subscription_payment_status(text, text, text, text, double precision, text, text) to authenticated;
 grant execute on function public.subscription_next_due(text, text) to authenticated;
 grant execute on function public.default_role_permissions(text) to authenticated;
 grant execute on function public.has_permission(text) to authenticated;
 revoke all on function public.is_current_organization_professional(text) from public;
 grant execute on function public.is_current_organization_professional(text) to authenticated;
 revoke all on function public.is_current_organization_plan(text) from public;
 grant execute on function public.is_current_organization_plan(text) to authenticated;
 revoke all on function public.default_role_permissions(text) from public;
 revoke all on function public.has_permission(text) from public;
 revoke all on function public.handle_new_user() from public;
 revoke all on function public.sync_user_profile() from public;

  -- SECURITY DEFINER functions must never be callable anonymously. Start from
  -- a closed default for every public function, then allow only the client
  -- RPCs used by the authenticated application and the service role.
  revoke execute on all functions in schema public from public;
  revoke execute on all functions in schema public from anon;
  revoke execute on all functions in schema public from authenticated;
  grant execute on all functions in schema public to service_role;
  grant execute on function public.bootstrap_organization(text, text, text) to authenticated;
  grant execute on function public.create_organization_invitation(text, text, integer) to authenticated;
  grant execute on function public.accept_organization_invitation(text) to authenticated;
  grant execute on function public.get_onboarding_options() to authenticated;
  grant execute on function public.request_organization_join(text, text, text) to anon, authenticated;
  grant execute on function public.get_public_organization_invitation_info(text) to anon, authenticated;
  grant execute on function public.list_organization_join_request_candidates() to authenticated;
  grant execute on function public.approve_organization_join_request(uuid, text) to authenticated;
  grant execute on function public.reject_organization_join_request(uuid) to authenticated;
   grant execute on function public.revoke_approved_join_request_invitation(uuid, uuid) to authenticated;
  grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
  grant execute on function public.cleanup_historical_organization_invitations() to authenticated;
  grant execute on function public.adjust_product_stock(text, integer) to authenticated;
  grant execute on function public.update_organization_details(text, text, text, text) to authenticated;
  grant execute on function public.create_or_get_client_by_phone(text, text, text, text, text, text, text, text, text, jsonb) to authenticated;
  grant execute on function public.set_subscription_payment_status(text, text, text, text, double precision, text, text) to authenticated;
  grant execute on function public.subscription_next_due(text, text) to authenticated;
  grant execute on function public.default_role_permissions(text) to authenticated;
  grant execute on function public.has_permission(text) to authenticated;
  grant execute on function public.is_current_organization_professional(text) to authenticated;
  grant execute on function public.is_current_organization_plan(text) to authenticated;
  grant execute on function public.current_organization_id() to authenticated;
  grant execute on function public.current_user_role() to authenticated;
  grant execute on function public.current_professional_id() to authenticated;
  grant execute on function public.is_manager() to authenticated;
  grant execute on function public.list_professional_account_emails() to authenticated;
  grant execute on function public.has_any_role(text[]) to authenticated;

 -- ----------------------------------------------------------------------------
 -- Row Level Security
 -- ----------------------------------------------------------------------------

 alter table public.organizations enable row level security;
 alter table public.profiles enable row level security;
 alter table public.professionals enable row level security;
 alter table public.organization_members enable row level security;
 alter table public.organization_invitations enable row level security;
  alter table public.organization_join_requests enable row level security;
  alter table public.organization_join_request_rate_limits enable row level security;
 alter table public.organization_settings enable row level security;
 alter table public.appointments enable row level security;
 alter table public.blocks enable row level security;
 alter table public.clients enable row level security;
 alter table public.products enable row level security;
 alter table public.expenses enable row level security;
 alter table public.incomes enable row level security;
 alter table public.product_sales enable row level security;
  alter table public.finance_entry_changes enable row level security;
 alter table public.prothesis_sales enable row level security;
 alter table public.mentoria_sessions enable row level security;
 alter table public.subscription_plans enable row level security;
 alter table public.subscribers enable row level security;
 alter table public.subscription_payments enable row level security;
 alter table public.communication_sends enable row level security;

 -- Remove policies from the retired empresa_id model. Multiple permissive
 -- policies would otherwise weaken the tenant and professional boundaries.
 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array[
     'professionals', 'organization_settings', 'appointments', 'blocks',
     'clients', 'products', 'expenses', 'incomes', 'product_sales', 'prothesis_sales',
     'mentoria_sessions', 'subscription_plans', 'subscribers',
     'subscription_payments'
   ] loop
     execute format('drop policy if exists %I on public.%I', table_name || '_empresa_access', table_name);
   end loop;
 end;
 $$;

  -- Remove the legacy policy left by the old organization-settings model.
  -- Keeping it alongside the policies below would make PostgreSQL combine
  -- permissive predicates and could silently widen tenant access.
  drop policy if exists organization_settings_access on public.organization_settings;
  drop policy if exists organization_settings_empresa_access on public.organization_settings;

 drop policy if exists organizations_select_member on public.organizations;
 create policy organizations_select_member on public.organizations
 for select to authenticated using (id = public.current_organization_id());

 drop policy if exists profiles_select_own on public.profiles;
 create policy profiles_select_own on public.profiles
 for select to authenticated using (id = auth.uid());

 drop policy if exists profiles_update_own on public.profiles;
 create policy profiles_update_own on public.profiles
 for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

 drop policy if exists members_select_own on public.organization_members;
 create policy members_select_own on public.organization_members
 for select to authenticated using (
   user_id = auth.uid()
   or (organization_id = public.current_organization_id() and public.is_manager())
 );

 drop policy if exists invitations_select_manager on public.organization_invitations;
 create policy invitations_select_manager on public.organization_invitations
 for select to authenticated using (
   organization_id = public.current_organization_id() and public.is_manager()
 );

 drop policy if exists communication_sends_select_member on public.communication_sends;
 create policy communication_sends_select_member on public.communication_sends
 for select to authenticated using (
   organization_id = public.current_organization_id() and public.has_permission('comunicacao')
 );

 drop policy if exists communication_sends_insert_member on public.communication_sends;
 create policy communication_sends_insert_member on public.communication_sends
 for insert to authenticated with check (
   organization_id = public.current_organization_id()
   and public.has_permission('comunicacao')
   and sent_by = auth.uid()
 );

 drop policy if exists communication_sends_update_member on public.communication_sends;
 create policy communication_sends_update_member on public.communication_sends
 for update to authenticated
 using (
   organization_id = public.current_organization_id() and public.has_permission('comunicacao')
 )
 with check (
   organization_id = public.current_organization_id() and public.has_permission('comunicacao')
 );

 drop policy if exists settings_select_member on public.organization_settings;
 create policy settings_select_member on public.organization_settings
 for select to authenticated using (
   organization_id = public.current_organization_id()
 );

 do $$
 declare
   table_name text;
   permission_key text;
   policy_condition text;
 begin
   foreach table_name in array array[
     'clients', 'products', 'expenses', 'incomes', 'product_sales'
   ] loop
     permission_key := case
       when table_name = 'clients' then 'clientes'
       when table_name in ('expenses', 'incomes') then 'financeiro'
       else 'produtos'
     end;
     execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
     if table_name in ('expenses', 'incomes') then
       policy_condition := format(
         'organization_id = public.current_organization_id()
          and public.current_user_role() not in (''barbeiro'', ''manicure'', ''vendedor'')
          and public.has_permission(%L)',
         permission_key
       );
     else
       policy_condition := format(
         'organization_id = public.current_organization_id() and public.has_permission(%L)',
         permission_key
       );
     end if;
     execute format(
       'create policy %I on public.%I for select to authenticated using (%s)',
       table_name || '_select_member', table_name, policy_condition
     );
   end loop;
 end;
 $$;

 revoke all on public.product_sales from public, anon, authenticated;
 grant select on public.product_sales to authenticated;

 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array['prothesis_sales', 'mentoria_sessions'] loop
     execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
     execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
     execute format(
       'create policy %I on public.%I for select to authenticated using (organization_id = public.current_organization_id() and public.is_current_organization_professional(seller_id) and (public.is_manager() or (public.has_permission(''vendas'') and seller_id = public.current_professional_id())))',
       table_name || '_select_member', table_name
     );
     execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
     execute format(
       'create policy %I on public.%I for all to authenticated using (organization_id = public.current_organization_id() and public.is_current_organization_professional(seller_id) and (public.is_manager() or (public.has_permission(''vendas'') and seller_id = public.current_professional_id()))) with check (organization_id = public.current_organization_id() and public.is_current_organization_professional(seller_id) and (public.is_manager() or (public.has_permission(''vendas'') and seller_id = public.current_professional_id())))',
       table_name || '_write', table_name
     );
   end loop;
   drop policy if exists subscribers_select_member on public.subscribers;
   create policy subscribers_select_member on public.subscribers
   for select to authenticated using (
     organization_id = public.current_organization_id()
     and (
       public.is_current_organization_professional(professional_id)
       or (public.current_user_role() = 'recepcao' and professional_id is null)
     )
     and public.is_current_organization_plan(plan_id)
     and (public.is_manager() or (public.has_permission('planos') and (professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
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
     and (public.is_manager() or (public.has_permission('planos') and (professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
   ) with check (
     organization_id = public.current_organization_id()
     and (
       public.is_current_organization_professional(professional_id)
       or (public.current_user_role() = 'recepcao' and professional_id is null)
     )
     and public.is_current_organization_plan(plan_id)
     and (public.is_manager() or (public.has_permission('planos') and (professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
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
         and (public.is_manager() or (public.has_permission('planos') and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
    )
  );

  alter table public.subscribers
    add column if not exists usage_started_at timestamptz;
  update public.subscribers
     set usage_started_at = coalesce(usage_started_at, created_at, now())
   where usage_started_at is null;
  alter table public.subscribers
    alter column usage_started_at set default now(),
    alter column usage_started_at set not null;

  alter table public.appointments
    add column if not exists service_id text,
    add column if not exists plan_subscriber_id text,
    add column if not exists plan_usage_value double precision not null default 0,
    add column if not exists professional_commissions jsonb not null default '[]'::jsonb;

  do $$
  begin
    if not exists (
      select 1 from pg_constraint
       where conname = 'appointments_plan_subscriber_id_fkey'
         and conrelid = 'public.appointments'::regclass
    ) then
      alter table public.appointments
        add constraint appointments_plan_subscriber_id_fkey
        foreign key (plan_subscriber_id)
        references public.subscribers(id)
        on delete set null;
    end if;

    if not exists (
      select 1 from pg_constraint
       where conname = 'appointments_plan_usage_value_nonnegative'
         and conrelid = 'public.appointments'::regclass
    ) then
      alter table public.appointments
        add constraint appointments_plan_usage_value_nonnegative
        check (plan_usage_value >= 0);
    end if;

    if not exists (
      select 1 from pg_constraint
       where conname = 'appointments_professional_commissions_array'
         and conrelid = 'public.appointments'::regclass
    ) then
      alter table public.appointments
        add constraint appointments_professional_commissions_array
        check (jsonb_typeof(professional_commissions) = 'array');
    end if;
  end
  $$;

  create index if not exists appointments_plan_usage_idx
    on public.appointments (plan_subscriber_id, service_id, attendance_recorded_at)
    where plan_subscriber_id is not null;

  revoke all on table public.organization_join_requests from public, anon, authenticated;
  revoke all on table public.organization_join_request_rate_limits from public, anon, authenticated;
  grant select on table public.organization_join_requests to authenticated;
  drop policy if exists organization_join_requests_select_visible on public.organization_join_requests;
  create policy organization_join_requests_select_visible on public.organization_join_requests
  for select to authenticated using (
    user_id = auth.uid()
    or (organization_id = public.current_organization_id() and public.is_manager())
  );

  alter table public.deployment_settings enable row level security;
  revoke all on table public.deployment_settings from public, anon, authenticated;
  grant select, update on table public.deployment_settings to service_role;
  insert into public.deployment_settings (setting_key, enabled)
  values ('organization_creation_enabled', false)
  on conflict (setting_key) do update
    set enabled = false, updated_at = now();

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
         and (public.is_manager() or (public.has_permission('planos') and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
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
         and (public.is_manager() or (public.has_permission('planos') and (s.professional_id = public.current_professional_id() or public.current_user_role() = 'recepcao')))
    )
  );
 end;
 $$;

  revoke insert, update, delete on table public.finance_entry_changes from anon, authenticated;
  grant select on table public.finance_entry_changes to authenticated;
  drop policy if exists finance_entry_changes_select_manager on public.finance_entry_changes;
  create policy finance_entry_changes_select_manager on public.finance_entry_changes
  for select to authenticated using (
    organization_id = public.current_organization_id()
    and public.is_manager()
  );

 drop policy if exists professionals_select_member on public.professionals;
 create policy professionals_select_member on public.professionals
 for select to authenticated using (
   organization_id = public.current_organization_id()
    and (
      public.is_manager()
      or id = public.current_professional_id()
      or public.has_permission('profissionais')
      or (
        public.current_user_role() = 'recepcao'
        and (public.has_permission('agenda') or public.has_permission('controle'))
      )
    )
 );

 do $$
 declare
   table_name text;
 begin
   foreach table_name in array array['appointments', 'blocks'] loop
     execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
     execute format(
        'create policy %I on public.%I for select to authenticated using (organization_id = public.current_organization_id() and public.is_current_organization_professional(professional_id) and (public.is_manager() or ((public.has_permission(''agenda'') or public.has_permission(''controle'')) and (public.current_user_role() = ''recepcao'' or professional_id = public.current_professional_id()))))',
       table_name || '_select_member', table_name
     );
     execute format('drop policy if exists %I on public.%I', table_name || '_write_member', table_name);
     execute format(
        'create policy %I on public.%I for insert to authenticated with check (organization_id = public.current_organization_id() and public.is_current_organization_professional(professional_id) and (public.is_manager() or ((public.has_permission(''agenda'') or public.has_permission(''controle'')) and (public.current_user_role() = ''recepcao'' or professional_id = public.current_professional_id()))))',
       table_name || '_write_member', table_name
     );
     execute format('drop policy if exists %I on public.%I', table_name || '_update_member', table_name);
     execute format(
        'create policy %I on public.%I for update to authenticated using (organization_id = public.current_organization_id() and public.is_current_organization_professional(professional_id) and (public.is_manager() or ((public.has_permission(''agenda'') or public.has_permission(''controle'')) and (public.current_user_role() = ''recepcao'' or professional_id = public.current_professional_id())))) with check (organization_id = public.current_organization_id() and public.is_current_organization_professional(professional_id) and (public.is_manager() or ((public.has_permission(''agenda'') or public.has_permission(''controle'')) and (public.current_user_role() = ''recepcao'' or professional_id = public.current_professional_id()))))',
       table_name || '_update_member', table_name
     );
     execute format('drop policy if exists %I on public.%I', table_name || '_delete_member', table_name);
     execute format(
        'create policy %I on public.%I for delete to authenticated using (organization_id = public.current_organization_id() and public.is_current_organization_professional(professional_id) and (public.is_manager() or ((public.has_permission(''agenda'') or public.has_permission(''controle'')) and (public.current_user_role() = ''recepcao'' or professional_id = public.current_professional_id()))))',
       table_name || '_delete_member', table_name
     );
   end loop;
 end;
 $$;

  drop policy if exists appointments_delete_reception on public.appointments;
  create policy appointments_delete_reception on public.appointments
  for delete to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_user_role() = 'recepcao'
    and (public.has_permission('agenda') or public.has_permission('controle'))
    and public.is_current_organization_professional(professional_id)
  );

 drop policy if exists professionals_manager_write on public.professionals;
 create policy professionals_manager_write on public.professionals
 for all to authenticated
 using (organization_id = public.current_organization_id() and public.has_permission('profissionais'))
 with check (organization_id = public.current_organization_id() and public.has_permission('profissionais'));

 drop policy if exists settings_manager_write on public.organization_settings;
 create policy settings_manager_write on public.organization_settings
 for all to authenticated
 using (organization_id = public.current_organization_id() and public.has_any_role(array['gestor', 'dev-admin']))
 with check (organization_id = public.current_organization_id() and public.has_any_role(array['gestor', 'dev-admin']));

 drop policy if exists clients_write_sales on public.clients;
 create policy clients_write_sales on public.clients
 for all to authenticated
 using (organization_id = public.current_organization_id() and public.has_permission('clientes'))
 with check (organization_id = public.current_organization_id() and public.has_permission('clientes'));

  drop policy if exists clients_delete_reception on public.clients;
  create policy clients_delete_reception on public.clients
  for delete to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.current_user_role() = 'recepcao'
    and public.has_permission('clientes')
  );

 do $$
 declare
   table_name text;
   permission_key text;
   policy_condition text;
 begin
   foreach table_name in array array['products', 'expenses', 'incomes', 'subscription_plans'] loop
     permission_key := case
       when table_name = 'products' then 'produtos'
       when table_name = 'subscription_plans' then 'planos'
       else 'financeiro'
     end;
     execute format('drop policy if exists %I on public.%I', table_name || '_manager_write', table_name);
     if table_name in ('expenses', 'incomes') then
       policy_condition := format(
         'organization_id = public.current_organization_id()
          and public.current_user_role() not in (''barbeiro'', ''manicure'', ''vendedor'')
          and public.has_permission(%L)',
         permission_key
       );
     else
       policy_condition := format(
         'organization_id = public.current_organization_id() and public.has_permission(%L)',
         permission_key
       );
     end if;
     execute format(
       'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
       table_name || '_manager_write', table_name, policy_condition, policy_condition
     );
   end loop;
 end;
 $$;

  drop policy if exists expenses_insert_reception on public.expenses;
  create policy expenses_insert_reception on public.expenses
  for insert to authenticated
  with check (
    organization_id = public.current_organization_id()
    and public.current_user_role() = 'recepcao'
    and public.has_permission('controle')
  );

 -- ----------------------------------------------------------------------------
 -- Storage
 -- ----------------------------------------------------------------------------

 insert into storage.buckets (id, name, public)
 values ('avatars', 'avatars', false), ('logos', 'logos', false)
 on conflict (id) do update set public = excluded.public;

 drop policy if exists avatar_owner_access on storage.objects;
 create policy avatar_owner_access on storage.objects
 for all to authenticated
 using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
 with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

 drop policy if exists logo_manager_access on storage.objects;
 create policy logo_manager_access on storage.objects
 for all to authenticated
 using (bucket_id = 'logos' and (storage.foldername(name))[1] = public.current_organization_id()::text and public.has_any_role(array['gestor', 'dev-admin']))
 with check (bucket_id = 'logos' and (storage.foldername(name))[1] = public.current_organization_id()::text and public.has_any_role(array['gestor', 'dev-admin']));

 -- Keep existing installations aligned with nullable historical ownership.
 do $$
 declare
   link record;
   fk record;
 begin
   for link in select * from (values
     ('organization_invitations', 'professional_id'),
     ('appointments', 'professional_id'),
     ('appointments', 'seller_professional_id'),
     ('blocks', 'professional_id'),
     ('prothesis_sales', 'seller_id'),
     ('mentoria_sessions', 'seller_id'),
     ('subscribers', 'professional_id')
   ) as links(table_name, column_name)
   loop
     execute format('alter table public.%I alter column %I drop not null', link.table_name, link.column_name);
     for fk in
       select c.conname
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       where c.conrelid = format('public.%I', link.table_name)::regclass
         and c.confrelid = 'public.professionals'::regclass
         and c.contype = 'f' and a.attname = link.column_name
     loop
       execute format('alter table public.%I drop constraint %I', link.table_name, fk.conname);
     end loop;
     execute format(
       'alter table public.%I add constraint %I foreign key (%I) references public.professionals(id) on delete set null',
       link.table_name, link.table_name || '_' || link.column_name || '_fkey', link.column_name
     );
   end loop;
 end;
 $$;

 create or replace function public.prepare_professional_deletion()
 returns trigger
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   update public.organization_members
      set professional_id = null, is_active = false
    where professional_id = old.id and organization_id = old.organization_id;
   update public.organization_invitations
      set professional_id = null,
          revoked_at = case when accepted_at is null then coalesce(revoked_at, now()) else revoked_at end
    where professional_id = old.id and organization_id = old.organization_id;
   return old;
 end;
 $$;
 revoke all on function public.prepare_professional_deletion() from public, anon, authenticated;
 drop trigger if exists professionals_prepare_deletion on public.professionals;
 create trigger professionals_prepare_deletion
 before delete on public.professionals
 for each row execute function public.prepare_professional_deletion();

 create or replace function public.delete_professional_preserving_history(p_professional_id text)
 returns text
 language plpgsql
 security invoker
 set search_path = public
 as $$
 declare
   deleted_id text;
 begin
   delete from public.professionals
    where id = p_professional_id
      and organization_id = public.current_organization_id()
    returning id into deleted_id;
   if deleted_id is null then
     raise exception 'Profissional não encontrado ou sem permissão para excluir.';
   end if;
   return deleted_id;
 end;
 $$;
 revoke all on function public.delete_professional_preserving_history(text) from public, anon;
 grant execute on function public.delete_professional_preserving_history(text) to authenticated;
  revoke all on function public.delete_organization_invitation(uuid) from public, anon, authenticated;
  grant execute on function public.delete_organization_invitation(uuid) to authenticated;
  revoke all on function public.cleanup_historical_organization_invitations() from public, anon, authenticated;
  grant execute on function public.cleanup_historical_organization_invitations() to authenticated;
 create or replace function public.record_resend_invitation_email_event(
   p_email_id text,
   p_status text,
   p_event_at timestamptz
 )
 returns boolean
 language plpgsql
 security definer
 set search_path = public
 as $$
 begin
   if p_status not in ('sent', 'delayed', 'delivered', 'bounced', 'failed', 'complained')
      or p_event_at is null then
     raise exception 'invalid invitation email event';
   end if;

   update public.organization_invitations
      set email_delivery_status = p_status,
          email_delivery_updated_at = p_event_at
    where resend_email_id = p_email_id
      and (email_delivery_updated_at is null or email_delivery_updated_at <= p_event_at)
      and coalesce(email_delivery_status, '') not in (
        'delivered', 'bounced', 'failed', 'complained'
      );

   return found;
 end;
 $$;
 revoke all on function public.record_resend_invitation_email_event(text, text, timestamptz)
   from public, anon, authenticated;
 grant execute on function public.record_resend_invitation_email_event(text, text, timestamptz)
   to service_role;

 -- Keep this version in sync with currentSchemaVersion in e2e/provision.ts.
 alter table public.schema_metadata enable row level security;
 revoke all on table public.schema_metadata from public;
 grant select on table public.schema_metadata to service_role;
 insert into public.schema_metadata (key, value)
    values ('app_schema_version', '2026-10-21.2')
 on conflict (key) do update
   set value = excluded.value, updated_at = now();

-- Full access-request timeline. Keep this in sync with
-- migrations/2026-10-21-organization-join-request-history.sql.
alter table public.organization_invitations
  add column if not exists join_request_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'organization_invitations_join_request_id_fkey'
       and conrelid = 'public.organization_invitations'::regclass
  ) then
    alter table public.organization_invitations
      add constraint organization_invitations_join_request_id_fkey
      foreign key (join_request_id)
      references public.organization_join_requests(id)
      on delete set null;
  end if;
end;
$$;

create table if not exists public.organization_join_request_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.organization_join_requests(id) on delete cascade,
  event_type text not null check (
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
  ),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  invitation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists organization_join_request_events_history_idx
  on public.organization_join_request_events (organization_id, request_id, created_at);

create or replace function public.archive_rejected_organization_join_request(p_request_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_hidden_at timestamptz;
  v_actor_name text;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'only managers can archive rejected access requests';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    raise exception 'active organization required';
  end if;

  update public.organization_join_requests as request
     set hidden_at = coalesce(request.hidden_at, clock_timestamp())
   where request.id = p_request_id
     and request.organization_id = v_organization_id
     and request.status = 'rejected'
   returning request.hidden_at into v_hidden_at;

  if not found then
    raise exception 'rejected access request not found';
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
    'request:' || p_request_id::text || ':archived:' ||
      to_char(v_hidden_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
    v_organization_id,
    p_request_id,
    'request_archived',
    auth.uid(),
    v_actor_name,
    jsonb_build_object('hidden_at', v_hidden_at),
    v_hidden_at
  )
  on conflict (event_key) do nothing;

  return v_hidden_at;
end;
$$;

revoke all on function public.archive_rejected_organization_join_request(uuid) from public, anon, authenticated;
grant execute on function public.archive_rejected_organization_join_request(uuid) to authenticated;

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

revoke all on function public.restore_rejected_organization_join_request(uuid) from public, anon, authenticated;
grant execute on function public.restore_rejected_organization_join_request(uuid) to authenticated;

with matching_requests as (
  select
    invitation.id as invitation_id,
    (array_agg(
      request.id
      order by request.reviewed_at desc nulls last, request.requested_at desc
    ))[1] as request_id
  from public.organization_invitations as invitation
  join public.organization_join_requests as request
    on request.organization_id = invitation.organization_id
   and request.professional_id = invitation.professional_id
   and lower(coalesce(request.applicant_email, '')) = lower(coalesce(invitation.email, ''))
   and request.status = 'approved'
   and request.reviewed_at is not null
   and invitation.created_at >= request.reviewed_at
  where invitation.join_request_id is null
    and invitation.email is not null
    and invitation.professional_id is not null
  group by invitation.id
  having count(*) = 1
)
update public.organization_invitations as invitation
   set join_request_id = matching_requests.request_id
  from matching_requests
 where invitation.id = matching_requests.invitation_id
   and invitation.join_request_id is null;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_id, actor_name, metadata, created_at
)
select
  'request:' || request.id::text || ':submitted',
  request.organization_id,
  request.id,
  'request_submitted',
  request.user_id,
  request.applicant_name,
  '{}'::jsonb,
  request.requested_at
from public.organization_join_requests as request
on conflict (event_key) do nothing;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_id, actor_name, metadata, created_at
)
select
  format('request:%s:%s:%s', request.id, event.event_type, request.reviewed_at::text),
  request.organization_id,
  request.id,
  event.event_type,
  request.reviewed_by,
  coalesce(
    nullif(btrim(profile.full_name), ''),
    nullif(btrim(profile.email), ''),
    'Gestor'
  ),
  jsonb_strip_nulls(jsonb_build_object('professional_id', request.professional_id)),
  request.reviewed_at
from public.organization_join_requests as request
left join public.profiles as profile on profile.id = request.reviewed_by
cross join lateral (
  select case
    when request.status = 'approved' then 'request_approved'
    when request.status = 'rejected' then 'request_rejected'
  end as event_type
) as event
where request.status in ('approved', 'rejected')
  and request.reviewed_at is not null
on conflict (event_key) do nothing;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_id, actor_name, invitation_id, metadata, created_at
)
select
  'invitation:' || invitation.id::text || ':created',
  invitation.organization_id,
  invitation.join_request_id,
  'invitation_created',
  invitation.invited_by,
  coalesce(nullif(btrim(invitation.invited_by_name), ''), 'Gestor'),
  invitation.id,
  '{}'::jsonb,
  invitation.created_at
from public.organization_invitations as invitation
where invitation.join_request_id is not null
on conflict (event_key) do nothing;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_id, actor_name, invitation_id, metadata, created_at
)
select
  'invitation:' || invitation.id::text || ':revoked',
  invitation.organization_id,
  invitation.join_request_id,
  'invitation_revoked',
  invitation.revoked_by,
  coalesce(nullif(btrim(invitation.revoked_by_name), ''), 'Gestor'),
  invitation.id,
  '{}'::jsonb,
  invitation.revoked_at
from public.organization_invitations as invitation
where invitation.join_request_id is not null
  and invitation.revoked_at is not null
on conflict (event_key) do nothing;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_id, actor_name, invitation_id, metadata, created_at
)
select
  'invitation:' || invitation.id::text || ':accepted',
  invitation.organization_id,
  invitation.join_request_id,
  'invitation_accepted',
  invitation.accepted_by,
  coalesce(
    nullif(btrim(profile.full_name), ''),
    nullif(btrim(profile.email), ''),
    'Profissional'
  ),
  invitation.id,
  '{}'::jsonb,
  invitation.accepted_at
from public.organization_invitations as invitation
left join public.profiles as profile on profile.id = invitation.accepted_by
where invitation.join_request_id is not null
  and invitation.accepted_at is not null
on conflict (event_key) do nothing;

insert into public.organization_join_request_events (
  event_key, organization_id, request_id, event_type, actor_name, invitation_id, metadata, created_at
)
select
  format(
    'invitation:%s:email:%s:%s',
    invitation.id,
    invitation.email_delivery_status,
    invitation.email_delivery_updated_at::text
  ),
  invitation.organization_id,
  invitation.join_request_id,
  'invitation_email_status',
  'Sistema de e-mail',
  invitation.id,
  jsonb_build_object('status', invitation.email_delivery_status),
  coalesce(invitation.email_delivery_updated_at, invitation.created_at)
from public.organization_invitations as invitation
where invitation.join_request_id is not null
  and invitation.email_delivery_status is not null
on conflict (event_key) do nothing;

create or replace function public.link_organization_join_request_invitation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.join_request_id is not null
     or new.email is null
     or new.professional_id is null then
    return new;
  end if;

  select request.id
    into new.join_request_id
    from public.organization_join_requests as request
   where request.organization_id = new.organization_id
     and request.professional_id = new.professional_id
     and lower(coalesce(request.applicant_email, '')) = lower(new.email)
     and request.status = 'approved'
   order by request.reviewed_at desc nulls last, request.requested_at desc
   limit 1;

  return new;
end;
$$;
revoke all on function public.link_organization_join_request_invitation() from public, anon, authenticated;

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
    event_time_value := coalesce(new.reviewed_at, clock_timestamp());
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
revoke all on function public.record_organization_join_request_event() from public, anon, authenticated;

create or replace function public.record_organization_join_request_invitation_event()
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
  if new.join_request_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    event_type_value := 'invitation_created';
    event_key_value := 'invitation:' || new.id::text || ':created';
    actor_id_value := new.invited_by;
    actor_name_value := coalesce(nullif(btrim(new.invited_by_name), ''), 'Gestor');
    event_time_value := new.created_at;
    event_metadata_value := '{}'::jsonb;
  elsif old.email_delivery_status is distinct from new.email_delivery_status
        and new.email_delivery_status is not null then
    event_type_value := 'invitation_email_status';
    event_key_value := format(
      'invitation:%s:email:%s:%s',
      new.id,
      new.email_delivery_status,
      coalesce(new.email_delivery_updated_at, clock_timestamp())::text
    );
    actor_name_value := 'Sistema de e-mail';
    event_time_value := coalesce(new.email_delivery_updated_at, clock_timestamp());
    event_metadata_value := jsonb_build_object('status', new.email_delivery_status);
  elsif old.revoked_at is null and new.revoked_at is not null then
    event_type_value := 'invitation_revoked';
    event_key_value := 'invitation:' || new.id::text || ':revoked';
    actor_id_value := new.revoked_by;
    actor_name_value := coalesce(nullif(btrim(new.revoked_by_name), ''), 'Gestor');
    event_time_value := new.revoked_at;
    event_metadata_value := '{}'::jsonb;
  elsif old.accepted_at is null and new.accepted_at is not null then
    event_type_value := 'invitation_accepted';
    event_key_value := 'invitation:' || new.id::text || ':accepted';
    actor_id_value := new.accepted_by;
    event_time_value := new.accepted_at;
    event_metadata_value := '{}'::jsonb;
    if actor_id_value is not null then
      select coalesce(
        nullif(btrim(profile.full_name), ''),
        nullif(btrim(profile.email), ''),
        'Profissional'
      )
        into actor_name_value
        from public.profiles as profile
       where profile.id = actor_id_value;
    end if;
    actor_name_value := coalesce(actor_name_value, 'Profissional');
  else
    return new;
  end if;

  insert into public.organization_join_request_events (
    event_key,
    organization_id,
    request_id,
    event_type,
    actor_id,
    actor_name,
    invitation_id,
    metadata,
    created_at
  )
  values (
    event_key_value,
    new.organization_id,
    new.join_request_id,
    event_type_value,
    actor_id_value,
    actor_name_value,
    new.id,
    event_metadata_value,
    event_time_value
  )
  on conflict (event_key) do nothing;

  return new;
end;
$$;
revoke all on function public.record_organization_join_request_invitation_event() from public, anon, authenticated;

drop trigger if exists organization_invitations_link_join_request on public.organization_invitations;
create trigger organization_invitations_link_join_request
before insert or update on public.organization_invitations
for each row execute function public.link_organization_join_request_invitation();

drop trigger if exists organization_join_requests_record_history on public.organization_join_requests;
create trigger organization_join_requests_record_history
after insert or update of status on public.organization_join_requests
for each row execute function public.record_organization_join_request_event();

drop trigger if exists organization_invitations_record_join_request_history on public.organization_invitations;
create trigger organization_invitations_record_join_request_history
after insert or update on public.organization_invitations
for each row execute function public.record_organization_join_request_invitation_event();

alter table public.organization_join_request_events enable row level security;
revoke all on table public.organization_join_request_events from public, anon, authenticated;
grant select on table public.organization_join_request_events to authenticated;
drop policy if exists organization_join_request_events_select_manager
  on public.organization_join_request_events;
create policy organization_join_request_events_select_manager
  on public.organization_join_request_events
  for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.is_manager()
  );

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-23.7')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

create or replace function public.get_organization_history_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'manager_access_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'client_visits', coalesce((
      select sum(jsonb_array_length(client.visits))
        from public.clients as client
       where client.organization_id = v_organization_id
         and jsonb_typeof(client.visits) = 'array'
    ), 0),
    'appointments', (
      select count(*) from public.appointments as appointment
       where appointment.organization_id = v_organization_id
    ),
    'appointments_locked', (
      select count(*) from public.appointments as appointment
       where appointment.organization_id = v_organization_id
         and (
           appointment.attendance_recorded_at <= clock_timestamp() - interval '24 hours'
           or (
             appointment.attendance_recorded_at is null
             and (
               appointment.status = 'completed'
               or (
                 appointment.status = 'confirmed'
                 and (appointment.date || ' ' || appointment.time)::timestamp
                   <= timezone('America/Sao_Paulo', clock_timestamp())
               )
             )
           )
         )
    ),
    'expenses', (
      select count(*) from public.expenses as expense
       where expense.organization_id = v_organization_id
    ),
    'incomes', (
      select count(*) from public.incomes as income
       where income.organization_id = v_organization_id
    ),
    'finance_changes', (
      select count(*) from public.finance_entry_changes as change
       where change.organization_id = v_organization_id
    ),
    'prosthesis_sales', (
      select count(*) from public.prothesis_sales as sale
       where sale.organization_id = v_organization_id
    ),
    'mentoring_sessions', (
      select count(*) from public.mentoria_sessions as session
       where session.organization_id = v_organization_id
    ),
    'communication_sends', (
      select count(*) from public.communication_sends as send
       where send.organization_id = v_organization_id
    ),
    'subscription_payments', (
      select count(*) from public.subscription_payments as payment
       where payment.organization_id = v_organization_id
    ),
    'join_requests', (
      select count(*) from public.organization_join_requests as request
       where request.organization_id = v_organization_id
    ),
    'invitations', (
      select count(*) from public.organization_invitations as invitation
       where invitation.organization_id = v_organization_id
    ),
    'join_request_events', (
      select count(*) from public.organization_join_request_events as event
       where event.organization_id = v_organization_id
    )
  );
end;
$$;

create or replace function public.clear_organization_history(p_history_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_deleted_count bigint := 0;
  v_visits_count bigint := 0;
  v_requests_count bigint := 0;
  v_invitations_count bigint := 0;
  v_events_count bigint := 0;
  v_expenses_count bigint := 0;
  v_incomes_count bigint := 0;
  v_changes_count bigint := 0;
  v_sales_count bigint := 0;
  v_sessions_count bigint := 0;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'manager_access_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;

  if p_history_type = 'client_visits' then
    select coalesce(sum(jsonb_array_length(client.visits)), 0)
      into v_visits_count
      from public.clients as client
     where client.organization_id = v_organization_id
       and jsonb_typeof(client.visits) = 'array';

    update public.clients as client
       set visits = '[]'::jsonb,
           updated_at = now()
     where client.organization_id = v_organization_id
       and client.visits <> '[]'::jsonb;
    v_deleted_count := v_visits_count;

  elsif p_history_type = 'finance' then
    delete from public.expenses as expense
     where expense.organization_id = v_organization_id;
    get diagnostics v_expenses_count = row_count;

    delete from public.incomes as income
     where income.organization_id = v_organization_id;
    get diagnostics v_incomes_count = row_count;

    delete from public.finance_entry_changes as change
     where change.organization_id = v_organization_id;
    get diagnostics v_changes_count = row_count;
    v_deleted_count := v_expenses_count + v_incomes_count + v_changes_count;

  elsif p_history_type = 'sales' then
    delete from public.prothesis_sales as sale
     where sale.organization_id = v_organization_id;
    get diagnostics v_sales_count = row_count;

    delete from public.mentoria_sessions as session
     where session.organization_id = v_organization_id;
    get diagnostics v_sessions_count = row_count;
    v_deleted_count := v_sales_count + v_sessions_count;

  elsif p_history_type = 'communication' then
    delete from public.communication_sends as send
     where send.organization_id = v_organization_id;
    get diagnostics v_deleted_count = row_count;

  elsif p_history_type = 'subscription_payments' then
    delete from public.subscription_payments as payment
     where payment.organization_id = v_organization_id;
    get diagnostics v_deleted_count = row_count;

  elsif p_history_type = 'team_access' then
    select count(*) into v_events_count
      from public.organization_join_request_events as event
     where event.organization_id = v_organization_id;

    delete from public.organization_invitations as invitation
     where invitation.organization_id = v_organization_id;
    get diagnostics v_invitations_count = row_count;

    delete from public.organization_join_requests as request
     where request.organization_id = v_organization_id;
    get diagnostics v_requests_count = row_count;

    v_deleted_count := v_invitations_count + v_requests_count + v_events_count;

  else
    raise exception 'unsupported_history_type' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'history_type', p_history_type,
    'deleted_count', v_deleted_count,
    'appointments_deleted', 0
  );
end;
$$;

create or replace function public.delete_organization_history_item(
  p_history_type text,
  p_item_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_deleted_count integer := 0;
begin
  if auth.uid() is null or not public.is_manager() then
    raise exception 'manager_access_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;

  if p_item_id is null or btrim(p_item_id) = '' then
    return false;
  end if;

  if p_history_type = 'finance_change' then
    delete from public.finance_entry_changes as change
     where change.id = p_item_id::uuid
       and change.organization_id = v_organization_id;
  elsif p_history_type = 'communication_send' then
    delete from public.communication_sends as send
     where send.id = p_item_id::uuid
       and send.organization_id = v_organization_id;
  elsif p_history_type = 'subscription_payment' then
    delete from public.subscription_payments as payment
     where payment.id = p_item_id
       and payment.organization_id = v_organization_id;
  elsif p_history_type = 'join_request_event' then
    delete from public.organization_join_request_events as event
     where event.id = p_item_id::uuid
       and event.organization_id = v_organization_id;
  else
    raise exception 'unsupported_history_type' using errcode = '22023';
  end if;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
exception
  when invalid_text_representation then
    return false;
end;
$$;

revoke all on function public.get_organization_history_counts() from public, anon;
revoke all on function public.clear_organization_history(text) from public, anon;
revoke all on function public.delete_organization_history_item(text, text) from public, anon;
grant execute on function public.get_organization_history_counts() to authenticated;
grant execute on function public.clear_organization_history(text) to authenticated;
grant execute on function public.delete_organization_history_item(text, text) to authenticated;

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
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  v_role := public.current_user_role();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;
  if v_role not in ('gestor', 'dev-admin', 'barbeiro', 'manicure', 'vendedor') then
    raise exception 'personal_finance_not_available_for_role' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'invalid_finance_period' using errcode = '22023';
  end if;

  if public.is_manager() then
    v_professional_id := coalesce(p_professional_id, public.current_professional_id());
  else
    if p_professional_id is not null then
      raise exception 'cannot_request_another_professional_earnings' using errcode = '42501';
    end if;
    v_professional_id := public.current_professional_id();
  end if;

  if v_professional_id is null or not exists (
    select 1
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  ) then
    raise exception 'active_professional_profile_required' using errcode = '42501';
  end if;

  return query
  with selected_professional as (
    select professional.id, professional.commissions
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  ),
  appointment_rates as (
    select
      appointment.id,
      appointment.date::date as service_date,
      appointment.service,
      appointment.value::numeric as service_value,
      coalesce(appointment.tip, 0)::numeric as tip_value,
      appointment.professional_id,
      appointment.seller_professional_id,
      appointment.seller_is_company,
      selected_professional.commissions,
      coalesce(
        nullif(configured_service.value->>'commissionKey', ''),
        case
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%manicure%' then 'manicure'
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%manuten%' then 'manutencao'
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%protese%' then 'protese'
          when lower(appointment.service) like '%mentoria%' then 'mentoria'
          else 'barbearia'
        end
      ) as commission_key
    from public.appointments appointment
    join selected_professional on true
    left join public.organization_settings settings
      on settings.organization_id = v_organization_id
    left join lateral (
      select service.value
        from jsonb_array_elements(
          case
            when jsonb_typeof(settings.payload->'services') = 'array'
              then settings.payload->'services'
            else '[]'::jsonb
          end
        ) as service(value)
       where service.value->>'name' = appointment.service
       limit 1
    ) configured_service on true
    where appointment.organization_id = v_organization_id
      and appointment.date >= p_start_date::text
      and appointment.date <= p_end_date::text
      and appointment.status in ('confirmed', 'completed')
      and (
        appointment.professional_id = v_professional_id
        or (not appointment.seller_is_company and appointment.seller_professional_id = v_professional_id)
      )
  ),
  rated_appointments as (
    select appointment_rates.*,
      case
        when coalesce(appointment_rates.commissions->>appointment_rates.commission_key, '') ~ '^[0-9]+([.][0-9]+)?$'
         and (appointment_rates.commissions->>appointment_rates.commission_key)::numeric between 0 and 1
          then (appointment_rates.commissions->>appointment_rates.commission_key)::numeric
        else 0::numeric
      end as commission_rate
    from appointment_rates
  ),
  earnings as (
    select
      appointment.id || ':performer' as earning_id,
      appointment.service_date as earning_date,
      'commission'::text as earning_kind,
      'Comissão por execução · ' || appointment.service as earning_source,
      'Atendimento'::text as earning_attribution,
      round(appointment.service_value * appointment.commission_rate, 2) as earning_amount
    from rated_appointments appointment
    where appointment.professional_id = v_professional_id

    union all

    select
      appointment.id || ':seller' as earning_id,
      appointment.service_date as earning_date,
      'commission'::text as earning_kind,
      'Comissão por venda · ' || appointment.service as earning_source,
      'Atendimento'::text as earning_attribution,
      round(appointment.service_value * appointment.commission_rate, 2) as earning_amount
    from rated_appointments appointment
    where not appointment.seller_is_company
      and appointment.seller_professional_id = v_professional_id

    union all

    select
      appointment.id || ':tip' as earning_id,
      appointment.service_date as earning_date,
      'tip'::text as earning_kind,
      'Gorjeta'::text as earning_source,
      'Atendimento · ' || appointment.service as earning_attribution,
      round(appointment.tip_value, 2) as earning_amount
    from rated_appointments appointment
    where appointment.professional_id = v_professional_id
      and appointment.tip_value > 0

    union all

    select
      sale.id || ':prothesis' as earning_id,
      sale.date::date as earning_date,
      'commission'::text as earning_kind,
      'Comissão de venda · Prótese Capilar'::text as earning_source,
      'Venda própria · ' || sale.installments_paid::text || '/' || sale.installments::text || ' parcelas pagas' as earning_attribution,
      round(
        sale.value::numeric * sale.installments_paid::numeric / sale.installments::numeric *
        case
          when coalesce(selected_professional.commissions->>'protese', '') ~ '^[0-9]+([.][0-9]+)?$'
           and (selected_professional.commissions->>'protese')::numeric between 0 and 1
            then (selected_professional.commissions->>'protese')::numeric
          else 0::numeric
        end,
        2
      ) as earning_amount
    from public.prothesis_sales sale
    join selected_professional on selected_professional.id = sale.seller_id
    where sale.organization_id = v_organization_id
      and sale.date >= p_start_date::text
      and sale.date <= p_end_date::text
      and sale.installments_paid > 0

    union all

    select
      session.id || ':mentoria' as earning_id,
      session.date::date as earning_date,
      'commission'::text as earning_kind,
      'Comissão de venda · Mentoria'::text as earning_source,
      'Mentoria concluída'::text as earning_attribution,
      round(
        session.value::numeric *
        case
          when coalesce(selected_professional.commissions->>'mentoria', '') ~ '^[0-9]+([.][0-9]+)?$'
           and (selected_professional.commissions->>'mentoria')::numeric between 0 and 1
            then (selected_professional.commissions->>'mentoria')::numeric
          else 0::numeric
        end,
        2
      ) as earning_amount
    from public.mentoria_sessions session
    join selected_professional on selected_professional.id = session.seller_id
    where session.organization_id = v_organization_id
      and session.date >= p_start_date::text
      and session.date <= p_end_date::text
      and session.status = 'completed'
  )
  select earning_id, earning_date, earning_kind, earning_source, earning_attribution, earning_amount
    from earnings
   where earning_amount > 0
   order by earning_date desc, earning_id;
end;
$$;

revoke all on function public.get_my_financial_earnings(date, date, text) from public, anon, authenticated;
grant execute on function public.get_my_financial_earnings(date, date, text) to authenticated;

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

revoke all on function public.validate_plan_appointment_usage() from public, anon, authenticated;
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
begin
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

  return new;
end;
$$;

revoke all on function public.validate_appointment_professional_commissions() from public, anon, authenticated;
drop trigger if exists appointments_manual_commissions_validation on public.appointments;
create trigger appointments_manual_commissions_validation
before insert or update of professional_commissions, professional_id, organization_id
on public.appointments
for each row execute function public.validate_appointment_professional_commissions();

create or replace function public.renew_subscriber_plan_usages(p_subscriber_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscriber public.subscribers;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if not (public.is_manager() or public.has_permission('planos')) then
    raise exception 'user_does_not_have_permission_to_renew_plan_usages' using errcode = '42501';
  end if;

  update public.subscribers subscriber
     set usage_started_at = clock_timestamp(),
         updated_at = now()
   where subscriber.id = p_subscriber_id
     and subscriber.organization_id = public.current_organization_id()
  returning subscriber.* into v_subscriber;
  if not found then
    raise exception 'subscriber_not_found' using errcode = 'P0001';
  end if;
  return to_jsonb(v_subscriber);
end;
$$;

revoke all on function public.renew_subscriber_plan_usages(text) from public, anon;
grant execute on function public.renew_subscriber_plan_usages(text) to authenticated;

create or replace function public.reset_subscriber_plan_usages_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_id is distinct from old.plan_id then
    new.usage_started_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.reset_subscriber_plan_usages_on_plan_change()
  from public, anon, authenticated;

drop trigger if exists subscribers_reset_usages_on_plan_change on public.subscribers;
create trigger subscribers_reset_usages_on_plan_change
before update of plan_id on public.subscribers
for each row execute function public.reset_subscriber_plan_usages_on_plan_change();

create or replace function public.get_my_plan_usage_earnings(
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
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  v_role := public.current_user_role();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;
  if v_role not in ('gestor', 'dev-admin', 'barbeiro', 'manicure', 'vendedor') then
    raise exception 'personal_finance_not_available_for_role' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'invalid_finance_period' using errcode = '22023';
  end if;

  if public.is_manager() then
    v_professional_id := coalesce(p_professional_id, public.current_professional_id());
  else
    if p_professional_id is not null then
      raise exception 'cannot_request_another_professional_earnings' using errcode = '42501';
    end if;
    v_professional_id := public.current_professional_id();
  end if;

  if v_professional_id is null or not exists (
    select 1
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  ) then
    raise exception 'active_professional_profile_required' using errcode = '42501';
  end if;

  return query
  with selected_professional as (
    select professional.id, professional.commissions
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  ),
  usage_rates as (
    select
      appointment.id,
      appointment.date::date as service_date,
      appointment.service,
      appointment.plan_usage_value::numeric as commission_base,
      appointment.professional_id,
      appointment.seller_professional_id,
      appointment.seller_is_company,
      appointment.professional_commissions,
      subscriber.name as subscriber_name,
      plan.name as plan_name,
      selected_professional.commissions,
      coalesce(
        nullif(configured_service.value->>'commissionKey', ''),
        case
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%manicure%' then 'manicure'
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%manuten%' then 'manutencao'
          when translate(lower(appointment.service), 'áàâãéêíóôõúüç', 'aaaaeeiooouuc') like '%protese%' then 'protese'
          when lower(appointment.service) like '%mentoria%' then 'mentoria'
          else 'barbearia'
        end
      ) as commission_key
    from public.appointments appointment
    join selected_professional on true
    join public.subscribers subscriber
      on subscriber.id = appointment.plan_subscriber_id
     and subscriber.organization_id = appointment.organization_id
    join public.subscription_plans plan
      on plan.id = subscriber.plan_id
     and plan.organization_id = subscriber.organization_id
    left join public.organization_settings settings
      on settings.organization_id = v_organization_id
    left join lateral (
      select service.value
        from jsonb_array_elements(
          case
            when jsonb_typeof(settings.payload->'services') = 'array'
              then settings.payload->'services'
            else '[]'::jsonb
          end
        ) as service(value)
       where service.value->>'id' = appointment.service_id
          or (appointment.service_id is null and service.value->>'name' = appointment.service)
       limit 1
    ) configured_service on true
    where appointment.organization_id = v_organization_id
      and appointment.date >= p_start_date::text
      and appointment.date <= p_end_date::text
      and appointment.status in ('confirmed', 'completed')
      and appointment.attendance_recorded_at is not null
      and appointment.plan_subscriber_id is not null
      and (
        appointment.professional_id = v_professional_id
        or (not appointment.seller_is_company and appointment.seller_professional_id = v_professional_id)
      )
  ),
  rated_usage as (
    select usage_rates.*,
      case
        when coalesce(usage_rates.commissions->>usage_rates.commission_key, '') ~ '^[0-9]+([.][0-9]+)?$'
         and (usage_rates.commissions->>usage_rates.commission_key)::numeric between 0 and 1
          then (usage_rates.commissions->>usage_rates.commission_key)::numeric
        else 0::numeric
      end as commission_rate
    from usage_rates
  )
  select
    usage.id || ':plan-performer' as earning_id,
    usage.service_date as earning_date,
    'commission'::text as earning_kind,
    'Comissão por execução via plano · ' || usage.service as earning_source,
    'Atendimento de ' || usage.subscriber_name || ' · ' || usage.plan_name as earning_attribution,
    round(usage.commission_base * usage.commission_rate, 2) as earning_amount
  from rated_usage usage
  where usage.professional_id = v_professional_id
    and jsonb_array_length(usage.professional_commissions) <= 1
    and usage.commission_base > 0
    and usage.commission_rate > 0;

  return query
  with selected_professional as (
    select professional.id, professional.commissions
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  )
  select
    appointment.id || ':plan-seller' as earning_id,
    appointment.date::date as earning_date,
    'commission'::text as earning_kind,
    'Comissão por venda via plano · ' || appointment.service as earning_source,
    'Atendimento de ' || subscriber.name || ' · ' || plan.name as earning_attribution,
    round(
      appointment.plan_usage_value::numeric *
      case
        when coalesce(selected_professional.commissions->>coalesce(
          nullif(configured_service.value->>'commissionKey', ''),
          'barbearia'
        ), '') ~ '^[0-9]+([.][0-9]+)?$'
         and (selected_professional.commissions->>coalesce(
           nullif(configured_service.value->>'commissionKey', ''),
           'barbearia'
         ))::numeric between 0 and 1
          then (selected_professional.commissions->>coalesce(
            nullif(configured_service.value->>'commissionKey', ''),
            'barbearia'
          ))::numeric
        else 0::numeric
      end,
      2
    ) as earning_amount
  from public.appointments appointment
  join selected_professional on selected_professional.id = appointment.seller_professional_id
  join public.subscribers subscriber
    on subscriber.id = appointment.plan_subscriber_id
   and subscriber.organization_id = appointment.organization_id
  join public.subscription_plans plan
    on plan.id = subscriber.plan_id
   and plan.organization_id = subscriber.organization_id
  left join public.organization_settings settings
    on settings.organization_id = v_organization_id
  left join lateral (
    select service.value
      from jsonb_array_elements(
        case
          when jsonb_typeof(settings.payload->'services') = 'array'
            then settings.payload->'services'
          else '[]'::jsonb
        end
      ) as service(value)
     where service.value->>'id' = appointment.service_id
        or (appointment.service_id is null and service.value->>'name' = appointment.service)
     limit 1
  ) configured_service on true
  where appointment.organization_id = v_organization_id
    and appointment.date >= p_start_date::text
    and appointment.date <= p_end_date::text
    and appointment.status in ('confirmed', 'completed')
    and appointment.attendance_recorded_at is not null
    and appointment.plan_subscriber_id is not null
    and not appointment.seller_is_company
    and appointment.plan_usage_value > 0
    and case
      when coalesce(selected_professional.commissions->>coalesce(
        nullif(configured_service.value->>'commissionKey', ''),
        'barbearia'
      ), '') ~ '^[0-9]+([.][0-9]+)?$'
        then (selected_professional.commissions->>coalesce(
          nullif(configured_service.value->>'commissionKey', ''),
          'barbearia'
        ))::numeric > 0
      else false
    end;
end;
$$;

revoke all on function public.get_my_plan_usage_earnings(date, date, text) from public, anon;
grant execute on function public.get_my_plan_usage_earnings(date, date, text) to authenticated;

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
declare
  v_organization_id uuid;
  v_professional_id text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_organization_id := public.current_organization_id();
  v_role := public.current_user_role();
  if v_organization_id is null then
    raise exception 'active_organization_required' using errcode = '42501';
  end if;
  if v_role not in ('gestor', 'dev-admin', 'barbeiro', 'manicure', 'vendedor') then
    raise exception 'personal_finance_not_available_for_role' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'invalid_finance_period' using errcode = '22023';
  end if;

  if public.is_manager() then
    v_professional_id := coalesce(p_professional_id, public.current_professional_id());
  else
    if p_professional_id is not null then
      raise exception 'cannot_request_another_professional_earnings' using errcode = '42501';
    end if;
    v_professional_id := public.current_professional_id();
  end if;

  if v_professional_id is null or not exists (
    select 1
      from public.professionals professional
     where professional.id = v_professional_id
       and professional.organization_id = v_organization_id
  ) then
    raise exception 'active_professional_profile_required' using errcode = '42501';
  end if;

  return query
  select
    appointment.id || ':manual:' || v_professional_id as earning_id,
    appointment.date::date as earning_date,
    'commission'::text as earning_kind,
    'Comissão manual · ' || appointment.service as earning_source,
    'Atendimento de ' || appointment.client as earning_attribution,
    case
      when coalesce(assignment.value->>'amount', '') ~ '^[0-9]+([.][0-9]{1,2})?$'
        then (assignment.value->>'amount')::numeric
      else 0::numeric
    end as earning_amount
  from public.appointments appointment
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(appointment.professional_commissions) = 'array'
        then appointment.professional_commissions
      else '[]'::jsonb
    end
  ) as assignment(value)
  where appointment.organization_id = v_organization_id
    and appointment.date::date between p_start_date and p_end_date
    and appointment.status in ('confirmed', 'completed')
    and appointment.attendance_recorded_at is not null
    and jsonb_array_length(appointment.professional_commissions) > 1
    and assignment.value->>'professionalId' = v_professional_id;
end;
$$;

revoke all on function public.get_my_manual_appointment_commissions(date, date, text) from public, anon;
grant execute on function public.get_my_manual_appointment_commissions(date, date, text) to authenticated;

-- Keep service execution at a fixed 50/50 split for new attendances while
-- leaving historical appointments on their original commission rates.
alter table public.appointments
  add column if not exists service_commission_rate_snapshot numeric(5, 4);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'appointments_service_commission_rate_snapshot_range'
       and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_service_commission_rate_snapshot_range
      check (
        service_commission_rate_snapshot is null
        or service_commission_rate_snapshot between 0 and 1
      );
  end if;
end
$$;

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

do $$
begin
  if to_regprocedure('public.get_my_financial_earnings_legacy(date,date,text)') is null then
    execute 'alter function public.get_my_financial_earnings(date, date, text) rename to get_my_financial_earnings_legacy';
  end if;
  if to_regprocedure('public.get_my_plan_usage_earnings_legacy(date,date,text)') is null then
    execute 'alter function public.get_my_plan_usage_earnings(date, date, text) rename to get_my_plan_usage_earnings_legacy';
  end if;
end
$$;

revoke all on function public.get_my_financial_earnings_legacy(date, date, text)
  from public, anon, authenticated;
revoke all on function public.get_my_plan_usage_earnings_legacy(date, date, text)
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
begin
  return query
  select
    legacy.entry_id,
    legacy.entry_date,
    legacy.kind,
    legacy.source,
    legacy.attribution,
    case
      when legacy.entry_id like '%:performer'
       and appointment.service_commission_rate_snapshot is not null
        then round(
          appointment.value::numeric * appointment.service_commission_rate_snapshot::numeric,
          2
        )
      else legacy.amount
    end as amount
  from public.get_my_financial_earnings_legacy(
    p_start_date,
    p_end_date,
    p_professional_id
  ) as legacy
  left join public.appointments appointment
    on appointment.id = split_part(legacy.entry_id, ':', 1)
  where not (
    legacy.entry_id like '%:performer'
    and coalesce(jsonb_array_length(appointment.professional_commissions), 0) > 1
  );
end;
$$;

create or replace function public.get_my_plan_usage_earnings(
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
    legacy.entry_id,
    legacy.entry_date,
    legacy.kind,
    legacy.source,
    legacy.attribution,
    case
      when legacy.entry_id like '%:plan-performer'
       and appointment.service_commission_rate_snapshot is not null
        then round(
          appointment.plan_usage_value::numeric * appointment.service_commission_rate_snapshot::numeric,
          2
        )
      else legacy.amount
    end as amount
  from public.get_my_plan_usage_earnings_legacy(
    p_start_date,
    p_end_date,
    p_professional_id
  ) as legacy
  left join public.appointments appointment
    on appointment.id = split_part(legacy.entry_id, ':', 1)
  where not (
    legacy.entry_id like '%:plan-performer'
    and coalesce(jsonb_array_length(appointment.professional_commissions), 0) > 1
  );
end;
$$;

revoke all on function public.get_my_financial_earnings(date, date, text)
  from public, anon;
grant execute on function public.get_my_financial_earnings(date, date, text)
  to authenticated;
revoke all on function public.get_my_plan_usage_earnings(date, date, text)
  from public, anon;
grant execute on function public.get_my_plan_usage_earnings(date, date, text)
  to authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-24.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

-- Standalone product sales capture price, quantity, discount, and total at sale
-- time. Stock updates and the sale row are committed in the same transaction.
create or replace function public.record_product_sale(
  p_date text,
  p_client_id text,
  p_appointment_id text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_sale_id text := gen_random_uuid()::text;
  v_item jsonb;
  v_product public.products;
  v_product_id text;
  v_quantity integer;
  v_discount_type text;
  v_discount_value numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_discount_amount numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null or not public.has_permission('produtos') then
    raise exception 'product_sale_permission_required' using errcode = '42501';
  end if;
  if p_date is null or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_date <> timezone('America/Sao_Paulo', clock_timestamp())::date::text then
    raise exception 'product_sale_date_must_be_today' using errcode = '22023';
  end if;
  if p_payment_method not in ('debito', 'credito', 'pix', 'dinheiro') then
    raise exception 'invalid_product_sale_payment_method' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'product_sale_items_required' using errcode = '22023';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients client
    where client.id = p_client_id and client.organization_id = v_organization_id
  ) then
    raise exception 'product_sale_client_not_found' using errcode = 'P0001';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.appointments appointment
    where appointment.id = p_appointment_id and appointment.organization_id = v_organization_id
  ) then
    raise exception 'product_sale_appointment_not_found' using errcode = 'P0001';
  end if;

  for v_item in
    select item.value
      from jsonb_array_elements(p_items) as item(value)
     order by item.value->>'productId'
  loop
    v_product_id := nullif(btrim(v_item->>'productId'), '');
    if v_product_id is null
       or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item->>'discountValue', '0') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'invalid_product_sale_item' using errcode = '22023';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    v_discount_type := coalesce(nullif(v_item->>'discountType', ''), 'amount');
    v_discount_value := coalesce((v_item->>'discountValue')::numeric, 0);
    if v_discount_type not in ('amount', 'percent')
       or v_discount_value < 0
       or (v_discount_type = 'percent' and v_discount_value > 100) then
      raise exception 'invalid_product_sale_discount' using errcode = '22023';
    end if;

    select product.*
      into v_product
      from public.products product
     where product.id = v_product_id
       and product.organization_id = v_organization_id
       and product.is_active
     for update;
    if not found then
      raise exception 'product_sale_product_not_found' using errcode = 'P0001';
    end if;
    if v_product.stock < v_quantity then
      raise exception 'product_sale_insufficient_stock:%:%', v_product.name, v_product.stock using errcode = 'P0001';
    end if;

    v_unit_price := round(v_product.price::numeric, 2);
    v_subtotal := round(v_unit_price * v_quantity, 2);
    v_discount_amount := case
      when v_discount_type = 'percent'
        then round(v_subtotal * v_discount_value / 100, 2)
      else round(v_discount_value, 2)
    end;
    if v_discount_amount > v_subtotal then
      raise exception 'product_sale_discount_exceeds_subtotal' using errcode = '22023';
    end if;
    v_line_total := round(v_subtotal - v_discount_amount, 2);
    if v_line_total < 0 then
      raise exception 'product_sale_negative_total' using errcode = '22023';
    end if;
    v_total := v_total + v_line_total;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'unitPrice', v_unit_price,
      'quantity', v_quantity,
      'discountType', v_discount_type,
      'discountValue', v_discount_value,
      'discountAmount', v_discount_amount,
      'total', v_line_total
    ));

    update public.products
       set stock = stock - v_quantity,
           updated_at = now()
     where id = v_product.id
       and organization_id = v_organization_id
       and stock >= v_quantity;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'product_sale_insufficient_stock:%:%', v_product.name, v_product.stock using errcode = 'P0001';
    end if;
  end loop;

  insert into public.product_sales (
    id, date, client_id, appointment_id, payment_method, items, total,
    organization_id, created_by
  ) values (
    v_sale_id, p_date, p_client_id, p_appointment_id, p_payment_method,
    v_items, v_total, v_organization_id, auth.uid()
  );

  return jsonb_build_object(
    'id', v_sale_id, 'date', p_date, 'client_id', p_client_id,
    'appointment_id', p_appointment_id, 'payment_method', p_payment_method,
    'items', v_items, 'total', v_total, 'created_at', now()
  );
end;
$$;
revoke all on function public.record_product_sale(text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.record_product_sale(text, text, text, text, jsonb)
  to authenticated;

-- Reversals preserve the original sale snapshot and are idempotent under
-- concurrent requests: the sale row lock allows stock to be restored only once.
create or replace function public.reverse_product_sale(
  p_sale_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_sale public.product_sales;
  v_item jsonb;
  v_product_id text;
  v_quantity bigint;
  v_reversal_date text;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null or not public.has_permission('produtos') then
    raise exception 'product_sale_permission_required' using errcode = '42501';
  end if;
  if p_sale_id is null or length(btrim(p_sale_id)) = 0 then
    raise exception 'product_sale_id_required' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 500 then
    raise exception 'invalid_product_sale_reversal_reason' using errcode = '22023';
  end if;

  select sale.*
    into v_sale
    from public.product_sales sale
   where sale.id = p_sale_id
     and sale.organization_id = v_organization_id
   for update;
  if not found then
    raise exception 'product_sale_not_found' using errcode = 'P0001';
  end if;
  if v_sale.reversed_at is not null then
    return to_jsonb(v_sale);
  end if;
  if jsonb_typeof(v_sale.items) <> 'array'
     or jsonb_array_length(v_sale.items) = 0
     or exists (
       select 1
         from jsonb_array_elements(v_sale.items) as item(value)
        where coalesce(item.value->>'productId', '') = ''
           or coalesce(item.value->>'quantity', '') !~ '^[1-9][0-9]*$'
     ) then
    raise exception 'invalid_product_sale_snapshot' using errcode = '22023';
  end if;

  for v_item in
    select jsonb_build_object(
             'productId', item.value->>'productId',
             'quantity', sum((item.value->>'quantity')::bigint)
           )
      from jsonb_array_elements(v_sale.items) as item(value)
     group by item.value->>'productId'
     order by item.value->>'productId'
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::bigint;
    update public.products
       set stock = stock + v_quantity,
           updated_at = now()
     where id = v_product_id
       and organization_id = v_organization_id;
    if not found then
      raise exception 'product_sale_reversal_product_not_found:%', v_product_id using errcode = 'P0001';
    end if;
  end loop;

  v_reversal_date := timezone('America/Sao_Paulo', clock_timestamp())::date::text;
  update public.product_sales
     set reversal_date = v_reversal_date,
         reversal_reason = btrim(p_reason),
         reversed_at = clock_timestamp(),
         reversed_by = auth.uid()
   where id = v_sale.id
     and organization_id = v_organization_id
  returning * into v_sale;

  return to_jsonb(v_sale);
end;
$$;

revoke all on function public.reverse_product_sale(text, text)
  from public, anon;
grant execute on function public.reverse_product_sale(text, text)
  to authenticated;

-- Reception can see same-day operational aggregates without access to finance
-- tables or historical reporting.
create or replace function public.get_reception_daily_operations(p_date text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_income jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0}'::jsonb;
  v_expense jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0}'::jsonb;
  v_plan_receipts jsonb := '{"debito":0,"credito":0,"pix":0,"dinheiro":0,"sem_forma":0}'::jsonb;
  v_payment jsonb;
  v_appointment record;
  v_plan record;
  v_exp record;
  v_sales record;
  v_method text;
  v_attendances integer := 0;
  v_plan_uses integer := 0;
  v_expense_total numeric := 0;
  v_income_total numeric := 0;
  v_income_without_method numeric := 0;
  v_plan_total numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  v_organization_id := public.current_organization_id();
  if v_organization_id is null
     or not (
       public.is_manager()
       or (public.current_user_role() = 'recepcao' and public.has_permission('controle'))
     ) then
    raise exception 'daily_operations_permission_required' using errcode = '42501';
  end if;
  if p_date is distinct from timezone('America/Sao_Paulo', clock_timestamp())::date::text then
    raise exception 'daily_operations_current_day_only' using errcode = '42501';
  end if;

  for v_appointment in
    select appointment.*
      from public.appointments appointment
     where appointment.organization_id = v_organization_id
       and appointment.date = p_date
       and appointment.status in ('confirmed', 'completed')
       and (appointment.status = 'completed' or appointment.attendance_recorded_at is not null)
  loop
    v_attendances := v_attendances + 1;
    if v_appointment.plan_subscriber_id is not null
       and v_appointment.attendance_recorded_at is not null then
      v_plan_uses := v_plan_uses + 1;
    end if;
    if jsonb_typeof(v_appointment.payment_splits) = 'array'
       and jsonb_array_length(v_appointment.payment_splits) > 0 then
      for v_payment in select value from jsonb_array_elements(v_appointment.payment_splits)
      loop
        v_method := v_payment->>'method';
        if v_method in ('debito', 'credito', 'pix', 'dinheiro') then
          v_income := jsonb_set(
            v_income, array[v_method],
            to_jsonb(coalesce((v_income->>v_method)::numeric, 0) + coalesce((v_payment->>'amount')::numeric, 0))
          );
          v_income_total := v_income_total + coalesce((v_payment->>'amount')::numeric, 0);
        end if;
      end loop;
    elsif v_appointment.pay_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_appointment.pay_method],
        to_jsonb(coalesce((v_income->>v_appointment.pay_method)::numeric, 0) + v_appointment.value + v_appointment.tip)
      );
      v_income_total := v_income_total + v_appointment.value + v_appointment.tip;
    end if;
  end loop;

  for v_sales in
    select movements.payment_method, sum(movements.total)::numeric as total
      from (
        select sale.payment_method, sale.total as total
          from public.product_sales sale
         where sale.organization_id = v_organization_id and sale.date = p_date
        union all
        select sale.payment_method, -sale.total as total
          from public.product_sales sale
         where sale.organization_id = v_organization_id and sale.reversal_date = p_date
      ) as movements
     group by movements.payment_method
  loop
    v_income := jsonb_set(
      v_income, array[v_sales.payment_method],
      to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
    );
    v_income_total := v_income_total + v_sales.total;
  end loop;

  for v_sales in
    select sale.pay_method1 as payment_method,
           sum(case when sale.installments > 0
             then sale.value::numeric * sale.installments_paid / sale.installments
             else 0 end) as total
      from public.prothesis_sales sale
     where sale.organization_id = v_organization_id and sale.date = p_date
     group by sale.pay_method1
  loop
    if v_sales.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_sales.payment_method],
        to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
      );
      v_income_total := v_income_total + v_sales.total;
    end if;
  end loop;

  for v_sales in
    select income.payment_method, sum(income.amount)::numeric as total
      from public.incomes income
     where income.organization_id = v_organization_id and income.date = p_date
     group by income.payment_method
  loop
    v_income_total := v_income_total + v_sales.total;
    if v_sales.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_income := jsonb_set(
        v_income, array[v_sales.payment_method],
        to_jsonb(coalesce((v_income->>v_sales.payment_method)::numeric, 0) + v_sales.total)
      );
    else
      v_income_without_method := v_income_without_method + v_sales.total;
    end if;
  end loop;

  for v_plan in
    select payment.payment_method, sum(payment.amount)::numeric as total
      from public.subscription_payments payment
     where payment.organization_id = v_organization_id
       and payment.status = 'pago'
       and coalesce(payment.paid_at, payment.due_date) = p_date
     group by payment.payment_method
  loop
    v_plan_total := v_plan_total + v_plan.total;
    if v_plan.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_plan_receipts := jsonb_set(
        v_plan_receipts, array[v_plan.payment_method],
        to_jsonb(coalesce((v_plan_receipts->>v_plan.payment_method)::numeric, 0) + v_plan.total)
      );
    else
      v_plan_receipts := jsonb_set(
        v_plan_receipts, '{sem_forma}',
        to_jsonb(coalesce((v_plan_receipts->>'sem_forma')::numeric, 0) + v_plan.total)
      );
    end if;
  end loop;

  for v_exp in
    select expense.payment_method, sum(expense.amount)::numeric as total
      from public.expenses expense
     where expense.organization_id = v_organization_id and expense.date = p_date
     group by expense.payment_method
  loop
    v_expense_total := v_expense_total + v_exp.total;
    if v_exp.payment_method in ('debito', 'credito', 'pix', 'dinheiro') then
      v_expense := jsonb_set(
        v_expense, array[v_exp.payment_method],
        to_jsonb(coalesce((v_expense->>v_exp.payment_method)::numeric, 0) + v_exp.total)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'date', p_date, 'attendances', v_attendances, 'planUses', v_plan_uses,
    'incomeByMethod', v_income, 'incomeTotal', v_income_total,
    'incomeWithoutMethod', v_income_without_method,
    'expenseByMethod', v_expense, 'expenseTotal', v_expense_total,
    'planReceiptsByMethod', v_plan_receipts, 'planReceiptTotal', v_plan_total
  );
end;
$$;
revoke all on function public.get_reception_daily_operations(text)
  from public, anon;
grant execute on function public.get_reception_daily_operations(text)
  to authenticated;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-11-03.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

-- Keep a restricted recovery copy before any appointment is removed.
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
values ('app_schema_version', '2026-11-03.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
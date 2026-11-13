-- Regression suite for the tenant and professional boundaries.
--
-- Run with `supabase test db` against a disposable Supabase database. The
-- fixture is transactional and uses only the public identity tables, so it
-- never creates real Auth accounts or leaves business data behind.

begin;

create extension if not exists pgtap;

select plan(220);
select is(to_regclass('public.chatwoot_integrations'), null::regclass, 'Chatwoot integration table is removed');

select is(
  (select count(*) from storage.buckets where id in ('avatars', 'logos') and public = false),
  2::bigint,
  'avatar and logo buckets are private'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_settings'
      and policyname = 'organization_settings_access'),
  0::bigint,
  'legacy organization settings policy is removed'
);
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_settings'
      and policyname = 'organization_settings_empresa_access'),
  0::bigint,
  'legacy organization settings empresa policy is removed'
);
select ok(
  (select pg_get_functiondef(p.oid) like '%extensions.digest%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_organization_invitation'
    limit 1),
  'invitation creation hashes with extensions.digest'
);
select ok(
  (select pg_get_functiondef(p.oid) like '%extensions.digest%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'accept_organization_invitation'
    limit 1),
  'invitation acceptance hashes with extensions.digest'
);
select ok(
  (select pg_get_functiondef(p.oid) like '%extensions.gen_random_bytes%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_organization_invitation'
    limit 1),
  'invitation creation generates tokens with extensions.gen_random_bytes'
);
select is(
  to_regprocedure('public.create_organization_invitation_by_phone(text,text,integer)'),
  null::regprocedure,
  'phone invitation creation RPC is removed'
);

-- Seed two organizations, one manager, one seller and one operational
-- professional in organization A, plus a manager and data in organization B.
-- The fixture is inserted as the database owner because the organization
-- assignment trigger is intentionally enforced for authenticated clients.
set local session_replication_role = replica;

insert into public.organizations (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Organização A'),
  ('22222222-2222-2222-2222-222222222222', 'Organização B');

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('10000000-0000-0000-0000-000000000001', 'gestor-a@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'vendedor-a@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'operacional-a@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000007', 'recepcao-a@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000008', 'dev-admin-a@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-0000-0000-000000000001', 'gestor-b@example.com', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into auth.users (id, email, phone, phone_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('10000000-0000-0000-0000-000000000004', null, '+5511999999999', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000005', null, '+5511888888888', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000006', null, '+5511777777777', null, 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, email, full_name, default_organization_id) values
  ('10000000-0000-0000-0000-000000000001', 'gestor-a@example.com', 'Gestor A', '11111111-1111-1111-1111-111111111111'),
  ('10000000-0000-0000-0000-000000000002', 'vendedor-a@example.com', 'Vendedor A', '11111111-1111-1111-1111-111111111111'),
  ('10000000-0000-0000-0000-000000000003', 'operacional-a@example.com', 'Operacional A', '11111111-1111-1111-1111-111111111111'),
  ('10000000-0000-0000-0000-000000000007', 'recepcao-a@example.com', 'Recepção A', null),
  ('10000000-0000-0000-0000-000000000008', 'dev-admin-a@example.com', 'DEV Admin A', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000001', 'gestor-b@example.com', 'Gestor B', '22222222-2222-2222-2222-222222222222'),
  ('10000000-0000-0000-0000-000000000004', '', 'Convidado por SMS', null),
  ('10000000-0000-0000-0000-000000000005', '', 'Outro convidado por SMS', null),
  ('10000000-0000-0000-0000-000000000006', '', 'Telefone não confirmado', null);

insert into public.professionals (id, name, role, organization_id) values
  ('professional-a-seller', 'Vendedor A', 'vendedor', '11111111-1111-1111-1111-111111111111'),
  ('professional-a-operator', 'Operacional A', 'barbeiro', '11111111-1111-1111-1111-111111111111'),
  ('professional-b-seller', 'Vendedor B', 'vendedor', '22222222-2222-2222-2222-222222222222'),
  ('professional-a-phone-create', 'Convidado SMS criação', 'barbeiro', '11111111-1111-1111-1111-111111111111'),
  ('professional-a-phone-accept', 'Convidado SMS aceitação', 'barbeiro', '11111111-1111-1111-1111-111111111111'),
  ('professional-a-phone-unconfirmed', 'Convidado SMS sem confirmação', 'barbeiro', '11111111-1111-1111-1111-111111111111');

insert into public.organization_members (organization_id, user_id, role, professional_id) values
  ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'gestor', null),
  ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', 'vendedor', 'professional-a-seller'),
  ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003', 'barbeiro', 'professional-a-operator'),
  ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000008', 'dev-admin', null),
  ('22222222-2222-2222-2222-222222222222', '20000000-0000-0000-0000-000000000001', 'gestor', null);

insert into public.organization_settings (organization_id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

update public.organization_settings
   set payload = jsonb_build_object(
     'roles',
     jsonb_build_array(jsonb_build_object(
       'key', 'recepcao',
       'permissions', '["dashboard","agenda","controle","clientes","produtos"]'::jsonb
     ))
   )
 where organization_id = '11111111-1111-1111-1111-111111111111';

insert into storage.objects (id, bucket_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'avatars', '10000000-0000-0000-0000-000000000001/avatar.png'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'avatars', '10000000-0000-0000-0000-000000000002/avatar.png'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'avatars', '20000000-0000-0000-0000-000000000001/avatar.png'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'logos', '11111111-1111-1111-1111-111111111111/logo.png'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'logos', '22222222-2222-2222-2222-222222222222/logo.png');

insert into public.appointments (id, date, time, client, professional_id, service, organization_id) values
  ('appointment-a-seller', '2026-08-27', '09:00', 'Cliente Vendedor A', 'professional-a-seller', 'Prótese', '11111111-1111-1111-1111-111111111111'),
  ('appointment-a-operator', '2026-08-27', '10:00', 'Cliente Operacional A', 'professional-a-operator', 'Corte', '11111111-1111-1111-1111-111111111111'),
  ('appointment-b-seller', '2026-08-27', '11:00', 'Cliente Vendedor B', 'professional-b-seller', 'Prótese', '22222222-2222-2222-2222-222222222222');

insert into public.blocks (id, date, professional_id, reason, organization_id) values
  ('block-a-seller', '2026-08-27', 'professional-a-seller', 'Pausa', '11111111-1111-1111-1111-111111111111'),
  ('block-a-operator', '2026-08-27', 'professional-a-operator', 'Folga', '11111111-1111-1111-1111-111111111111'),
  ('block-b-seller', '2026-08-27', 'professional-b-seller', 'Pausa', '22222222-2222-2222-2222-222222222222');

insert into public.prothesis_sales (id, date, client, value, seller_id, organization_id) values
  ('sale-a-seller', '2026-08-27', 'Cliente Venda A', 100, 'professional-a-seller', '11111111-1111-1111-1111-111111111111'),
  ('sale-a-operator', '2026-08-27', 'Cliente Operacional A', 300, 'professional-a-operator', '11111111-1111-1111-1111-111111111111'),
  ('sale-b-seller', '2026-08-27', 'Cliente Venda B', 200, 'professional-b-seller', '22222222-2222-2222-2222-222222222222');

insert into public.mentoria_sessions (id, date, client, seller_id, organization_id) values
  ('mentoria-a-seller', '2026-08-27', 'Cliente Mentoria A', 'professional-a-seller', '11111111-1111-1111-1111-111111111111'),
  ('mentoria-a-operator', '2026-08-27', 'Cliente Operacional A', 'professional-a-operator', '11111111-1111-1111-1111-111111111111'),
  ('mentoria-b-seller', '2026-08-27', 'Cliente Mentoria B', 'professional-b-seller', '22222222-2222-2222-2222-222222222222');

insert into public.expenses (id, date, description, amount, category, organization_id) values
  ('expense-a', '2026-08-27', 'Despesa A', 100, 'Outros', '11111111-1111-1111-1111-111111111111'),
  ('expense-b', '2026-08-27', 'Despesa B', 200, 'Outros', '22222222-2222-2222-2222-222222222222');

insert into public.incomes (id, date, description, amount, organization_id) values
  ('income-a', '2026-08-27', 'Receita A', 300, '11111111-1111-1111-1111-111111111111'),
  ('income-b', '2026-08-27', 'Receita B', 400, '22222222-2222-2222-2222-222222222222');

insert into public.subscription_plans (id, name, price, organization_id) values
  ('plan-a', 'Plano A', 100, '11111111-1111-1111-1111-111111111111'),
  ('plan-b', 'Plano B', 200, '22222222-2222-2222-2222-222222222222');

insert into public.clients (id, name, organization_id) values
  ('client-a-reception', 'Cliente Recepção A', '11111111-1111-1111-1111-111111111111'),
  ('client-a-reception-delete', 'Cliente para exclusão pela recepção', '11111111-1111-1111-1111-111111111111');

insert into public.products (id, name, category, price, cost, stock, min_stock, organization_id) values
  ('product-a-reception', 'Produto Recepção A', 'Teste', 10, 4, 10, 1, '11111111-1111-1111-1111-111111111111');

insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment, organization_id) values
  ('subscriber-a-seller', 'Assinante A', 'plan-a', 'professional-a-seller', '2026-08-01', '2026-09-01', '11111111-1111-1111-1111-111111111111'),
  ('subscriber-a-operator', 'Assinante Operacional A', 'plan-a', 'professional-a-operator', '2026-08-01', '2026-09-01', '11111111-1111-1111-1111-111111111111'),
  ('subscriber-b-seller', 'Assinante B', 'plan-b', 'professional-b-seller', '2026-08-01', '2026-09-01', '22222222-2222-2222-2222-222222222222');

reset session_replication_role;

-- Manager A can read every resource in organization A.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '10000000-0000-0000-0000-000000000001/avatar.png'), 1::bigint, 'manager reads own avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '10000000-0000-0000-0000-000000000002/avatar.png'), 0::bigint, 'manager cannot read another user avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '20000000-0000-0000-0000-000000000001/avatar.png'), 0::bigint, 'manager cannot read an avatar from another organization');
select lives_ok($$insert into storage.objects (id, bucket_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', 'avatars', '10000000-0000-0000-0000-000000000001/new-avatar.png')$$, 'user can write an avatar under own path');
select throws_ok($$insert into storage.objects (id, bucket_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaac', 'avatars', '10000000-0000-0000-0000-000000000002/forged-avatar.png')$$, null, null, 'user cannot write an avatar under another user path');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '11111111-1111-1111-1111-111111111111/logo.png'), 1::bigint, 'manager reads own organization logo');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '22222222-2222-2222-2222-222222222222/logo.png'), 0::bigint, 'manager cannot read a logo from another organization');
select lives_ok($$insert into storage.objects (id, bucket_id, name) values ('dddddddd-dddd-dddd-dddd-ddddddddddde', 'logos', '11111111-1111-1111-1111-111111111111/new-logo.png')$$, 'manager can write own organization logo');
select throws_ok($$insert into storage.objects (id, bucket_id, name) values ('dddddddd-dddd-dddd-dddd-dddddddddddf', 'logos', '22222222-2222-2222-2222-222222222222/forged-logo.png')$$, null, null, 'manager cannot write a logo from another organization');
select is((select count(*) from public.appointments), 2::bigint, 'manager reads all appointments in own organization');
select is((select count(*) from public.blocks), 2::bigint, 'manager reads all blocks in own organization');
select is((select count(*) from public.prothesis_sales), 2::bigint, 'manager reads all sales in own organization');
select is((select count(*) from public.mentoria_sessions), 2::bigint, 'manager reads all mentoring sessions in own organization');
select is((select count(*) from public.subscription_plans), 1::bigint, 'manager reads plans in own organization');
select is((select count(*) from public.subscribers), 2::bigint, 'manager reads subscriptions in own organization');
select is((select count(*) from public.expenses), 1::bigint, 'manager reads expenses in own organization');
select is((select count(*) from public.incomes), 1::bigint, 'manager reads incomes in own organization');
select is((select count(*) from public.finance_entry_changes), 0::bigint, 'finance history starts empty');
select lives_ok($$update public.incomes set description = 'Receita A corrigida', amount = 350 where id = 'income-a'$$, 'manager can update an income and create history');
select lives_ok($$update public.expenses set category = 'Marketing', amount = 125 where id = 'expense-a'$$, 'manager can update an expense and create history');
select is((select count(*) from public.finance_entry_changes), 2::bigint, 'finance history records each financial update');
select is((select previous_values ->> 'amount' from public.finance_entry_changes where entry_id = 'income-a'), '300', 'income history stores the previous amount');
select is((select new_values ->> 'amount' from public.finance_entry_changes where entry_id = 'income-a'), '350', 'income history stores the new amount');
select is((select changed_by_name from public.finance_entry_changes where entry_id = 'expense-a'), 'Gestor A', 'finance history stores the actor name');

select lives_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('manager-appointment', '2026-08-28', '09:00', 'Cliente Gestor', 'professional-a-operator', 'Corte')$$, 'manager can create an appointment for any own professional');
select lives_ok($$update public.appointments set professional_id = 'professional-a-seller' where id = 'manager-appointment'$$, 'manager can reassign an appointment within own organization');
select lives_ok($$delete from public.appointments where id = 'manager-appointment'$$, 'manager can delete an appointment in own organization');
select lives_ok($$insert into public.blocks (id, date, professional_id, reason) values ('manager-block', '2026-08-28', 'professional-a-operator', 'Reunião')$$, 'manager can create a block for any own professional');
select lives_ok($$update public.blocks set professional_id = 'professional-a-seller' where id = 'manager-block'$$, 'manager can reassign a block within own organization');
select lives_ok($$delete from public.blocks where id = 'manager-block'$$, 'manager can delete a block in own organization');
select lives_ok($$insert into public.prothesis_sales (id, date, client, value, seller_id) values ('manager-sale', '2026-08-28', 'Cliente Gestor', 150, 'professional-a-operator')$$, 'manager can create a sale for any own professional');
select lives_ok($$update public.prothesis_sales set value = 175 where id = 'manager-sale'$$, 'manager can update a sale in own organization');
select lives_ok($$delete from public.prothesis_sales where id = 'manager-sale'$$, 'manager can delete a sale in own organization');
select lives_ok($$insert into public.mentoria_sessions (id, date, client, seller_id) values ('manager-mentoria', '2026-08-28', 'Cliente Gestor', 'professional-a-operator')$$, 'manager can create mentoring for any own professional');
select lives_ok($$update public.mentoria_sessions set value = 175 where id = 'manager-mentoria'$$, 'manager can update mentoring in own organization');
select lives_ok($$delete from public.mentoria_sessions where id = 'manager-mentoria'$$, 'manager can delete mentoring in own organization');
select lives_ok($$insert into public.subscription_plans (id, name, price) values ('manager-plan', 'Plano Gestor', 150)$$, 'manager can create a subscription plan');
select lives_ok($$update public.subscription_plans set price = 175 where id = 'manager-plan'$$, 'manager can update a subscription plan');
select lives_ok($$delete from public.subscription_plans where id = 'manager-plan'$$, 'manager can delete a subscription plan');
select lives_ok($$insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment) values ('manager-subscriber', 'Assinante Gestor', 'plan-a', 'professional-a-operator', '2026-08-01', '2026-09-01')$$, 'manager can create a subscription');
select lives_ok($$update public.subscribers set status = 'pendente' where id = 'manager-subscriber'$$, 'manager can update a subscription');
select lives_ok($$delete from public.subscribers where id = 'manager-subscriber'$$, 'manager can delete a subscription');
select throws_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('manager-foreign-appointment', '2026-08-28', '09:00', 'Cliente', 'professional-b-seller', 'Prótese')$$, null, null, 'manager cannot attach a foreign organization professional to an appointment');
select throws_ok($$insert into public.blocks (id, date, professional_id, reason) values ('manager-foreign-block', '2026-08-28', 'professional-b-seller', 'Pausa')$$, null, null, 'manager cannot attach a foreign organization professional to a block');
select throws_ok($$insert into public.prothesis_sales (id, date, client, value, seller_id) values ('manager-foreign-sale', '2026-08-28', 'Cliente', 150, 'professional-b-seller')$$, null, null, 'manager cannot attach a foreign organization professional to a sale');
select throws_ok($$insert into public.mentoria_sessions (id, date, client, seller_id) values ('manager-foreign-mentoria', '2026-08-28', 'Cliente', 'professional-b-seller')$$, null, null, 'manager cannot attach a foreign organization professional to mentoring');
select throws_ok($$insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment) values ('manager-foreign-subscriber', 'Assinante', 'plan-b', 'professional-b-seller', '2026-08-01', '2026-09-01')$$, null, null, 'manager cannot attach foreign organization plan or professional to a subscription');
reset role;
set local role service_role;
reset role;
set local role authenticated;

-- Seller A is restricted to the seller professional for agenda, sales and
-- mentoring. Plans and subscribers are manager-only.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '10000000-0000-0000-0000-000000000002/avatar.png'), 1::bigint, 'seller reads own avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '10000000-0000-0000-0000-000000000001/avatar.png'), 0::bigint, 'seller cannot read another user avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '20000000-0000-0000-0000-000000000001/avatar.png'), 0::bigint, 'seller cannot read an avatar from another organization');
select lives_ok($$insert into storage.objects (id, bucket_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc', 'avatars', '10000000-0000-0000-0000-000000000002/new-avatar.png')$$, 'seller can write an avatar under own path');
select throws_ok($$insert into storage.objects (id, bucket_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbd', 'avatars', '10000000-0000-0000-0000-000000000001/forged-avatar.png')$$, null, null, 'seller cannot write an avatar under another user path');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '11111111-1111-1111-1111-111111111111/logo.png'), 0::bigint, 'seller cannot read the current organization logo');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '22222222-2222-2222-2222-222222222222/logo.png'), 0::bigint, 'seller cannot read a logo from another organization');
select throws_ok($$insert into storage.objects (id, bucket_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbe', 'logos', '11111111-1111-1111-1111-111111111111/forged-logo.png')$$, null, null, 'seller cannot write the current organization logo');
select throws_ok($$insert into storage.objects (id, bucket_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbf', 'logos', '22222222-2222-2222-2222-222222222222/forged-logo.png')$$, null, null, 'seller cannot write a logo from another organization');
select is((select count(*) from public.appointments), 1::bigint, 'seller reads only own appointments');
select is((select count(*) from public.blocks), 1::bigint, 'seller reads only own blocks');
select is((select count(*) from public.prothesis_sales), 1::bigint, 'seller reads only own sales');
select is((select count(*) from public.mentoria_sessions), 1::bigint, 'seller reads only own mentoring sessions');
select is((select count(*) from public.subscription_plans), 0::bigint, 'seller cannot read subscription plans');
select is((select count(*) from public.subscribers), 0::bigint, 'seller cannot read subscriptions');
select is((select count(*) from public.finance_entry_changes), 0::bigint, 'seller cannot read finance history');
select lives_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('seller-appointment', '2026-08-28', '09:00', 'Cliente Vendedor', 'professional-a-seller', 'Prótese')$$, 'seller can create own appointment');
select lives_ok($$update public.appointments set status = 'confirmed' where id = 'seller-appointment'$$, 'seller can update own appointment');
select lives_ok($$insert into public.blocks (id, date, professional_id, reason) values ('seller-block', '2026-08-28', 'professional-a-seller', 'Pausa')$$, 'seller can create own block');
select lives_ok($$update public.blocks set reason = 'Reunião' where id = 'seller-block'$$, 'seller can update own block');
select lives_ok($$insert into public.prothesis_sales (id, date, client, value, seller_id) values ('seller-sale', '2026-08-28', 'Cliente Vendedor', 125, 'professional-a-seller')$$, 'seller can create own sale');
select lives_ok($$update public.prothesis_sales set value = 140 where id = 'seller-sale'$$, 'seller can update own sale');
select lives_ok($$insert into public.mentoria_sessions (id, date, client, seller_id) values ('seller-mentoria', '2026-08-28', 'Cliente Vendedor', 'professional-a-seller')$$, 'seller can create own mentoring');
select lives_ok($$update public.mentoria_sessions set value = 140 where id = 'seller-mentoria'$$, 'seller can update own mentoring');
select throws_ok($$insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment) values ('seller-subscriber', 'Assinante Vendedor', 'plan-a', 'professional-a-seller', '2026-08-01', '2026-09-01')$$, null, null, 'seller cannot create subscriptions');
select throws_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('seller-other-appointment', '2026-08-28', '09:00', 'Cliente', 'professional-a-operator', 'Corte')$$, null, null, 'seller cannot create an appointment for another professional');
select throws_ok($$update public.appointments set professional_id = 'professional-a-operator' where id = 'seller-appointment'$$, null, null, 'seller cannot change the professional of an appointment');
select throws_ok($$insert into public.appointments (id, date, time, client, professional_id, service, organization_id) values ('seller-cross-org', '2026-08-28', '09:00', 'Cliente', 'professional-b-seller', 'Prótese', '22222222-2222-2222-2222-222222222222')$$, null, null, 'seller cannot write another organization context');
select throws_ok($$update public.profiles set default_organization_id = '22222222-2222-2222-2222-222222222222' where id = '10000000-0000-0000-0000-000000000002'$$, null, null, 'browser cannot change the default organization');
select lives_ok($$
  with attempted as (
    update public.organization_members
       set role = 'gestor', professional_id = null
     where user_id = '10000000-0000-0000-0000-000000000002'
    returning user_id
  )
  select 1 / case when exists (select 1 from attempted) then 0 else 1 end
$$, 'browser cannot change organization or professional membership');
select lives_ok($$update public.prothesis_sales set value = 999 where id = 'sale-a-operator'$$, 'seller update of another sale is filtered by RLS');
reset role;
select is((select value from public.prothesis_sales where id = 'sale-a-operator'), 300::double precision, 'seller cannot change another professional sale');

-- Operational A can use only the own agenda and blocks and cannot use sales,
-- mentoring or subscriptions.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.appointments), 1::bigint, 'operational professional reads own appointments');
select is((select count(*) from public.blocks), 1::bigint, 'operational professional reads own blocks');
select is((select count(*) from public.prothesis_sales), 0::bigint, 'operational professional cannot read sales');
select is((select count(*) from public.mentoria_sessions), 0::bigint, 'operational professional cannot read mentoring');
select is((select count(*) from public.subscribers), 0::bigint, 'operational professional cannot read subscriptions');
select lives_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('operator-appointment', '2026-08-28', '10:00', 'Cliente Operacional', 'professional-a-operator', 'Corte')$$, 'operational professional can create own appointment');
select lives_ok($$update public.blocks set reason = 'Compromisso' where id = 'block-a-operator'$$, 'operational professional can update own block');
select throws_ok($$insert into public.prothesis_sales (id, date, client, value, seller_id) values ('operator-sale', '2026-08-28', 'Cliente Operacional', 90, 'professional-a-operator')$$, null, null, 'operational professional cannot create sales');
select throws_ok($$insert into public.mentoria_sessions (id, date, client, seller_id) values ('operator-mentoria', '2026-08-28', 'Cliente Operacional', 'professional-a-operator')$$, null, null, 'operational professional cannot create mentoring');
select throws_ok($$insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment) values ('operator-subscriber', 'Assinante Operacional', 'plan-a', 'professional-a-operator', '2026-08-01', '2026-09-01')$$, null, null, 'operational professional cannot create subscriptions');
select throws_ok($$insert into public.appointments (id, date, time, client, professional_id, service) values ('operator-other-appointment', '2026-08-28', '10:00', 'Cliente', 'professional-a-seller', 'Prótese')$$, null, null, 'operational professional cannot create an appointment for another professional');

-- A receptionist accepts an email invitation without a professional profile,
-- can load operational data and records the appointment for its actual performer.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select ok(
  to_regprocedure('public.create_reception_invitation(text,integer)') is not null,
  'reception email invitation RPC exists'
);
select ok(
  nullif(set_config(
    'test.reception_invitation_token',
    public.create_reception_invitation('recepcao-a@example.com')->>'token',
    true
  ), '') is not null,
  'manager creates an email invitation for reception'
);
reset role;
set local role anon;
select ok(
  nullif(set_config(
    'test.reception_invitation_info',
    public.get_public_organization_invitation_info(current_setting('test.reception_invitation_token'))::text,
    true
  ), '') is not null,
  'public email invitation details are available'
);
select is(
  current_setting('test.reception_invitation_info')::jsonb->>'channel',
  'email',
  'reception invitation uses the email channel'
);
select is(
  current_setting('test.reception_invitation_info')::jsonb->>'status',
  'valid',
  'public reception invitation is valid'
);
select is(
  current_setting('test.reception_invitation_info')::jsonb->>'email',
  'recepcao-a@example.com',
  'public invitation exposes the invited email'
);
select is(
  current_setting('test.reception_invitation_info')::jsonb->>'professional_name',
  'Recepção',
  'reception invitation does not require a professional card'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
set local role authenticated;
select set_config(
  'test.reception_acceptance',
  public.accept_organization_invitation(current_setting('test.reception_invitation_token'))::text,
  true
);
select is(
  current_setting('test.reception_acceptance')::jsonb->>'role',
  'recepcao',
  'accepting a reception invitation creates the reception role'
);
select is(
  current_setting('test.reception_acceptance')::jsonb->>'professional_id',
  null::text,
  'reception membership has no professional id'
);
select is(public.current_user_role(), 'recepcao', 'reception membership is active for the account');
select is(public.current_professional_id(), null::text, 'reception account has no professional profile');
select is(
  public.has_permission('agenda') and public.has_permission('controle')
    and public.has_permission('clientes') and public.has_permission('produtos')
    and public.has_permission('planos'),
  true,
  'reception has its operational module permissions'
);
select is(
  public.has_permission('financeiro') or public.has_permission('profissionais')
    or public.has_permission('configuracoes') or public.has_permission('comunicacao'),
  false,
  'reception is denied finance, team, settings, and messaging permissions'
);
select is(
  public.has_permission('planos'),
  true,
  'reception always retains plan management when saved permissions are stale'
);
select lives_ok(
  $$insert into public.subscription_plans (id, name, price, organization_id)
    values ('reception-plan', 'Plano Recepção', 150, '11111111-1111-1111-1111-111111111111')$$,
  'reception can create a subscription plan'
);
select lives_ok(
  $$update public.subscription_plans set price = 175 where id = 'reception-plan'$$,
  'reception can edit a subscription plan'
);
select lives_ok(
  $$insert into public.subscribers (id, name, plan_id, professional_id, start_date, next_payment, organization_id)
    values ('reception-subscriber', 'Assinante Recepção', 'reception-plan', null, '2026-08-01', '2026-09-01', '11111111-1111-1111-1111-111111111111')$$,
  'reception can add a subscriber without assigning a professional'
);
select lives_ok(
  $$select public.set_subscription_payment_status('reception-subscriber', '2026-09-01', 'pago', '2026-09-01', 175, 'pix', 'Recebido na recepção')$$,
  'reception can confirm a subscription payment'
);
select is(
  (select next_payment from public.subscribers where id = 'reception-subscriber'),
  '2026-10-01',
  'confirmed payment advances the subscriber due date'
);
select is((select count(*) from public.professionals), 5::bigint, 'reception sees only the five professionals in its organization');
select is((select count(*) from public.clients where id = 'client-a-reception'), 1::bigint, 'reception can read clients');
select is((select count(*) from public.products where id = 'product-a-reception'), 1::bigint, 'reception can read products');
select lives_ok(
  $$select public.adjust_product_stock('product-a-reception', -2)$$,
  'reception can consume product stock'
);
select is(
  (select stock from public.products where id = 'product-a-reception'),
  8,
  'consumed product quantity is deducted from inventory'
);
select lives_ok(
  $$update public.clients
       set visits = visits || '[{"id":"reception-visit","type":"servico","description":"Corte","professional":"Operacional A","amount":50}]'::jsonb
     where id = 'client-a-reception'$$,
  'reception can save the client visit history'
);
select lives_ok(
  $$delete from public.clients where id = 'client-a-reception-delete'$$,
  'reception can delete a client in its organization'
);
select is(
  (select count(*) from public.clients where id = 'client-a-reception-delete'),
  0::bigint,
  'reception client deletion is confirmed in the database'
);
select lives_ok(
  $$insert into public.appointments (
       id, date, time, client, client_id, professional_id, service, status,
       value, products, organization_id
     ) values (
       'reception-appointment', '2026-08-28', '10:15', 'Cliente Recepção A',
       'client-a-reception', 'professional-a-operator', 'Corte', 'confirmed',
       50, '[{"productId":"product-a-reception","quantity":2}]'::jsonb,
       '11111111-1111-1111-1111-111111111111'
     )$$,
  'reception can record an appointment without an RLS error'
);
select is(
  (select professional_id from public.appointments where id = 'reception-appointment'),
  'professional-a-operator',
  'reception appointment stays assigned to the selected professional'
);
select is(
  (select client_id from public.appointments where id = 'reception-appointment'),
  'client-a-reception',
  'reception appointment stays linked to its client'
);
select is(
  (select products from public.appointments where id = 'reception-appointment'),
  '[{"productId":"product-a-reception","quantity":2}]'::jsonb,
  'reception appointment retains the consumed product'
);
select lives_ok(
  $$update public.appointments set status = 'completed' where id = 'reception-appointment'$$,
  'reception can mark the appointment as completed'
);
select lives_ok(
  $$delete from public.appointments where id = 'reception-appointment'$$,
  'reception can delete an attendance within 24 hours'
);
select is(
  (select professional_id from public.organization_members where user_id = '10000000-0000-0000-0000-000000000007'),
  null::text,
  'reception is not linked to a professional card'
);
select throws_ok(
  $$select * from public.get_my_financial_earnings('2026-08-01', '2026-08-31', null)$$,
  '42501',
  'personal_finance_not_available_for_role',
  'reception does not receive a professional commission statement'
);

-- Organization A must never see organization B, and even its manager cannot
-- inject or move a row into the other organization.
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.appointments where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read appointments from another organization');
select is((select count(*) from public.blocks where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read blocks from another organization');
select is((select count(*) from public.prothesis_sales where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read sales from another organization');
select is((select count(*) from public.mentoria_sessions where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read mentoring from another organization');
select is((select count(*) from public.subscription_plans where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read plans from another organization');
select is((select count(*) from public.subscribers where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read subscriptions from another organization');
select is((select count(*) from public.finance_entry_changes where organization_id = '22222222-2222-2222-2222-222222222222'), 0::bigint, 'manager cannot read finance history from another organization');
select throws_ok($$insert into public.appointments (id, date, time, client, professional_id, service, organization_id) values ('manager-cross-org', '2026-08-28', '09:00', 'Cliente', 'professional-b-seller', 'Prótese', '22222222-2222-2222-2222-222222222222')$$, null, null, 'manager cannot create a row in another organization');
select throws_ok($$update public.appointments set organization_id = '22222222-2222-2222-2222-222222222222' where id = 'appointment-a-seller'$$, null, null, 'manager cannot move a row to another organization');

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '20000000-0000-0000-0000-000000000001/avatar.png'), 1::bigint, 'manager of organization B reads own avatar');
select is((select count(*) from storage.objects where bucket_id = 'avatars' and name = '10000000-0000-0000-0000-000000000001/avatar.png'), 0::bigint, 'manager of organization B cannot read an avatar from organization A');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '22222222-2222-2222-2222-222222222222/logo.png'), 1::bigint, 'manager of organization B reads own organization logo');
select is((select count(*) from storage.objects where bucket_id = 'logos' and name = '11111111-1111-1111-1111-111111111111/logo.png'), 0::bigint, 'manager of organization B cannot read a logo from organization A');

-- A linked professional can be deleted without removing business history.
reset role;
insert into public.organization_invitations (organization_id, email, professional_id, role, token_hash, expires_at, invited_by, accepted_at) values
  ('11111111-1111-1111-1111-111111111111', 'pending@example.test', 'professional-a-seller', 'vendedor', 'pgtap-delete-professional-pending', now() + interval '1 day', '10000000-0000-0000-0000-000000000001', null),
  ('11111111-1111-1111-1111-111111111111', 'accepted@example.test', 'professional-a-seller', 'vendedor', 'pgtap-delete-professional-accepted', now() + interval '1 day', '10000000-0000-0000-0000-000000000001', now());
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.delete_professional_preserving_history('professional-a-seller')$$, 'manager deletes a professional with linked history');
select is((select count(*) from public.professionals where id = 'professional-a-seller'), 0::bigint, 'deleted professional no longer exists');
select ok(exists(select 1 from public.appointments where professional_id is null), 'manager still sees detached appointments');
select ok(exists(select 1 from public.blocks where professional_id is null), 'manager still sees detached blocks');
select is((select value from public.prothesis_sales where id = 'sale-a-seller' and seller_id is null), 100::double precision, 'detached sale keeps its original value');
select ok(exists(select 1 from public.mentoria_sessions where seller_id is null), 'manager still sees detached mentoring');
select ok(exists(select 1 from public.subscribers where id = 'subscriber-a-seller' and professional_id is null), 'subscription survives professional deletion');
select is(public.is_current_organization_professional(null), true, 'manager can access unassigned historical ownership');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.appointments where professional_id is null), 0::bigint, 'operational professional cannot read detached history');
reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.appointments where professional_id is null), 0::bigint, 'another organization manager cannot read detached history');
reset role;
select is((select count(*) from public.organization_members where user_id = '10000000-0000-0000-0000-000000000002' and professional_id is null and not is_active), 1::bigint, 'linked account loses organization access');
select ok(exists(select 1 from public.organization_invitations where token_hash = 'pgtap-delete-professional-pending' and professional_id is null and revoked_at is not null), 'pending invitation is preserved and revoked');
select ok(exists(select 1 from public.organization_invitations where token_hash = 'pgtap-delete-professional-accepted' and professional_id is null and accepted_at is not null and revoked_at is null), 'accepted invitation history is preserved without violating acceptance constraint');

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.organization_invitations
    where phone = '+5511999999999' and accepted_at is null and revoked_at is null),
  0::bigint,
  'phone invitations are no longer created'
);
select throws_ok(
  $$select public.create_organization_invitation_by_phone('professional-a-phone-create', '+123', 7)$$,
  null,
  null,
  'the removed phone invitation RPC cannot be called'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(public.is_manager(), false, 'an account without an active salon is never treated as a manager');
select ok(
  not has_function_privilege('authenticated', 'public.enforce_email_only_join_requests()', 'EXECUTE'),
  'email-only join request guard is not callable by clients'
);

reset role;
insert into public.organization_invitations (
  id, organization_id, email, phone, professional_id, role, token_hash, expires_at, invited_by
) values
  (
    'f1000000-0000-0000-0000-000000000021',
    '11111111-1111-1111-1111-111111111111',
    null,
    '+5511999999999',
    'professional-a-phone-accept',
    'barbeiro',
    encode(extensions.digest('pgtap-phone-accept-token', 'sha256'), 'hex'),
    now() + interval '1 day',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    'f1000000-0000-0000-0000-000000000022',
    '11111111-1111-1111-1111-111111111111',
    null,
    '+5511777777777',
    'professional-a-phone-unconfirmed',
    'barbeiro',
    encode(extensions.digest('pgtap-phone-unconfirmed-token', 'sha256'), 'hex'),
    now() + interval '1 day',
    '10000000-0000-0000-0000-000000000001'
  );
update public.deployment_settings
   set enabled = true
 where setting_key = 'organization_creation_enabled';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.bootstrap_organization('Empresa avulsa', '', '')$$,
  'P0001',
  'accept your pending invitation before creating an organization',
  'phone-invited user cannot create a separate organization'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select throws_ok(
  $$select public.accept_organization_invitation('pgtap-phone-accept-token')$$,
  'P0001',
  'this invitation belongs to another phone',
  'phone invitation rejects an account with a different number'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select throws_ok(
  $$select public.accept_organization_invitation('pgtap-phone-unconfirmed-token')$$,
  'P0001',
  'invitation phone not confirmed',
  'phone invitation rejects a number without confirmed SMS'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.accept_organization_invitation('pgtap-phone-accept-token')$$,
  'P0001',
  'phone invitations are disabled',
  'a legacy phone invitation cannot be accepted'
);
reset role;

reset role;
insert into public.organization_invitations (id, organization_id, email, role, token_hash, expires_at, invited_by) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'delete-a@example.test', 'vendedor', 'pgtap-delete-invitation-a', now() + interval '1 day', '10000000-0000-0000-0000-000000000001'),
  ('f2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'delete-b@example.test', 'vendedor', 'pgtap-delete-invitation-b', now() + interval '1 day', '20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.delete_organization_invitation('f1000000-0000-0000-0000-000000000001')$$, 'manager deletes an invitation from the current organization');
select is((select count(*) from public.organization_invitations where id = 'f1000000-0000-0000-0000-000000000001'), 0::bigint, 'deleted invitation is removed from history');
select throws_ok($$select public.delete_organization_invitation('f2000000-0000-0000-0000-000000000001')$$, 'P0001', 'invitation not found or not permitted', 'manager cannot delete invitation from another organization');

reset role;
insert into public.organization_invitations (id, organization_id, email, role, token_hash, expires_at, invited_by, accepted_at, revoked_at) values
  ('f1000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'expired-cleanup-a@example.test', 'vendedor', 'pgtap-cleanup-expired-a', now() - interval '1 day', '10000000-0000-0000-0000-000000000001', null, null),
  ('f1000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'revoked-cleanup-a@example.test', 'vendedor', 'pgtap-cleanup-revoked-a', now() + interval '1 day', '10000000-0000-0000-0000-000000000001', null, now()),
  ('f1000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'accepted-cleanup-a@example.test', 'vendedor', 'pgtap-cleanup-accepted-a', now() - interval '1 day', '10000000-0000-0000-0000-000000000001', now(), null),
  ('f1000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'pending-cleanup-a@example.test', 'vendedor', 'pgtap-cleanup-pending-a', now() + interval '1 day', '10000000-0000-0000-0000-000000000001', null, null),
  ('f2000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'expired-cleanup-b@example.test', 'vendedor', 'pgtap-cleanup-expired-b', now() - interval '1 day', '20000000-0000-0000-0000-000000000001', null, null),
  ('f2000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222', 'revoked-cleanup-b@example.test', 'vendedor', 'pgtap-cleanup-revoked-b', now() + interval '1 day', '20000000-0000-0000-0000-000000000001', null, now());
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  cardinality(public.cleanup_historical_organization_invitations()),
  3,
  'manager cleanup removes expired, revoked, and newly revoked invitations from current organization'
);
reset role;
select is((select count(*) from public.organization_invitations where id in ('f1000000-0000-0000-0000-000000000011', 'f1000000-0000-0000-0000-000000000012')), 0::bigint, 'expired and revoked invitations from current organization were deleted');
select is((select count(*) from public.organization_invitations where id = 'f1000000-0000-0000-0000-000000000013' and accepted_at is not null), 1::bigint, 'accepted invitation is excluded from bulk cleanup');
select is((select count(*) from public.organization_invitations where id = 'f1000000-0000-0000-0000-000000000014' and accepted_at is null and revoked_at is null and expires_at > now()), 1::bigint, 'pending invitation is excluded from bulk cleanup');
select is((select count(*) from public.organization_invitations where id in ('f2000000-0000-0000-0000-000000000011', 'f2000000-0000-0000-0000-000000000012')), 2::bigint, 'cleanup leaves another organization invitations untouched');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select public.cleanup_historical_organization_invitations()$$, 'P0001', 'only managers can clean invitations', 'non-manager cannot use bulk invitation cleanup');
reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*) from public.organization_invitations where id = 'f2000000-0000-0000-0000-000000000001'), 1::bigint, 'another organization keeps its invitation');
select is((select count(*) from public.organization_invitations where id in ('f2000000-0000-0000-0000-000000000011', 'f2000000-0000-0000-0000-000000000012')), 2::bigint, 'another organization manager sees its untouched invitations');
reset role;

-- Exercise organization history RPCs and appointment deletion against data
-- owned by both organizations. Disable triggers only while creating fixtures
-- so the boundary timestamps are deterministic; the tested deletes run with
-- the real attendance guard enabled.
set local session_replication_role = replica;
insert into public.appointments (
  id, date, time, client, professional_id, service, status,
  attendance_recorded_at, organization_id, created_at
) values
  (
    'cleanup-eligible-a', '2099-01-01', '09:00', 'Atendimento futuro elegível',
    'professional-a-operator', 'Corte', 'pending', null,
    '11111111-1111-1111-1111-111111111111', now()
  ),
  (
    'cleanup-recent-attendance-a', '2026-10-20', '09:00', 'Atendimento recente',
    'professional-a-operator', 'Corte', 'completed', now() - interval '23 hours',
    '11111111-1111-1111-1111-111111111111', now() - interval '23 hours'
  ),
  (
    'cleanup-expired-attendance-a', '2026-10-19', '09:00', 'Atendimento protegido',
    'professional-a-operator', 'Corte', 'completed', now() - interval '25 hours',
    '11111111-1111-1111-1111-111111111111', now() - interval '25 hours'
  ),
  (
    'cleanup-boundary-attendance-a', '2026-10-20', '09:00', 'Atendimento no limite',
    'professional-a-operator', 'Corte', 'completed', clock_timestamp() - interval '24 hours',
    '11111111-1111-1111-1111-111111111111', now() - interval '24 hours'
  ),
  (
    'cleanup-past-confirmed-a', '2000-01-01', '09:00', 'Atendimento confirmado passado',
    'professional-a-operator', 'Corte', 'confirmed', null,
    '11111111-1111-1111-1111-111111111111', now() - interval '30 hours'
  ),
  (
    'cleanup-dev-admin-expired-a', '2026-10-19', '08:00', 'Atendimento antigo para DEV/ADMIN',
    'professional-a-operator', 'Corte', 'completed', now() - interval '27 hours',
    '11111111-1111-1111-1111-111111111111', now() - interval '27 hours'
  ),
  (
    'cleanup-foreign-b', '2026-10-19', '09:00', 'Atendimento de outra empresa',
    'professional-b-seller', 'Corte', 'completed', now() - interval '30 hours',
    '22222222-2222-2222-2222-222222222222', now() - interval '30 hours'
  );

insert into public.communication_sends (
  id, organization_id, channel, kind, recipient_name, recipient_address,
  message, status, sent_by
) values
  (
    'c0000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'email', 'campaign', 'Destinatário A', 'a@example.test',
    'Registro de teste A', 'initiated', '10000000-0000-0000-0000-000000000001'
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    '22222222-2222-2222-2222-222222222222',
    'email', 'campaign', 'Destinatário B', 'b@example.test',
    'Registro de teste B', 'initiated', '20000000-0000-0000-0000-000000000001'
  );
reset session_replication_role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.get_organization_history_counts()$$,
  '42501', 'manager_access_required',
  'non-manager cannot read organization history counts'
);
select throws_ok(
  $$select public.clear_organization_history('finance')$$,
  '42501', 'manager_access_required',
  'non-manager cannot clear organization history'
);
select throws_ok(
  $$select public.delete_organization_history_item('communication_send', 'c0000000-0000-0000-0000-000000000001')$$,
  '42501', 'manager_access_required',
  'non-manager cannot delete an organization history item'
);

reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (public.get_organization_history_counts() ->> 'appointments')::bigint,
  (select count(*) from public.appointments),
  'history counts include only appointments from the active organization'
);
select is(
  (public.get_organization_history_counts() ->> 'appointments_locked')::bigint,
  4::bigint,
  'history counts mark attendance at or beyond 24 hours and past confirmed appointments as protected'
);
select is(
  (select count(*) from public.appointments where id = 'cleanup-foreign-b'),
  0::bigint,
  'manager cannot see another organization appointment through row access'
);
select is(
  (public.clear_organization_history('finance') ->> 'deleted_count')::bigint,
  4::bigint,
  'manager bulk cleanup removes own organization finance records'
);
reset role;
select is(
  (select count(*) from public.expenses where organization_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.incomes where organization_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'finance cleanup removes organization A records'
);
select is(
  (select count(*) from public.finance_entry_changes where organization_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'finance cleanup also removes organization A financial change history'
);
select is(
  (select count(*) from public.expenses where organization_id = '22222222-2222-2222-2222-222222222222')
  + (select count(*) from public.incomes where organization_id = '22222222-2222-2222-2222-222222222222'),
  2::bigint,
  'finance cleanup leaves organization B records untouched'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  public.delete_organization_history_item('communication_send', 'c0000000-0000-0000-0000-000000000001'),
  true,
  'manager can delete a history item from the active organization'
);
select is(
  (select count(*) from public.communication_sends where id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'active organization history item was deleted'
);
select is(
  public.delete_organization_history_item('communication_send', 'c0000000-0000-0000-0000-000000000002'),
  false,
  'manager cannot delete a history item from another organization'
);
select is(
  (select count(*) from public.communication_sends where id = 'c0000000-0000-0000-0000-000000000002'),
  0::bigint,
  'history item from another organization remains invisible'
);
reset role;
select is(
  (select count(*) from public.communication_sends where id = 'c0000000-0000-0000-0000-000000000002'),
  1::bigint,
  'deleting an active organization history item leaves another organization record untouched'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
set local role authenticated;
select throws_ok(
  $$delete from public.appointments where id = 'cleanup-expired-attendance-a'$$,
  'P0001', 'attendance_delete_window_expired',
  'reception cannot delete an attendance older than 24 hours'
);
select is(
  (select count(*) from public.appointments where id = 'cleanup-expired-attendance-a'),
  1::bigint,
  'expired attendance remains after reception deletion is denied'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-eligible-a'$$,
  'future appointment can be removed'
);
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-recent-attendance-a'$$,
  'attendance recorded less than 24 hours ago can be removed'
);
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-expired-attendance-a'$$,
  'manager can delete an attendance recorded more than 24 hours ago'
);
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-boundary-attendance-a'$$,
  'manager can delete an attendance at the 24-hour cutoff'
);
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-past-confirmed-a'$$,
  'manager can delete a past confirmed appointment without an attendance timestamp'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is(public.current_user_role(), 'dev-admin', 'DEV/ADMIN role is loaded for deletion checks');
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-dev-admin-expired-a'$$,
  'DEV/ADMIN can delete an attendance recorded more than 24 hours ago'
);
select lives_ok(
  $$delete from public.appointments where id = 'cleanup-foreign-b'$$,
  'manager delete scoped to its organization does not error on another organization appointment'
);
reset role;
select is(
  (select count(*) from public.appointments where id = 'cleanup-foreign-b'),
  1::bigint,
  'attempted appointment cleanup leaves another organization appointment untouched'
);

reset role;
insert into public.organization_members (organization_id, user_id, role)
values ('22222222-2222-2222-2222-222222222222', '10000000-0000-0000-0000-000000000001', 'gestor');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  public.current_organization_id(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'account defaults to its selected salon'
);
select is(
  (select count(*) from public.list_my_organizations()),
  2::bigint,
  'account can list only its two active salon memberships'
);
select lives_ok(
  $$select public.switch_current_organization('22222222-2222-2222-2222-222222222222')$$,
  'account can switch to another active salon'
);
select is(
  public.current_organization_id(),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'switch changes the active tenant context'
);
select is(
  (select count(*) from public.appointments where id = 'cleanup-foreign-b'),
  1::bigint,
  'after switching, the member can read data from the selected salon'
);
select throws_ok(
  $$select public.switch_current_organization('33333333-3333-3333-3333-333333333333')$$,
  'P0001',
  'active organization membership required',
  'account cannot switch to a salon without membership'
);
select lives_ok(
  $$select public.switch_current_organization('11111111-1111-1111-1111-111111111111')$$,
  'account can switch back to its original salon'
);
select is(
  public.current_organization_id(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'switching back restores the original tenant context'
);
select lives_ok(
  $$update public.appointments set status = 'cancelled' where id = 'cleanup-foreign-b'$$,
  'update against an unselected salon is safely scoped to zero rows'
);
select is(
  (select count(*) from public.appointments where id = 'cleanup-foreign-b'),
  0::bigint,
  'unselected salon records are hidden after switching back'
);
reset role;
select is(
  (select status from public.appointments where id = 'cleanup-foreign-b'),
  'completed',
  'a cross-salon update attempt does not change the other salon record'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.bootstrap_organization('Terceiro salão do gestor', '', '')$$,
  'an existing salon manager can create another salon'
);
select is(
  (select count(*) from public.list_my_organizations()),
  3::bigint,
  'the same account now has three isolated salon memberships'
);
select is(
  public.current_organization_id(),
  (select default_organization_id from public.profiles where id = auth.uid()),
  'the newly created salon becomes the active context'
);
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select lives_ok(
  $$select public.bootstrap_organization('Primeiro salão do usuário', '', '')$$,
  'an unlinked account can create its first salon'
);
select is(
  public.current_user_role(),
  'gestor',
  'the creator receives manager access to the first salon'
);
reset role;

select * from finish();
rollback;
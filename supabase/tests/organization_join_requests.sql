-- Regression suite for public requests without accounts and manager-issued invites.
-- Run with `supabase test db` against a disposable Supabase database.

begin;

create extension if not exists pgtap;
select plan(87);
create temporary table join_request_invitation_test_token (token text not null);
grant select, insert on join_request_invitation_test_token to authenticated;

select is(
  to_regclass('public.organization_join_requests'),
  'public.organization_join_requests'::regclass,
  'organization join request table exists'
);
select is(
  to_regclass('public.organization_join_request_events'),
  'public.organization_join_request_events'::regclass,
  'organization join request history table exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.organization_join_request_events'::regclass),
  'request history has row-level security enabled'
);
select ok(
  not has_table_privilege('anon', 'public.organization_join_request_events', 'SELECT'),
  'anonymous visitors cannot read request history'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_invitations'
       and column_name = 'join_request_id'
  ),
  'invitations can be linked to their access request'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_invitations'
       and column_name = 'revoked_by'
  ),
  'invitation history stores the revoking manager id'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_invitations'
       and column_name = 'revoked_by_name'
  ),
  'invitation history stores the revoking manager name'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_invitations'
       and column_name = 'invited_by_name'
  ),
  'invitation history stores the creating manager name'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.organization_join_requests'::regclass),
  'organization join requests have row-level security enabled'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_join_requests'
       and column_name = 'hidden_at'
  ),
  'rejected requests support persistent archiving without deletion'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'organization_join_requests'
       and column_name = 'restored_at'
  ),
  'restored requests retain the time of the manager decision'
);
select ok(
  has_function_privilege('authenticated', 'public.restore_rejected_organization_join_request(uuid)', 'EXECUTE'),
  'authenticated managers can call the guarded request restoration function'
);
select ok(
  has_function_privilege('anon', 'public.request_organization_join(uuid,text,text,text)', 'EXECUTE'),
  'anonymous visitors can submit a request without an account'
);
select ok(
  not has_table_privilege('anon', 'public.organization_join_requests', 'SELECT'),
  'anonymous visitors cannot list request records'
);
select ok(
  not has_table_privilege('anon', 'public.organization_join_request_rate_limits', 'SELECT'),
  'anonymous visitors cannot read hashed rate-limit keys'
);
select ok(
  not has_table_privilege('authenticated', 'public.deployment_settings', 'UPDATE'),
  'client accounts cannot enable organization creation'
);

set local session_replication_role = replica;
insert into public.organizations (id, name)
values ('31111111-1111-1111-1111-111111111111', 'Empresa de teste');
insert into auth.users (
  id, email, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('30000000-0000-0000-0000-000000000001', 'gestor-join@example.test', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{"full_name":"Gestor de teste"}'::jsonb, now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'profissional-join@example.test', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{"full_name":"Profissional de teste"}'::jsonb, now(), now());
insert into public.profiles (id, email, full_name, default_organization_id)
values
  ('30000000-0000-0000-0000-000000000001', 'gestor-join@example.test', 'Gestor de teste', '31111111-1111-1111-1111-111111111111'),
  ('30000000-0000-0000-0000-000000000002', 'profissional-join@example.test', 'Profissional de teste', null);
insert into public.professionals (id, name, role, organization_id)
values ('professional-join-available', 'Profissional cadastrado', 'barbeiro', '31111111-1111-1111-1111-111111111111');
insert into public.organization_members (organization_id, user_id, role)
values ('31111111-1111-1111-1111-111111111111', '30000000-0000-0000-0000-000000000001', 'gestor');
update public.deployment_settings
   set enabled = false
 where setting_key = 'organization_creation_enabled';
set local session_replication_role = origin;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  public.get_onboarding_options() ->> 'can_create_organization',
  'false',
  'closed mode does not offer company creation'
);
select is(
  public.get_onboarding_options() ->> 'can_request_access',
  'false',
  'a request must use the salon-specific link, not infer a single company'
);
select is(
  (select count(*) from public.organization_join_requests),
  0::bigint,
  'an unlinked account cannot read an anonymous request'
);
select throws_ok(
  $$select public.bootstrap_organization('Empresa avulsa', '', '')$$,
  'P0001',
  'organization creation is disabled for this deployment',
  'a direct bootstrap RPC is blocked while the deployment is closed'
);
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select lives_ok(
  $$select public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional de teste', 'profissional-join@example.test', null)$$,
  'an unauthenticated visitor can submit a request with one contact'
);
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.21"}', true);
select throws_ok(
  $$select public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional telefone', null, '+5511999990000')$$,
  'P0001',
  'phone access requests are disabled',
  'an unauthenticated visitor cannot submit a phone request'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_phone = '+5511999990000' and status = 'pending'),
  0::bigint,
  'disabled phone requests are not recorded'
);
set local role anon;
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.22"}', true);
select lives_ok(
  $do$do $spam$
    declare request_number integer;
    begin
      for request_number in 1..10 loop
        perform public.request_organization_join(
          '31111111-1111-1111-1111-111111111111',
          'Profissional em teste',
          format('spam-%s@example.test', request_number),
          null
        );
      end loop;
    end;
  $spam$$do$,
  'ten distinct contact requests are accepted within the hourly network limit'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email like 'spam-%@example.test' and status = 'pending'),
  10::bigint,
  'changing email addresses does not avoid accounting against the same network limit'
);
set local role anon;
select is(
  (public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional em teste', 'spam-11@example.test', null) ->> 'rate_limited'),
  'true',
  'the next distinct request is rate-limited even with a new contact'
);
-- A phone address cannot bypass a network limit already reached by email.
select is(
  (public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional por telefone', null, '+5511999990001') ->> 'rate_limited'),
  'true',
  'switching from email to phone does not bypass the network limit'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email = 'spam-11@example.test'
       or applicant_phone = '+5511999990001'),
  0::bigint,
  'rate-limited submissions are not added to the manager queue'
);
set local role anon;
select set_config('request.headers', '{}', true);
select lives_ok(
  $do$do $fallback$
    declare request_number integer;
    begin
      for request_number in 1..3 loop
        perform public.request_organization_join(
          '31111111-1111-1111-1111-111111111111',
          'Visitante sem endereço de rede',
          format('fallback-%s@example.test', request_number),
          null
        );
      end loop;
    end;
  $fallback$$do$,
  'the fallback limit permits three requests when the network address is unavailable'
);
select is(
  (public.request_organization_join(
    '31111111-1111-1111-1111-111111111111',
    'Visitante sem endereço de rede', 'fallback-4@example.test', null
  ) ->> 'rate_limited'),
  'true',
  'changing contact details cannot bypass the fallback request limit'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email like 'fallback-%@example.test'),
  3::bigint,
  'fallback-limited requests are not inserted'
);
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$insert into public.organization_join_requests (organization_id, applicant_name, applicant_email) values ('31111111-1111-1111-1111-111111111111', 'Falsificado', 'fake@example.test')$$,
  '42501',
  'permission denied for table organization_join_requests',
  'visitors cannot insert or forge request rows directly'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where user_id is null
      and applicant_name = 'Profissional de teste'
      and applicant_email = 'profissional-join@example.test'
      and status = 'pending'),
  1::bigint,
  'the public request is recorded without an account'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.organization_join_requests
    where status = 'pending'
      and applicant_email = 'profissional-join@example.test'),
  1::bigint,
  'the manager can see the pending request in their organization'
);
select is(
  (select count(*) from public.list_organization_join_request_candidates()),
  1::bigint,
  'the manager can see the unlinked professional profile available for approval'
);
select lives_ok(
  $$select public.approve_organization_join_request((select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'), 'professional-join-available')$$,
  'the manager can approve an existing professional profile'
);
select throws_ok(
  $$select public.archive_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'))$$,
  'P0001',
  'rejected access request not found',
  'an approved access request cannot be archived as a rejected request'
);
select is(
  (select hidden_at from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
  null::timestamptz,
  'an approved access request remains unarchived'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')
      and event_type = 'request_approved'),
  1::bigint,
  'approval is recorded as a request history event'
);
select lives_ok(
  $$select public.reject_organization_join_request(
    (select id from public.organization_join_requests where applicant_email = 'spam-1@example.test')
  )$$,
  'the manager can reject a separate pending access request'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'spam-1@example.test')
      and event_type = 'request_rejected'),
  1::bigint,
  'rejection is recorded as a request history event'
);
reset role;

select is(
  (select count(*) from public.organization_members where professional_id = 'professional-join-available' and is_active),
  0::bigint,
  'approval alone does not create a user membership'
);
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email = 'profissional-join@example.test'
      and user_id is null
      and status = 'approved'
      and professional_id = 'professional-join-available'
      and reviewed_by = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the approval reserves the selected profile and records the manager'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.list_organization_join_request_candidates()),
  0::bigint,
  'an approved request reserves its professional profile'
);
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional de teste', 'profissional-join@example.test', null)$$,
  'P0001',
  'this contact already has an approved access request',
  'a second public request cannot duplicate an approved contact'
);
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  public.get_public_organization_invitation_info(
    public.create_organization_invitation(
      'professional-join-available',
      'profissional-join@example.test'
    ) ->> 'token'
  ) ->> 'valid',
  'true',
  'the manager can generate a valid invitation after approval'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')
      and event_type = 'invitation_created'),
  1::bigint,
  'the generated invitation is linked to the access request history'
);
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.revoke_approved_join_request_invitation(
    (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
    (select id from public.organization_invitations
      where email = 'profissional-join@example.test'
        and accepted_at is not null)
  )$$,
  'P0001',
  'only managers can revoke approved-request invitations',
  'a professional cannot revoke an invitation or release its profile'
);
reset role;
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'
      and professional_id = 'professional-join-available'
      and accepted_at is null
      and revoked_at is null),
  1::bigint,
  'the invitation is tied to the selected profile and applicant contact'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.revoke_approved_join_request_invitation(
    (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
    (select id from public.organization_invitations
      where email = 'profissional-join@example.test'
        and professional_id = 'professional-join-available'
        and accepted_at is null
        and revoked_at is null)
  )$$,
  'the manager can revoke a pending invitation and return its approved request to review'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')
      and event_type = 'invitation_revoked'),
  1::bigint,
  'revoking an invitation is recorded in the request history'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')
      and event_type = 'request_reopened'),
  1::bigint,
  'returning a request to pending preserves its previous review in history'
);
reset role;
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'
      and professional_id = 'professional-join-available'
      and accepted_at is null
      and revoked_at is not null),
  1::bigint,
  'the revoked invitation remains in history'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select revoked_by::text from public.organization_invitations
    where email = 'profissional-join@example.test'
      and revoked_at is not null),
  '30000000-0000-0000-0000-000000000001',
  'the manager who revoked the invitation is recorded'
);
select is(
  (select revoked_by_name from public.organization_invitations
    where email = 'profissional-join@example.test'
      and revoked_at is not null),
  'Gestor de teste',
  'the manager name is available in the company invitation history'
);
select is(
  (select invited_by_name from public.organization_invitations
    where email = 'profissional-join@example.test'
      and revoked_at is not null),
  'Gestor de teste',
  'the invitation creator name is saved in the company history'
);
select ok(
  (select created_at is not null from public.organization_invitations
    where email = 'profissional-join@example.test'
      and revoked_at is not null),
  'the invitation creation timestamp is available to its manager'
);
reset role;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'),
  0::bigint,
  'a non-manager cannot read any invitation history or creator details'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')),
  0::bigint,
  'a non-manager cannot read request history'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email = 'profissional-join@example.test'
      and status = 'pending'
      and professional_id is null
      and reviewed_at is null
      and reviewed_by is null),
  1::bigint,
  'the request is returned to pending without retaining the reserved profile'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.archive_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'))$$,
  'P0001',
  'rejected access request not found',
  'a request reopened after invitation revocation cannot be archived'
);
select is(
  (select hidden_at from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
  null::timestamptz,
  'a request reopened after invitation revocation remains unarchived'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*) from public.list_organization_join_request_candidates()),
  1::bigint,
  'the released profile is available for a new approval decision'
);
reset role;
select is(
  (select count(*) from public.organization_members
    where professional_id = 'professional-join-available' and is_active),
  0::bigint,
  'revoking the invite does not create a company membership'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.approve_organization_join_request(
    (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
    'professional-join-available'
  )$$,
  'the manager can approve the reopened request again'
);
insert into join_request_invitation_test_token (token)
select public.create_organization_invitation(
  'professional-join-available',
  'profissional-join@example.test'
) ->> 'token';
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$select public.accept_organization_invitation((select token from join_request_invitation_test_token))$$,
  'the invitee can accept a newly issued invitation'
);
reset role;
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'
      and professional_id = 'professional-join-available'
      and accepted_at is not null
      and revoked_at is null),
  1::bigint,
  'acceptance is recorded without revoking the accepted invitation'
);
select is(
  (select count(*) from public.organization_members
    where professional_id = 'professional-join-available'
      and user_id = '30000000-0000-0000-0000-000000000002'
      and is_active),
  1::bigint,
  'membership is created only when the invitee accepts'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test')
      and event_type in (
        'request_submitted',
        'request_approved',
        'invitation_created',
        'invitation_revoked',
        'request_reopened',
        'invitation_accepted'
      )),
  8::bigint,
  'the complete request, approval, revoke, reapproval, and acceptance timeline is preserved'
);
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.revoke_approved_join_request_invitation(
    (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
    (select id from public.organization_invitations
      where email = 'profissional-join@example.test'
        and accepted_at is not null)
  )$$,
  'P0001',
  'pending approved-request invitation not found',
  'an accepted invitation cannot be revoked through the release flow'
);
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'
      and accepted_at is not null
      and revoked_at is null),
  1::bigint,
  'attempting to revoke an accepted invitation leaves it unchanged'
);
select is(
  (select count(*) from public.list_organization_join_request_candidates()),
  0::bigint,
  'the accepted professional profile remains unavailable'
);
reset role;

set local session_replication_role = replica;
insert into auth.users (
  id, email, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '30000000-0000-0000-0000-000000000003',
  'arquivar-request@example.test',
  now(),
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{"full_name":"Profissional para arquivar"}'::jsonb,
  now(),
  now()
);
insert into public.profiles (id, email, full_name, default_organization_id)
values ('30000000-0000-0000-0000-000000000003', 'arquivar-request@example.test', 'Profissional para arquivar', null);
set local session_replication_role = origin;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select lives_ok(
  $$select public.request_organization_join('31111111-1111-1111-1111-111111111111', 'Profissional para arquivar', 'arquivar-request@example.test', null)$$,
  'a new professional can submit a request that can later be archived'
);
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.reject_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'the manager can reject the archiving test request'
);
select lives_ok(
  $$select public.archive_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'the manager can manually archive a rejected request'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email = 'arquivar-request@example.test'
      and status = 'rejected'
      and hidden_at is not null),
  1::bigint,
  'manual archiving retains the rejected request instead of deleting it'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test')
      and event_type = 'request_archived'
      and actor_id = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'manual archiving is added to the request timeline'
);

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.restore_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'the manager can restore a manually archived rejected request'
);
reset role;
select is(
  (select count(*) from public.organization_join_requests
    where applicant_email = 'arquivar-request@example.test'
      and status = 'rejected'
      and hidden_at is null
      and restored_at is not null),
  1::bigint,
  'restoration returns the rejected request to the main list without changing its state'
);
select is(
  (select count(*) from public.organization_join_request_events
    where request_id = (select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test')
      and event_type = 'request_restored'
      and actor_id = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'restoration is appended to the request timeline'
);
set local role authenticated;
select lives_ok(
  $$select public.archive_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'the manager can explicitly archive the restored request again'
);
reset role;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.archive_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'P0001',
  'only managers can archive rejected access requests',
  'a professional cannot archive an access request'
);
select throws_ok(
  $$select public.restore_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'P0001',
  'only managers can restore rejected access requests',
  'a professional cannot restore an access request'
);
reset role;

set local session_replication_role = replica;
insert into public.organizations (id, name)
values ('32222222-2222-2222-2222-222222222222', 'Outra empresa de teste');
insert into auth.users (
  id, email, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '40000000-0000-0000-0000-000000000001', 'outro-gestor@example.test', now(), 'authenticated', 'authenticated', '{}'::jsonb, '{"full_name":"Outro gestor"}'::jsonb, now(), now()
);
insert into public.profiles (id, email, full_name, default_organization_id)
values ('40000000-0000-0000-0000-000000000001', 'outro-gestor@example.test', 'Outro gestor', '32222222-2222-2222-2222-222222222222');
insert into public.organization_members (organization_id, user_id, role)
values ('32222222-2222-2222-2222-222222222222', '40000000-0000-0000-0000-000000000001', 'gestor');
set local session_replication_role = origin;
select set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.approve_organization_join_request((select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'), 'professional-join-available')$$,
  'P0001',
  'pending access request not found',
  'a manager from another organization cannot review the request'
);
select throws_ok(
  $$select public.restore_rejected_organization_join_request((select id from public.organization_join_requests where applicant_email = 'arquivar-request@example.test'))$$,
  'P0001',
  'manually archived rejected access request not found',
  'a manager from another organization cannot restore the request'
);
select throws_ok(
  $$select public.revoke_approved_join_request_invitation(
    (select id from public.organization_join_requests where applicant_email = 'profissional-join@example.test'),
    (select id from public.organization_invitations
      where email = 'profissional-join@example.test'
        and accepted_at is not null)
  )$$,
  'P0001',
  'pending approved-request invitation not found',
  'a manager from another organization cannot revoke the invite or free the profile'
);
select is(
  (select count(*) from public.organization_invitations
    where email = 'profissional-join@example.test'),
  0::bigint,
  'a manager from another organization cannot read invitation creator details'
);
reset role;

select * from finish();
rollback;

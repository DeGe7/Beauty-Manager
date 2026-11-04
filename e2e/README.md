# Beauty Manager E2E

The suite uses Playwright against the real Supabase-backed Beauty Manager app.
It never contains a password, anon key, service-role key, or fixed test user.

## Run

Against an already running artifact workflow:

```bash
E2E_BASE_URL=https://your-development-domain.example pnpm e2e
```

To let Playwright start a local Vite server instead:

```bash
E2E_START_SERVER=true pnpm e2e
```

With the dedicated Supabase test project configured in Replit Secrets, run the
fully provisioned isolated suite with:

```bash
pnpm e2e:isolated
```

### Professional deletion regression

Apply `supabase/migrations/2026-10-13-delete-professionals-preserve-history.sql`
to the **dedicated test project only** before running:

```bash
CI=true E2E_PROVISION=true E2E_START_SERVER=true pnpm exec playwright test --config=e2e/playwright.config.ts e2e/tests/professional-deletion.spec.ts
```

These scenarios require the provisioned local test server and refuse to run
against a pre-running app. They seed disposable attendance, blocking, prosthesis,
mentoring, subscription and payment history; verify cancellation, confirmation,
and a simulated missing RPC; compare stored business data and displayed financial
totals after reload. The missing RPC is intercepted in the browser, not dropped
from Supabase. Existing scenario/global teardown cleans the fixtures even on failure.

## Automatic disposable environment

For a complete matrix without manually prepared accounts, point the suite at a
dedicated Supabase test project and enable provisioning:

```text
E2E_PROVISION=true
E2E_SUPABASE_TEST_URL=https://your-test-project.supabase.co
E2E_SUPABASE_TEST_ANON_KEY=<test-project-anon-key>
E2E_SUPABASE_TEST_SERVICE_ROLE_KEY=<test-project-service-role-key>
```

`E2E_SUPABASE_TEST_SERVICE_ROLE_KEY` is used only by the Playwright setup and is
never sent to the browser. The setup creates a disposable organization, all
accounts (including dedicated expired/revoked invitation accounts), the custom role,
and pending/expired/revoked/used/email-mismatch
invitations. The global teardown deletes the organization, users, and the
temporary fixture file, including after a failed test run.

Provisioning refuses to run when the test URL matches `E2E_SUPABASE_PRODUCTION_URL`,
`VITE_SUPABASE_URL`, or `SUPABASE_URL`. Do not point a pre-running app at
production; when using `E2E_START_SERVER=true`, the test URL and anon key above
are injected automatically.

The CI workflow runs this complete authenticated matrix only when the three
`E2E_SUPABASE_TEST_*` secrets and `E2E_SUPABASE_PRODUCTION_URL` are configured. It enables both
`E2E_PROVISION=true` and `E2E_START_SERVER=true`, and passes only the dedicated
test-project URL and keys to the disposable environment. If the secrets are
missing, the authenticated E2E job is skipped.

Every CI run uploads the Playwright HTML report, traces, screenshots, videos,
and other files under `playwright-report/` or `test-results/` as the
`e2e-failure-artifacts` artifact. The artifact is retained for 14 days,
including when the matrix fails.

## Accounts

Set these variables in the Replit environment or CI secret store:

```text
E2E_MANAGER_EMAIL / E2E_MANAGER_PASSWORD
E2E_OPERATIONAL_EMAIL / E2E_OPERATIONAL_PASSWORD
E2E_CUSTOM_ROLE_EMAIL / E2E_CUSTOM_ROLE_PASSWORD
E2E_INVITED_EMAIL / E2E_INVITED_PASSWORD
E2E_ONBOARDING_EMAIL / E2E_ONBOARDING_PASSWORD
E2E_EXPIRED_EMAIL / E2E_EXPIRED_PASSWORD
E2E_REVOKED_EMAIL / E2E_REVOKED_PASSWORD
```

The manager account must already belong to an organization. The operational and
custom-role accounts must be members of the same test organization. The
onboarding account must not belong to an organization.

Invitation outcome tests are enabled by providing the token for the matching
fixture:

```text
E2E_INVITATION_TOKEN
E2E_EXPIRED_INVITATION_TOKEN
E2E_REVOKED_INVITATION_TOKEN
E2E_USED_INVITATION_TOKEN
E2E_EMAIL_CHECK_INVITATION_TOKEN
```

The optional custom-role route defaults to `/agenda` as allowed and
`/produtos` as denied. Override them with
`E2E_CUSTOM_ALLOWED_PATH`, `E2E_CUSTOM_ALLOWED_HEADING`, and
`E2E_CUSTOM_DENIED_PATH` when the test role has a different permission set.

When automatic provisioning is disabled, fixtures that need a dedicated account
or invitation token are reported as skipped when their environment variables are
absent; public auth and route guards still run without an account.

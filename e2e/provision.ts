import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Credentials {
  email: string;
  password: string;
}

export interface E2EFixtureManifest {
  organizationId: string;
  onboardingUserId: string;
  accounts: {
    manager: Credentials;
    operational: Credentials;
    reception: Credentials;
    customRole: Credentials;
    invited: Credentials;
    onboarding: Credentials;
    expired: Credentials;
    revoked: Credentials;
  };
  invitationTokens: {
    pending: string;
    expired: string;
    revoked: string;
    used: string;
    emailCheck: string;
  };
  receptionAttendance: {
    clientId: string;
    productId: string;
    professionalId: string;
  };
  userIds: string[];
}

export interface E2EFixtureCleanupState {
  organizationId?: string;
  userIds: string[];
}

export interface E2EScenarioSnapshot {
  organizationId: string;
  onboardingUserId: string;
  startedAt: string;
}

interface ProvisionConfig {
  url: string;
  serviceRoleKey: string;
  fixtureFile: string;
}

interface AuthUser {
  id: string;
  user_metadata?: Record<string, unknown> | null;
}

const currentSchemaVersion = '2026-10-30.3';
const requiredSchemaTables = [
  ['organizations', 'id'],
  ['deployment_settings', 'setting_key,enabled'],
  ['profiles', 'id'],
  ['professionals', 'id'],
  ['organization_members', 'organization_id,granted_by,granted_by_name,granted_at'],
  ['organization_join_requests', 'id,user_id,applicant_email,applicant_phone,status,professional_id'],
  ['organization_invitations', 'id,phone,join_request_id,revoked_by,revoked_by_name,invited_by,invited_by_name,resend_email_id,email_delivery_status,email_delivery_updated_at'],
  ['organization_join_request_events', 'id,request_id,event_type,actor_name,metadata,created_at'],
  ['communication_sends', 'id'],
  ['schema_metadata', 'key'],
  ['organization_settings', 'organization_id'],
  [
    'appointments',
    'id,attendance_recorded_at,seller_professional_id,seller_is_company,service_id,service_description,plan_subscriber_id,plan_usage_value,professional_commissions',
  ],
  ['blocks', 'id'],
  ['clients', 'id,name,visits,organization_id'],
  ['products', 'id,name,price,cost,stock,min_stock,is_prosthesis_capillary,organization_id'],
  ['product_sales', 'id,date,client_id,appointment_id,payment_method,items,total,organization_id,created_at'],
  ['expenses', 'id'],
  ['incomes', 'id,payment_method'],
  ['finance_entry_changes', 'id'],
  ['prothesis_sales', 'id'],
  ['mentoria_sessions', 'id'],
  ['subscription_plans', 'id'],
  ['subscribers', 'id,usage_started_at'],
  [
    'subscription_payments',
    'id,subscriber_id,due_date,paid_at,amount,payment_method,status,note,organization_id,created_at,updated_at',
  ],
] as const;

const fixtureFile = resolve(
  process.env.E2E_FIXTURE_FILE || 'test-results/e2e-fixtures.json',
);
const cleanupStateFile = resolve(
  process.env.E2E_FIXTURE_STATE_FILE || `${fixtureFile}.pending`,
);

export function isProvisioningEnabled() {
  return process.env.E2E_PROVISION === 'true';
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when E2E_PROVISION=true.`);
  return value;
}

function getConfig(): ProvisionConfig {
  const url = requiredEnv('E2E_SUPABASE_TEST_URL').replace(/\/+$/, '');
  const serviceRoleKey = requiredEnv('E2E_SUPABASE_TEST_SERVICE_ROLE_KEY');

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error(
      'E2E_SUPABASE_TEST_URL must be the HTTPS URL of a Supabase test project.',
    );
  }

  const configuredProductionUrls = [
    process.env.E2E_SUPABASE_PRODUCTION_URL,
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
  ]
    .map(value => value?.trim().replace(/\/+$/, ''))
    .filter((value): value is string => Boolean(value));

  if (configuredProductionUrls.includes(url)) {
    throw new Error(
      'E2E_SUPABASE_TEST_URL matches a configured production Supabase URL; refusing to provision.',
    );
  }

  return { url, serviceRoleKey, fixtureFile };
}

function headers(
  config: ProvisionConfig,
  extra: Record<string, string> = {},
  authorizationToken = config.serviceRoleKey,
) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${authorizationToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    return String(record.message || record.error_description || record.error || JSON.stringify(body));
  }
  return 'request failed without a response body';
}

async function request(
  config: ProvisionConfig,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    authorizationToken?: string;
  } = {},
): Promise<unknown> {
  const response = await fetch(`${config.url}${path}`, {
    method: init.method || 'GET',
    headers: headers(config, init.headers, init.authorizationToken),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    throw new Error(`Supabase ${init.method || 'GET'} ${path} failed (${response.status}): ${responseMessage(body)}`);
  }
  return body;
}

async function postgrest(
  config: ProvisionConfig,
  table: string,
  body: unknown = undefined,
  options: {
    method?: string;
    query?: string;
    prefer?: string;
    authorizationToken?: string;
  } = {},
): Promise<Record<string, unknown>[]> {
  const response = await request(
    config,
    `/rest/v1/${table}${options.query || ''}`,
    {
      method: options.method || 'POST',
      body,
      headers: {
        Prefer: options.prefer || 'return=representation',
      },
      authorizationToken: options.authorizationToken,
    },
  );
  return Array.isArray(response) ? response as Record<string, unknown>[] : [];
}

async function assertCurrentSchema(config: ProvisionConfig): Promise<void> {
  try {
    const metadata = await postgrest(config, 'schema_metadata', undefined, {
      method: 'GET',
      query: `?key=eq.app_schema_version&value=eq.${encodeURIComponent(currentSchemaVersion)}&select=key&limit=1`,
    });
    if (metadata.length !== 1) {
      throw new Error(
        `the schema marker app_schema_version=${currentSchemaVersion} was not found`,
      );
    }

    for (const [table, columns] of requiredSchemaTables) {
      await postgrest(config, table, undefined, {
        method: 'GET',
        query: `?select=${encodeURIComponent(columns)}&limit=0`,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        'E2E Supabase schema check failed before fixture provisioning.',
        `Expected schema version ${currentSchemaVersion} and all current application table and column shapes.`,
        'Apply the latest Supabase schema updates to the dedicated E2E project, then run the suite again.',
        `Supabase reported: ${detail}`,
      ].join('\n'),
      { cause: error },
    );
  }
}

async function setOrganizationCreationEnabled(
  config: ProvisionConfig,
  enabled: boolean,
): Promise<void> {
  await request(config, '/rest/v1/deployment_settings?setting_key=eq.organization_creation_enabled', {
    method: 'PATCH',
    body: { enabled, updated_at: new Date().toISOString() },
    headers: { Prefer: 'return=minimal' },
  });
}

async function listAuthUsers(config: ProvisionConfig): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const response = await request(
      config,
      `/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
    );
    if (!response || typeof response !== 'object' || !Array.isArray((response as { users?: unknown }).users)) {
      throw new Error('Supabase returned an unexpected user list while reading E2E accounts.');
    }
    const pageUsers = (response as { users: unknown[] }).users;
    for (const user of pageUsers) {
      if (!user || typeof user !== 'object' || typeof (user as { id?: unknown }).id !== 'string') {
        continue;
      }
      users.push(user as AuthUser);
    }
    if (pageUsers.length < perPage) break;
  }
  return users;
}

async function getPreservedE2EOrganizations(config: ProvisionConfig): Promise<{
  preservedUserIds: Set<string>;
  organizationIds: Set<string>;
  memberships: Record<string, unknown>[];
}> {
  const users = await listAuthUsers(config);
  const preservedUserIds = new Set(
    users
      .filter(user => user.user_metadata?.e2e_preserve_account === true)
      .map(user => user.id),
  );
  const memberships = await postgrest(config, 'organization_members', undefined, {
    method: 'GET',
    query: '?select=organization_id,user_id,role,is_active',
  });
  const organizationIds = new Set(
    memberships
      .filter(membership => (
        typeof membership.user_id === 'string' &&
        preservedUserIds.has(membership.user_id) &&
        membership.is_active !== false
      ))
      .map(membership => membership.organization_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  return { preservedUserIds, organizationIds, memberships };
}

async function createIsolatedFixtureOrganization(
  config: ProvisionConfig,
  runId: string,
  manager: { credentials: Credentials; userId: string },
  userIds: string[],
  managerToken: string,
  organizationIds: Set<string>,
): Promise<string> {
  const existingOrganizations = await postgrest(config, 'organizations', undefined, {
    method: 'GET',
    query: '?select=id',
  });
  if (existingOrganizations.length === 0) {
    await setOrganizationCreationEnabled(config, true);
    let response: unknown;
    try {
      response = await request(config, '/rest/v1/rpc/bootstrap_organization', {
        method: 'POST',
        body: {
          p_name: `Organização E2E ${runId}`,
          p_cnpj: '',
          p_address: 'Ambiente descartável de testes',
        },
        authorizationToken: managerToken,
      });
    } finally {
      await setOrganizationCreationEnabled(config, false);
    }
    const organizationId = String(response || '');
    if (!organizationId) throw new Error('Supabase did not return the test organization id.');
    writeCleanupState({ userIds, organizationId });
    return organizationId;
  }

  const preserved = await getPreservedE2EOrganizations(config);
  const protectedAdminOrganizationIds = new Set(
    preserved.memberships
      .filter(membership => (
        typeof membership.user_id === 'string' &&
        preserved.preservedUserIds.has(membership.user_id) &&
        membership.is_active !== false &&
        membership.role === 'dev-admin'
      ))
      .map(membership => membership.organization_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  if (
    existingOrganizations.length !== 1 ||
    typeof existingOrganizations[0]?.id !== 'string' ||
    !protectedAdminOrganizationIds.has(existingOrganizations[0].id) ||
    !organizationIds.has(existingOrganizations[0].id)
  ) {
    throw new Error(
      'The E2E project already has an organization. Fixture provisioning can continue only beside the protected DEV/ADMIN test company.',
    );
  }

  const organizations = await postgrest(config, 'organizations', {
    name: `Organização E2E ${runId}`,
    cnpj: '',
    address: 'Ambiente descartável de testes',
  });
  const organizationId = organizations[0]?.id;
  if (typeof organizationId !== 'string' || !organizationId) {
    throw new Error('Supabase did not return the isolated E2E organization id.');
  }
  writeCleanupState({ userIds, organizationId });

  await postgrest(config, 'organization_settings', {
    organization_id: organizationId,
    payload: {},
  });
  const managerInvitationToken = token();
  await createInvitation(config, {
    organizationId,
    professionalId: null,
    email: manager.credentials.email,
    invitedBy: manager.userId,
    role: 'gestor',
    token: managerInvitationToken,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await request(config, '/rest/v1/rpc/accept_organization_invitation', {
    method: 'POST',
    body: { p_token: managerInvitationToken },
    authorizationToken: managerToken,
  });
  return organizationId;
}

export async function clearE2EProjectData(): Promise<{
  organizationsDeleted: number;
  authUsersDeleted: number;
}> {
  if (!isProvisioningEnabled()) {
    throw new Error('Set E2E_PROVISION=true before clearing the dedicated E2E project.');
  }
  if (process.env.E2E_CLEAR_TEST_PROJECT !== 'DELETE_ALL_TEST_DATA') {
    throw new Error('Set E2E_CLEAR_TEST_PROJECT=DELETE_ALL_TEST_DATA to confirm this destructive test-only reset.');
  }

  const config = getConfig();
  await assertCurrentSchema(config);
  await setOrganizationCreationEnabled(config, false);

  const preserved = await getPreservedE2EOrganizations(config);
  for (const membership of preserved.memberships) {
    if (
      typeof membership.organization_id === 'string' &&
      preserved.organizationIds.has(membership.organization_id) &&
      typeof membership.user_id === 'string'
    ) {
      preserved.preservedUserIds.add(membership.user_id);
    }
  }

  const organizations = await postgrest(config, 'organizations', undefined, {
    method: 'GET',
    query: '?select=id',
  });
  const organizationIds = organizations
    .map(row => row.id)
    .filter((id): id is string => (
      typeof id === 'string' && !preserved.organizationIds.has(id)
    ));
  for (const id of organizationIds) {
    await request(config, `/rest/v1/organizations?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }

  const userIds = (await listAuthUsers(config))
    .map(user => user.id)
    .filter(id => !preserved.preservedUserIds.has(id));
  for (const id of userIds) {
    await request(config, `/auth/v1/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  const remainingProfiles = await postgrest(config, 'profiles', undefined, {
    method: 'GET',
    query: '?select=id',
  });
  for (const profile of remainingProfiles) {
    if (typeof profile.id !== 'string') continue;
    if (preserved.preservedUserIds.has(profile.id)) continue;
    await request(config, `/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }

  const remainingOrganizations = await postgrest(config, 'organizations', undefined, {
    method: 'GET',
    query: '?select=id',
  });
  const unexpectedOrganizations = remainingOrganizations
    .map(row => row.id)
    .filter((id): id is string => (
      typeof id === 'string' && !preserved.organizationIds.has(id)
    ));
  if (unexpectedOrganizations.length) {
    throw new Error('The E2E test reset left an unprotected organization behind.');
  }
  await setOrganizationCreationEnabled(config, false);
  removeFixtureFiles();
  return {
    organizationsDeleted: organizationIds.length,
    authUsersDeleted: userIds.length,
  };
}

async function createUser(
  config: ProvisionConfig,
  email: string,
  fullName: string,
  password: string,
): Promise<AuthUser> {
  const body = await request(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    },
  });
  if (!body || typeof body !== 'object' || typeof (body as AuthUser).id !== 'string') {
    throw new Error('Supabase did not return an id for the provisioned user.');
  }
  return body as AuthUser;
}

async function signInUser(
  config: ProvisionConfig,
  credentials: Credentials,
): Promise<string> {
  const body = await request(config, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  if (!body || typeof body !== 'object' || typeof (body as { access_token?: unknown }).access_token !== 'string') {
    throw new Error('Supabase did not return an access token for the manager fixture.');
  }
  return String((body as { access_token: string }).access_token);
}

function password() {
  return `E2E-${randomBytes(24).toString('base64url')}`;
}

function token() {
  return randomBytes(32).toString('hex');
}

function tokenHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function runId() {
  return `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
}

function email(role: string, id: string) {
  const domain = process.env.E2E_TEST_EMAIL_DOMAIN?.trim() || 'example.com';
  return `e2e-${role}-${id}@${domain}`;
}

function dateKey(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function createInvitation(
  config: ProvisionConfig,
  input: {
    organizationId: string;
    professionalId: string | null;
    email: string;
    invitedBy: string;
    role?: string;
    token: string;
    expiresAt: string;
    acceptedAt?: string;
    acceptedBy?: string;
    revokedAt?: string;
  },
) {
  const rows = await postgrest(config, 'organization_invitations', {
    organization_id: input.organizationId,
    email: input.email,
    professional_id: input.professionalId,
    role: input.role ?? 'barbeiro',
    token_hash: tokenHash(input.token),
    expires_at: input.expiresAt,
    accepted_at: input.acceptedAt,
    accepted_by: input.acceptedBy,
    revoked_at: input.revokedAt,
    invited_by: input.invitedBy,
  });
  if (!rows[0]?.id) throw new Error('Supabase did not return the invitation id.');
}

function writeCleanupState(state: E2EFixtureCleanupState) {
  mkdirSync(dirname(cleanupStateFile), { recursive: true });
  writeFileSync(cleanupStateFile, `${JSON.stringify(state)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  chmodSync(cleanupStateFile, 0o600);
}

function removeFixtureFiles() {
  rmSync(fixtureFile, { force: true });
  rmSync(cleanupStateFile, { force: true });
}

async function pauseAfterCheckpoint(checkpoint: 'users' | 'organization') {
  if (process.env.E2E_PROVISION_PAUSE_AFTER !== checkpoint) return;
  await new Promise<void>(() => {
    setInterval(() => {}, 1_000);
  });
}

export function readFixtureCleanupState(): E2EFixtureCleanupState | undefined {
  try {
    const state = JSON.parse(readFileSync(cleanupStateFile, 'utf8')) as Partial<E2EFixtureCleanupState>;
    if (!Array.isArray(state.userIds)) return undefined;
    return {
      organizationId: typeof state.organizationId === 'string' ? state.organizationId : undefined,
      userIds: state.userIds.filter((value): value is string => typeof value === 'string'),
    };
  } catch {
    return undefined;
  }
}

export async function provisionFixtures(): Promise<void> {
  if (!isProvisioningEnabled()) return;
  const config = getConfig();
  await assertCurrentSchema(config);
  if (readFixtureManifest() || readFixtureCleanupState()) {
    await cleanupFixtures(config);
  }
  const id = runId();
  const userIds: string[] = [];
  let organizationId: string | undefined;

  try {
    await setOrganizationCreationEnabled(config, false);
    const accountSpecs = [
      ['manager', 'Gestor E2E'],
      ['operational', 'Profissional operacional E2E'],
      ['reception', 'Recepção E2E'],
      ['customRole', 'Profissional papel customizado E2E'],
      ['invited', 'Convidado E2E'],
      ['onboarding', 'Onboarding E2E'],
      ['expired', 'Conta convite expirado E2E'],
      ['revoked', 'Conta convite revogado E2E'],
    ] as const;
    const accountEntries: Array<
      readonly [
        (typeof accountSpecs)[number][0],
        { credentials: Credentials; userId: string },
      ]
    > = [];
    for (const [role, fullName] of accountSpecs) {
      const credentials = {
        email: email(role, id),
        password: password(),
      };
      const user = await createUser(config, credentials.email, fullName, credentials.password);
      userIds.push(user.id);
      writeCleanupState({ userIds, organizationId });
      accountEntries.push([role, { credentials, userId: user.id }]);
    }
    await pauseAfterCheckpoint('users');
    const createdAccounts = Object.fromEntries(accountEntries) as Record<
      (typeof accountSpecs)[number][0],
      { credentials: Credentials; userId: string }
    >;

    const managerToken = await signInUser(config, createdAccounts.manager.credentials);
    const preserved = await getPreservedE2EOrganizations(config);
    organizationId = await createIsolatedFixtureOrganization(
      config,
      id,
      createdAccounts.manager,
      userIds,
      managerToken,
      preserved.organizationIds,
    );
    writeCleanupState({ userIds, organizationId });
    await pauseAfterCheckpoint('organization');

    await postgrest(
      config,
      'profiles',
      accountSpecs.map(([role, fullName]) => ({
        id: createdAccounts[role].userId,
        email: createdAccounts[role].credentials.email,
        full_name: fullName,
        default_organization_id: role === 'manager' ? organizationId : null,
      })),
      { query: '?on_conflict=id', prefer: 'resolution=merge-duplicates,return=representation' },
    );

    const professionals = await postgrest(config, 'professionals', [
      {
        name: 'Profissional operacional E2E',
        role: 'barbeiro',
        initials: 'PO',
        color: '#3b82f6',
        organization_id: organizationId,
      },
      {
        name: 'Profissional customizado E2E',
        role: 'e2e-custom',
        initials: 'PC',
        color: '#8b5cf6',
        organization_id: organizationId,
      },
      {
        name: 'Profissional convidado E2E',
        role: 'barbeiro',
        initials: 'PE',
        color: '#10b981',
        organization_id: organizationId,
      },
      {
        name: 'Profissional convite pendente E2E',
        role: 'barbeiro',
        initials: 'PP',
        color: '#f59e0b',
        organization_id: organizationId,
      },
      {
        name: 'Profissional convite expirado E2E',
        role: 'barbeiro',
        initials: 'PX',
        color: '#ef4444',
        organization_id: organizationId,
      },
      {
        name: 'Profissional convite revogado E2E',
        role: 'barbeiro',
        initials: 'PR',
        color: '#64748b',
        organization_id: organizationId,
      },
      {
        name: 'Profissional convite e-mail E2E',
        role: 'vendedor',
        initials: 'PE',
        color: '#14b8a6',
        organization_id: organizationId,
      },
      {
        name: 'Profissional pedido de acesso E2E',
        role: 'barbeiro',
        initials: 'PA',
        color: '#f97316',
        organization_id: organizationId,
      },
    ], { authorizationToken: managerToken });
    if (professionals.length !== 8) throw new Error('Supabase did not create all E2E professionals.');
    const professionalIds = professionals.map(row => String(row.id));

    // Use the real invitation RPC rather than inserting membership alone:
    // it also sets the protected default organization used by data requests.
    for (const [account, role, index] of [
      ['operational', 'barbeiro', 0],
      ['customRole', 'e2e-custom', 1],
      ['invited', 'barbeiro', 2],
    ] as const) {
      const memberToken = token();
      await createInvitation(config, {
        organizationId,
        professionalId: professionalIds[index],
        email: createdAccounts[account].credentials.email,
        invitedBy: createdAccounts.manager.userId,
        role,
        token: memberToken,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await request(config, '/rest/v1/rpc/accept_organization_invitation', {
        method: 'POST',
        body: { p_token: memberToken },
        authorizationToken: await signInUser(config, createdAccounts[account].credentials),
      });
    }

    const receptionInvitation = await request(config, '/rest/v1/rpc/create_reception_invitation', {
      method: 'POST',
      body: { p_email: createdAccounts.reception.credentials.email },
      authorizationToken: managerToken,
    }) as { token?: string; role?: string; professional_id?: string | null };
    if (receptionInvitation.role !== 'recepcao' || !receptionInvitation.token || receptionInvitation.professional_id !== null) {
      throw new Error('Supabase did not create a receptionist email invitation without a professional profile.');
    }
    await request(config, '/rest/v1/rpc/accept_organization_invitation', {
      method: 'POST',
      body: { p_token: receptionInvitation.token },
      authorizationToken: await signInUser(config, createdAccounts.reception.credentials),
    });

    const receptionAttendance = {
      clientId: `e2e-reception-client-${id}`,
      productId: `e2e-reception-product-${id}`,
      professionalId: professionalIds[0],
    };
    await postgrest(config, 'clients', {
      id: receptionAttendance.clientId,
      name: 'Cliente recepção E2E',
      whatsapp: '11999990001',
      visits: [],
      organization_id: organizationId,
    });
    await postgrest(config, 'products', {
      id: receptionAttendance.productId,
      name: 'Produto recepção E2E',
      category: 'Teste',
      price: 25,
      cost: 5,
      stock: 10,
      min_stock: 1,
      organization_id: organizationId,
    });

    await postgrest(config, 'organization_settings', {
      payload: {
        roles: [
          {
            key: 'e2e-custom',
            label: 'Papel customizado E2E',
            isActive: true,
            permissions: ['dashboard', 'agenda'],
          },
        ],
      },
    }, {
      method: 'PATCH',
      query: `?organization_id=eq.${encodeURIComponent(organizationId)}`,
      prefer: 'return=representation',
      authorizationToken: managerToken,
    });

    const now = Date.now();
    const pendingToken = token();
    const expiredToken = token();
    const revokedToken = token();
    const usedToken = token();
    const emailCheckToken = token();
    const future = (days: number) => new Date(now + days * 86_400_000).toISOString();
    const past = (days: number) => new Date(now - days * 86_400_000).toISOString();

    await createInvitation(config, {
      organizationId,
      professionalId: professionalIds[3],
      email: email('pending', id),
      invitedBy: createdAccounts.manager.userId,
      token: pendingToken,
      expiresAt: future(7),
    });
    await createInvitation(config, {
      organizationId,
      professionalId: professionalIds[4],
      email: createdAccounts.expired.credentials.email,
      invitedBy: createdAccounts.manager.userId,
      token: expiredToken,
      expiresAt: past(1),
    });
    await createInvitation(config, {
      organizationId,
      professionalId: professionalIds[5],
      email: createdAccounts.revoked.credentials.email,
      invitedBy: createdAccounts.manager.userId,
      token: revokedToken,
      expiresAt: future(7),
      revokedAt: new Date(now - 60_000).toISOString(),
    });
    await createInvitation(config, {
      organizationId,
      professionalId: professionalIds[2],
      email: createdAccounts.expired.credentials.email,
      invitedBy: createdAccounts.manager.userId,
      token: usedToken,
      expiresAt: future(7),
      acceptedAt: new Date(now - 60_000).toISOString(),
      acceptedBy: createdAccounts.invited.userId,
    });
    await createInvitation(config, {
      organizationId,
      professionalId: professionalIds[6],
      email: createdAccounts.invited.credentials.email,
      invitedBy: createdAccounts.manager.userId,
      token: emailCheckToken,
      expiresAt: future(7),
    });

    const revenueAppointments = await postgrest(config, 'appointments', [
      {
        id: `e2e-revenue-today-${id}`,
        date: dateKey(),
        time: '09:00',
        client: `Cliente faturamento hoje ${id}`,
        professional_id: professionalIds[0],
        service: 'Barbearia',
        duration: 30,
        status: 'completed',
        value: 100,
        tip: 10,
        products: [],
        pay_method: 'pix',
        payment_splits: [],
        organization_id: organizationId,
      },
      {
        id: `e2e-revenue-today-secondary-${id}`,
        date: dateKey(),
        time: '10:00',
        client: `Cliente faturamento hoje 2 ${id}`,
        professional_id: professionalIds[1],
        service: 'Barbearia',
        duration: 30,
        status: 'completed',
        value: 50,
        tip: 0,
        products: [],
        pay_method: 'dinheiro',
        payment_splits: [],
        organization_id: organizationId,
      },
      {
        id: `e2e-revenue-week-${id}`,
        date: dateKey(-3),
        time: '11:00',
        client: `Cliente faturamento semanal ${id}`,
        professional_id: professionalIds[0],
        service: 'Barbearia',
        duration: 30,
        status: 'completed',
        value: 200,
        tip: 0,
        products: [],
        pay_method: 'credito',
        payment_splits: [],
        organization_id: organizationId,
      },
      {
        id: `e2e-revenue-month-${id}`,
        date: dateKey(-10),
        time: '12:00',
        client: `Cliente faturamento mensal ${id}`,
        professional_id: professionalIds[1],
        service: 'Barbearia',
        duration: 30,
        status: 'completed',
        value: 300,
        tip: 0,
        products: [],
        pay_method: 'debito',
        payment_splits: [],
        organization_id: organizationId,
      },
    ], { authorizationToken: managerToken });
    if (revenueAppointments.length !== 4) {
      throw new Error(`Supabase did not create all E2E revenue appointments (created ${revenueAppointments.length}).`);
    }

    const manifest: E2EFixtureManifest = {
      organizationId,
      onboardingUserId: createdAccounts.onboarding.userId,
      accounts: {
        manager: createdAccounts.manager.credentials,
        operational: createdAccounts.operational.credentials,
        reception: createdAccounts.reception.credentials,
        customRole: createdAccounts.customRole.credentials,
        invited: createdAccounts.invited.credentials,
        onboarding: createdAccounts.onboarding.credentials,
        expired: createdAccounts.expired.credentials,
        revoked: createdAccounts.revoked.credentials,
      },
      invitationTokens: {
        pending: pendingToken,
        expired: expiredToken,
        revoked: revokedToken,
        used: usedToken,
        emailCheck: emailCheckToken,
      },
      receptionAttendance,
      userIds,
    };
    mkdirSync(dirname(config.fixtureFile), { recursive: true });
    writeFileSync(config.fixtureFile, `${JSON.stringify(manifest)}\n`, { encoding: 'utf8', mode: 0o600 });
    chmodSync(config.fixtureFile, 0o600);
    rmSync(cleanupStateFile, { force: true });
  } catch (error) {
    await setOrganizationCreationEnabled(config, false).catch(() => undefined);
    await cleanupFixtures(config, { organizationId, userIds });
    throw error;
  }
}

export function readFixtureManifest(): E2EFixtureManifest | undefined {
  try {
    return JSON.parse(readFileSync(fixtureFile, 'utf8')) as E2EFixtureManifest;
  } catch {
    return undefined;
  }
}

export async function cleanupFixtures(
  config = getConfig(),
  partial: { organizationId?: string; userIds?: string[] } = {},
): Promise<void> {
  const manifest = readFixtureManifest();
  const cleanupState = readFixtureCleanupState();
  const userIds = [
    ...new Set([
      ...(partial.userIds || []),
      ...(cleanupState?.userIds || []),
      ...(manifest?.userIds || []),
    ]),
  ];
  const organizationIds = new Set(
    [partial.organizationId, cleanupState?.organizationId, manifest?.organizationId].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const cleanupErrors: string[] = [];
  await setOrganizationCreationEnabled(config, false).catch(error => {
    cleanupErrors.push(`could not close organization creation: ${String(error)}`);
  });

  if (userIds.length) {
    const ids = userIds.map(encodeURIComponent).join(',');
    const profiles = await request(
      config,
      `/rest/v1/profiles?id=in.(${ids})&select=default_organization_id`,
    ).catch(error => {
      cleanupErrors.push(`could not discover profile organizations: ${String(error)}`);
      return undefined;
    });
    if (Array.isArray(profiles)) {
      for (const profile of profiles) {
        if (profile && typeof profile === 'object') {
          const organizationId = (profile as Record<string, unknown>).default_organization_id;
          if (typeof organizationId === 'string') organizationIds.add(organizationId);
        }
      }
    }

    const memberships = await request(
      config,
      `/rest/v1/organization_members?user_id=in.(${ids})&select=organization_id`,
    ).catch(error => {
      cleanupErrors.push(`could not discover membership organizations: ${String(error)}`);
      return undefined;
    });
    if (Array.isArray(memberships)) {
      for (const membership of memberships) {
        if (membership && typeof membership === 'object') {
          const organizationId = (membership as Record<string, unknown>).organization_id;
          if (typeof organizationId === 'string') organizationIds.add(organizationId);
        }
      }
    }
  }

  for (const organizationId of organizationIds) {
    try {
      await request(
        config,
        `/rest/v1/organization_join_requests?organization_id=eq.${encodeURIComponent(organizationId)}`,
        {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        },
      );
    } catch (error) {
      cleanupErrors.push(`could not delete organization join requests ${organizationId}: ${String(error)}`);
    }
    try {
      await request(
        config,
        `/rest/v1/organization_invitations?organization_id=eq.${encodeURIComponent(organizationId)}`,
        {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        },
      );
    } catch (error) {
      cleanupErrors.push(`could not delete organization invitations ${organizationId}: ${String(error)}`);
    }
  }

  await Promise.all(
    userIds.map(async userId => {
      try {
        await request(config, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
        });
      } catch (error) {
        cleanupErrors.push(`could not delete user ${userId}: ${String(error)}`);
      }
    }),
  );

  for (const organizationId of organizationIds) {
    try {
      await request(config, `/rest/v1/organizations?id=eq.${encodeURIComponent(organizationId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (error) {
      cleanupErrors.push(`could not delete organization ${organizationId}: ${String(error)}`);
    }
  }
  if (cleanupErrors.length) {
    throw new Error(`E2E fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
  removeFixtureFiles();
}

const scenarioCleanupTables = [
  { name: 'subscription_payments', timestampColumn: 'created_at' },
  { name: 'finance_entry_changes', timestampColumn: 'changed_at' },
  { name: 'organization_invitations', timestampColumn: 'created_at' },
  { name: 'organization_members', timestampColumn: 'created_at' },
  { name: 'communication_sends', timestampColumn: 'created_at' },
  { name: 'appointments', timestampColumn: 'created_at' },
  { name: 'product_sales', timestampColumn: 'created_at' },
  { name: 'blocks', timestampColumn: 'created_at' },
  { name: 'subscribers', timestampColumn: 'created_at' },
  { name: 'expenses', timestampColumn: 'created_at' },
  { name: 'incomes', timestampColumn: 'created_at' },
  { name: 'prothesis_sales', timestampColumn: 'created_at' },
  { name: 'mentoria_sessions', timestampColumn: 'created_at' },
  { name: 'clients', timestampColumn: 'created_at' },
  { name: 'products', timestampColumn: 'created_at' },
  { name: 'professionals', timestampColumn: 'created_at' },
  { name: 'subscription_plans', timestampColumn: 'created_at' },
] as const;

export function beginScenarioSnapshot(): E2EScenarioSnapshot | undefined {
  if (!isProvisioningEnabled()) return undefined;
  const manifest = readFixtureManifest();
  return manifest?.organizationId && manifest.onboardingUserId
    ? {
        organizationId: manifest.organizationId,
        onboardingUserId: manifest.onboardingUserId,
        startedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function cleanupScenarioFixtures(
  snapshot: E2EScenarioSnapshot | undefined,
  config?: ProvisionConfig,
): Promise<void> {
  if (!snapshot) return;
  const resolvedConfig = config || getConfig();
  const cleanupErrors: string[] = [];
  const organizationId = encodeURIComponent(snapshot.organizationId);
  const startedAt = encodeURIComponent(snapshot.startedAt);
  const onboardingUserId = encodeURIComponent(snapshot.onboardingUserId);

  for (const table of scenarioCleanupTables) {
    try {
      await request(
        resolvedConfig,
        `/rest/v1/${table.name}?organization_id=eq.${organizationId}&${table.timestampColumn}=gt.${startedAt}`,
        {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        },
      );
    } catch (error) {
      cleanupErrors.push(`could not delete scenario ${table.name} rows: ${String(error)}`);
    }
  }

  try {
    const memberships = await request(
      resolvedConfig,
      `/rest/v1/organization_members?user_id=eq.${onboardingUserId}&select=organization_id`,
    );
    if (Array.isArray(memberships)) {
      const onboardingOrganizationIds = new Set(
        memberships
          .filter((membership): membership is Record<string, unknown> => (
            Boolean(membership) && typeof membership === 'object'
          ))
          .map(membership => membership.organization_id)
          .filter(
            (value): value is string => typeof value === 'string' && value !== snapshot.organizationId,
          ),
      );

      for (const onboardingOrganizationId of onboardingOrganizationIds) {
        try {
          await request(
            resolvedConfig,
            `/rest/v1/organizations?id=eq.${encodeURIComponent(onboardingOrganizationId)}`,
            {
              method: 'DELETE',
              headers: { Prefer: 'return=minimal' },
            },
          );
        } catch (error) {
          cleanupErrors.push(
            `could not delete onboarding organization ${onboardingOrganizationId}: ${String(error)}`,
          );
        }
      }
    }
  } catch (error) {
    cleanupErrors.push(`could not discover onboarding organizations: ${String(error)}`);
  }

  if (cleanupErrors.length) {
    throw new Error(`E2E scenario fixture cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
}

export function getFixtureFile() {
  return fixtureFile;
}

/** History fixtures are always scoped to the disposable provisioned organization. */
export async function professionalHistoryRequest(
  table: 'professionals' | 'appointments' | 'blocks' | 'prothesis_sales' |
    'mentoria_sessions' | 'subscription_plans' | 'subscribers' | 'subscription_payments' |
    'organization_members',
  method: 'GET' | 'POST' | 'PATCH',
  body?: Record<string, unknown>,
  filter?: { column: 'id' | 'subscriber_id' | 'user_id'; value: string },
): Promise<Record<string, unknown>[]> {
  if (!isProvisioningEnabled()) throw new Error('History tests require E2E_PROVISION=true.');
  const manifest = readFixtureManifest();
  if (!manifest) throw new Error('Disposable E2E fixture manifest not found.');
  const config = getConfig(); // Validates the dedicated URL against production before every request.
  if (method === 'PATCH' && !filter) throw new Error('History fixture updates require a record filter.');
  const result = await request(
    config,
    `/rest/v1/${table}?organization_id=eq.${encodeURIComponent(manifest.organizationId)}&order=${table === 'organization_members' ? 'user_id' : 'id'}${
      filter ? `&${filter.column}=eq.${encodeURIComponent(filter.value)}` : ''
    }`,
    {
      method,
      headers: { Prefer: 'return=representation' },
      ...(body ? { body: { ...body, organization_id: manifest.organizationId } } : {}),
    },
  );
  if (!Array.isArray(result)) throw new Error(`Unexpected history fixture response for ${table}.`);
  return result;
}

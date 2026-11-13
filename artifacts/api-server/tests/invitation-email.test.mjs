import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { ReplitConnectors } from '@replit/connectors-sdk';
import { build } from 'esbuild';
import test, { after, afterEach, before, beforeEach } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const previousFetch = globalThis.fetch;
const originalProxy = ReplitConnectors.prototype.proxy;
const invitationId = '41a66137-805b-4fda-9be5-cd649a6d7738';
const token = 'b'.repeat(64);
const tokenHash = createHash('sha256').update(token).digest('hex');

let generatedDirectory;
let invitationRouter;
let server;
let serverUrl;
let resendCalls;
let resendStatus;
let invitationRows;
let webhookSecret;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function mockSupabaseFetch(input, init = {}) {
  const url = new URL(String(input));
  const authorization = new Headers(init.headers).get('Authorization');

  if (url.pathname === '/auth/v1/user') {
    if (authorization !== 'Bearer valid-supabase-session') {
      return jsonResponse({ message: 'Invalid token' }, 401);
    }
    return jsonResponse({ id: 'manager-user' });
  }

  if (url.pathname === '/rest/v1/organization_invitations') {
    if (init.method === 'PATCH') {
      assert.equal(authorization, 'Bearer test-service-role-key');
      const id = url.searchParams.get('id')?.slice(3);
      const row = invitationRows.find(item => item.id === id);
      if (!row) return jsonResponse([]);
      Object.assign(row, JSON.parse(init.body));
      return jsonResponse([row]);
    }

    assert.equal(authorization, 'Bearer valid-supabase-session');
    const idFilter = url.searchParams.get('id');
    const hashFilter = url.searchParams.get('token_hash');
    const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : '';
    const hash = hashFilter?.startsWith('eq.') ? hashFilter.slice(3) : '';
    return jsonResponse(invitationRows.filter(row => row.id === id && row.token_hash === hash));
  }

  if (url.pathname === '/rest/v1/rpc/record_resend_invitation_email_event') {
    assert.equal(authorization, 'Bearer test-service-role-key');
    const { p_email_id: emailId, p_status: status, p_event_at: eventAt } = JSON.parse(init.body);
    const row = invitationRows.find(item => item.resend_email_id === emailId);
    if (
      row &&
      !['delivered', 'bounced', 'failed', 'complained'].includes(row.email_delivery_status) &&
      (!row.email_delivery_updated_at || Date.parse(row.email_delivery_updated_at) <= Date.parse(eventAt))
    ) {
      row.email_delivery_status = status;
      row.email_delivery_updated_at = eventAt;
    }
    return jsonResponse(Boolean(row));
  }

  throw new Error(`Unexpected external fetch in test: ${url.href}`);
}

async function mockResendProxy(connector, requestPath, options = {}) {
  assert.equal(connector, 'resend');
  assert.equal(requestPath, '/emails');
  resendCalls.push({
    headers: new Headers(options.headers),
    body: JSON.parse(options.body),
  });
  if (resendStatus !== 200) {
    return jsonResponse({ message: 'provider error details must not leak' }, resendStatus);
  }
  return jsonResponse({ id: 'resend-email-123' });
}

async function sendApiRequest(route, { method = 'POST', body, token: sessionToken = 'valid-supabase-session' } = {}) {
  const response = await previousFetch(`${serverUrl}${route}`, {
    method,
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      Origin: 'https://app.test',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseBody = await response.json();
  return { response, body: responseBody };
}

function requestBody(overrides = {}) {
  return {
    token,
    invitationUrl: `https://app.test/convite/${token}`,
    consentConfirmed: true,
    ...overrides,
  };
}

function webhookRequest(event, overrides = {}) {
  const body = JSON.stringify(event);
  const messageId = 'msg_invitation-delivery-test';
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(webhookSecret.slice('whsec_'.length), 'base64'))
    .update(`${messageId}.${timestamp}.${body}`)
    .digest('base64');
  return previousFetch(`${serverUrl}/webhooks/resend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${overrides.signature ?? signature}`,
    },
    body,
  });
}

async function sendInvitationEmail() {
  const { response } = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody(),
  });
  assert.equal(response.status, 200);
}

before(async () => {
  generatedDirectory = await mkdtemp(path.join(here, '.generated-'));
  const routeOutput = path.join(generatedDirectory, 'invitation-email.mjs');
  await build({
    entryPoints: [path.join(root, 'artifacts/api-server/src/routes/invitation-email.ts')],
    outfile: routeOutput,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['express', '@replit/connectors-sdk'],
    alias: {
      '@workspace/api-zod': path.join(root, 'lib/api-zod/src/generated/api.ts'),
    },
    sourcemap: false,
  });
  ({ default: invitationRouter } = await import(pathToFileURL(routeOutput).href));
});

beforeEach(async () => {
  process.env.VITE_SUPABASE_URL = 'https://supabase.test';
  process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.E2E_SUPABASE_TEST_SERVICE_ROLE_KEY = 'test-service-role-key';
  webhookSecret = `whsec_${Buffer.from('test webhook secret').toString('base64')}`;
  process.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  globalThis.fetch = mockSupabaseFetch;
  ReplitConnectors.prototype.proxy = mockResendProxy;
  resendCalls = [];
  resendStatus = 200;
  invitationRows = [{
    id: invitationId,
    email: 'profissional@example.com',
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    resend_email_id: null,
    email_delivery_status: null,
    email_delivery_updated_at: null,
  }];

  const app = express();
  app.use('/webhooks/resend', express.raw({ type: 'application/json', limit: '64kb' }));
  app.use(express.json());
  app.use(invitationRouter);
  server = createServer(app);
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  globalThis.fetch = previousFetch;
  ReplitConnectors.prototype.proxy = originalProxy;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

after(async () => {
  if (generatedDirectory) await rm(generatedDirectory, { recursive: true, force: true });
});

test('sends to the email stored on the authorized active invitation', async () => {
  const { response, body } = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { emailId: 'resend-email-123', status: 'sent' });
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].body.to, 'profissional@example.com');
  assert.equal(resendCalls[0].body.from, 'Beauty Manager <nao-responda@auth.msstudios.com.br>');
  assert.match(resendCalls[0].body.text, new RegExp(token));
  assert.match(resendCalls[0].body.html, new RegExp(`href="https://app\\.test/convite/${token}"`));
  assert.equal(resendCalls[0].headers.get('Idempotency-Key'), invitationId);
  assert.equal(invitationRows[0].resend_email_id, 'resend-email-123');
  assert.equal(invitationRows[0].email_delivery_status, 'sent');
});

test('rejects unauthenticated and token-mismatched requests without sending', async () => {
  const unauthenticated = await sendApiRequest(`/invitations/${invitationId}/email`, {
    token: '',
    body: requestBody(),
  });
  assert.equal(unauthenticated.response.status, 401);

  const wrongToken = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody({ token: 'c'.repeat(64), invitationUrl: `https://app.test/convite/${'c'.repeat(64)}` }),
  });
  assert.equal(wrongToken.response.status, 404);
  assert.equal(resendCalls.length, 0);
});

test('rejects expired invitations, missing consent, and links outside the app', async () => {
  invitationRows[0].expires_at = new Date(Date.now() - 1000).toISOString();
  const expired = await sendApiRequest(`/invitations/${invitationId}/email`, { body: requestBody() });
  assert.equal(expired.response.status, 409);

  invitationRows[0].expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const noConsent = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody({ consentConfirmed: false }),
  });
  assert.equal(noConsent.response.status, 400);

  const otherOrigin = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody({ invitationUrl: `https://other.test/convite/${token}` }),
  });
  assert.equal(otherOrigin.response.status, 400);
  assert.equal(resendCalls.length, 0);
});

test('returns a safe rate-limit message when Resend rejects the quota', async () => {
  resendStatus = 429;
  const { response, body } = await sendApiRequest(`/invitations/${invitationId}/email`, {
    body: requestBody(),
  });

  assert.equal(response.status, 429);
  assert.match(body.error, /limite de envio/i);
  assert.doesNotMatch(JSON.stringify(body), /provider error details/);
});

test('rejects unsigned and stale Resend events without echoing event data', async () => {
  const sensitiveToken = 'invitation-secret-token-that-must-not-leak';
  const event = {
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: { email_id: 'resend-email-123', token: sensitiveToken },
  };
  const invalidSignature = await webhookRequest(event, { signature: 'invalid-signature' });
  const invalidBody = await invalidSignature.json();
  assert.equal(invalidSignature.status, 401);
  assert.doesNotMatch(JSON.stringify(invalidBody), new RegExp(sensitiveToken));
  assert.doesNotMatch(JSON.stringify(invalidBody), /resend-email-123/);

  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
  const stale = await webhookRequest(event, { timestamp: staleTimestamp });
  assert.equal(stale.status, 401);
  assert.equal(resendCalls.length, 0);
});

test('records a signed delivery event only for the matching Resend email ID', async () => {
  await sendInvitationEmail();
  invitationRows.push({
    ...invitationRows[0],
    id: '12bc496d-d3c2-4824-9464-9bfa55c96bcd',
    resend_email_id: 'unrelated-resend-email',
    email_delivery_status: 'sent',
  });
  const event = {
    type: 'email.delivered',
    created_at: new Date(Date.now() + 1_000).toISOString(),
    data: { email_id: 'resend-email-123' },
  };

  const response = await webhookRequest(event);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(invitationRows[0].email_delivery_status, 'delivered');
  assert.equal(invitationRows[1].email_delivery_status, 'sent');
});

test('records bounced and failed status but does not downgrade a final delivery result', async () => {
  await sendInvitationEmail();
  const bounced = await webhookRequest({
    type: 'email.bounced',
    created_at: new Date(Date.now() + 1_000).toISOString(),
    data: { email_id: 'resend-email-123' },
  });
  assert.equal(bounced.status, 200);
  assert.equal(invitationRows[0].email_delivery_status, 'bounced');

  const laterFailure = await webhookRequest({
    type: 'email.failed',
    created_at: new Date(Date.now() + 2_000).toISOString(),
    data: { email_id: 'resend-email-123' },
  });
  assert.equal(laterFailure.status, 200);
  assert.equal(invitationRows[0].email_delivery_status, 'bounced');
});

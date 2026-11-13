import { expect, test as base, type Page } from '@playwright/test';
import { saoPauloDateKey } from './date-helpers.ts';
import {
  beginScenarioSnapshot,
  cleanupScenarioFixtures,
  isProvisioningEnabled,
  readFixtureManifest,
} from './provision';

export interface Credentials {
  email: string;
  password: string;
}

function credentials(prefix: string): Credentials | undefined {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return email && password ? { email, password } : undefined;
}

function generated() {
  return isProvisioningEnabled() ? readFixtureManifest() : undefined;
}

export const accounts = {
  get manager() {
    return generated()?.accounts.manager || credentials('E2E_MANAGER');
  },
  get operational() {
    return generated()?.accounts.operational || credentials('E2E_OPERATIONAL');
  },
  get reception() {
    return generated()?.accounts.reception || credentials('E2E_RECEPTION');
  },
  get customRole() {
    return generated()?.accounts.customRole || credentials('E2E_CUSTOM_ROLE');
  },
  get invited() {
    return generated()?.accounts.invited || credentials('E2E_INVITED');
  },
  get onboarding() {
    return generated()?.accounts.onboarding || credentials('E2E_ONBOARDING');
  },
  get expired() {
    return generated()?.accounts.expired || credentials('E2E_EXPIRED');
  },
  get revoked() {
    return generated()?.accounts.revoked || credentials('E2E_REVOKED');
  },
};

export const receptionAttendance = {
  get current() {
    return generated()?.receptionAttendance;
  },
};

export const invitationTokens = {
  get pending() {
    return generated()?.invitationTokens.pending || process.env.E2E_INVITATION_TOKEN;
  },
  get expired() {
    return generated()?.invitationTokens.expired || process.env.E2E_EXPIRED_INVITATION_TOKEN;
  },
  get revoked() {
    return generated()?.invitationTokens.revoked || process.env.E2E_REVOKED_INVITATION_TOKEN;
  },
  get used() {
    return generated()?.invitationTokens.used || process.env.E2E_USED_INVITATION_TOKEN;
  },
  get emailCheck() {
    return generated()?.invitationTokens.emailCheck || process.env.E2E_EMAIL_CHECK_INVITATION_TOKEN;
  },
};

type ScenarioFixtures = {
  scenarioFixtures: void;
};

export const test = base.extend<ScenarioFixtures>({
  scenarioFixtures: [
    async ({}, use) => {
      const snapshot = beginScenarioSnapshot();
      try {
        await use();
      } finally {
        await cleanupScenarioFixtures(snapshot);
      }
    },
    { auto: true },
  ],
});
export { expect };

export function requireAccount(account: Credentials | undefined, name: string): Credentials {
  if (!account) {
    throw new Error(`Configure E2E_${name.toUpperCase()}_EMAIL and E2E_${name.toUpperCase()}_PASSWORD.`);
  }
  return account;
}

async function storedAuthEmail(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const browser = globalThis as unknown as {
      localStorage: {
        length: number;
        key(index: number): string | null;
        getItem(key: string): string | null;
      };
      atob(value: string): string;
    };
    for (let index = 0; index < browser.localStorage.length; index += 1) {
      const key = browser.localStorage.key(index);
      if (!key) continue;
      const raw = browser.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const session = JSON.parse(raw) as { access_token?: unknown };
        if (typeof session.access_token !== 'string') continue;
        const tokenPayload = session.access_token.split('.')[1];
        if (!tokenPayload) continue;
        const base64 = tokenPayload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(browser.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as {
          email?: unknown;
        };
        if (typeof decoded.email === 'string') return decoded.email;
      } catch {
        // Other local-storage entries are not Supabase auth sessions.
      }
    }
    return null;
  });
}

export async function loginAs(page: Page, account: Credentials, options: { invitationToken?: string } = {}) {
  const query = options.invitationToken ? `?convite=${encodeURIComponent(options.invitationToken)}` : '';
  const loginPath = `/login${query}`;
  await page.goto(loginPath);
  const emailField = page.getByLabel('E-mail');
  if (!(await emailField.isVisible().catch(() => false))) {
    const currentEmail = await storedAuthEmail(page).catch(() => null);
    if (currentEmail?.toLowerCase() === account.email.toLowerCase()) return;
    const signOutButton = page.getByRole('button', { name: 'Sair do sistema', exact: true });
    if (await signOutButton.isVisible().catch(() => false)) {
      await signOutButton.click();
      await expect.poll(() => storedAuthEmail(page), { timeout: 20_000 }).toBeNull();
      await page.goto(loginPath);
    } else if (currentEmail) {
      await page.evaluate(() => {
        const storage = globalThis as typeof globalThis & {
          localStorage: { clear: () => void };
          sessionStorage: { clear: () => void };
        };
        storage.localStorage.clear();
        storage.sessionStorage.clear();
      });
      await page.reload();
    }
  }
  await expect(emailField).toBeVisible();
  await emailField.fill(account.email);
  await page.getByLabel('Senha').fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
}

export async function openModule(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole('heading').filter({ hasText: heading }).first()).toBeVisible();
  await expect(page.locator('main .animate-pulse')).toHaveCount(0, { timeout: 20_000 });
}

export async function settleMutation(page: Page) {
  // Mutations now resolve only after Supabase confirms the write.
  await Promise.resolve();
}

export function waitForMutation(page: Page, table: string, method: string) {
  return page.waitForResponse(
    response =>
      response.url().includes(`/rest/v1/${table}`) &&
      response.request().method() === method &&
      response.ok(),
  );
}

export function waitForRpcMutation(page: Page, functionName: string, method = 'POST') {
  return page.waitForResponse(
    response =>
      response.url().includes(`/rest/v1/rpc/${functionName}`) &&
      response.request().method() === method &&
      response.ok(),
  );
}

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}`;
}

export function today() {
  return saoPauloDateKey();
}
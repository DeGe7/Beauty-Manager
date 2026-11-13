import type { Page } from '@playwright/test';
import { accounts, expect, loginAs, openModule, test } from '../fixtures';
import { historySnapshot, seedProfessionalHistory, withoutAttribution } from '../professional-history-fixtures';
import { professionalHistoryRequest } from '../provision';

const rpcPath = '/rest/v1/rpc/delete_professional_preserving_history';

async function financialTotals(page: Page) {
  await openModule(page, '/financeiro', 'Financeiro');
  const totals: Record<string, string> = {};
  for (const label of ['Entradas', 'Saídas', 'Resultado']) {
    const card = page.getByText(label, { exact: true }).locator('..');
    totals[label] = (await card.locator('p').last().innerText()).trim();
  }
  return totals;
}

test.describe('exclusão segura de profissionais com histórico', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    // Never run these destructive scenarios against a pre-running app that
    // might still be configured with production credentials.
    if (process.env.E2E_PROVISION !== 'true' || process.env.E2E_START_SERVER !== 'true') {
      throw new Error('Run professional-deletion.spec.ts with the isolated provisioned E2E server.');
    }
    const port = process.env.E2E_PORT || '23946';
    expect(baseURL).toBe(`http://127.0.0.1:${port}`);
    if (!accounts.manager) throw new Error('Provisioned manager account is required.');
    await loginAs(page, accounts.manager);
  });

  test('cancelamento não exclui; confirmação preserva histórico e valores após recarregar', async ({ page }) => {
    test.setTimeout(120_000);
    const initialTotals = await financialTotals(page);
    const { prefix, professionalId } = await seedProfessionalHistory();
    const before = await historySnapshot(prefix);
    for (const rows of Object.values(before)) expect(rows).toHaveLength(1);
    const totalsBefore = await financialTotals(page);
    // These values ensure the snapshots are not comparing an empty/hidden history.
    const amount = (display: string) => Number(display.replace(/[^\d,-]/g, '').replace(',', '.'));
    expect(amount(totalsBefore.Entradas) - amount(initialTotals.Entradas)).toBeCloseTo(1540.65, 2);
    await openModule(page, '/profissionais', 'Equipe');
    const heading = page.getByRole('heading', { name: prefix, exact: true });
    await expect(heading).toBeVisible();
    let rpcCalls = 0;
    let directDeletes = 0;
    page.on('request', request => {
      if (request.url().includes(rpcPath) && request.method() === 'POST') rpcCalls++;
      if (request.url().includes('/rest/v1/') && request.method() === 'DELETE') directDeletes++;
    });

    await page.getByRole('button', { name: `Excluir ${prefix}`, exact: true }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText('Atendimentos, vendas e valores serão preservados');
    await expect(confirmation).toContainText('A exclusão não pode ser desfeita.');
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(heading).toBeVisible();
    expect(rpcCalls).toBe(0);
    expect(await historySnapshot(prefix)).toEqual(before);
    await page.reload();
    await expect(heading).toBeVisible();

    await page.getByRole('button', { name: `Excluir ${prefix}`, exact: true }).click();
    const deletion = page.waitForResponse(response =>
      response.url().includes(rpcPath) && response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: 'Excluir profissional', exact: true }).click();
    const response = await deletion;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ p_professional_id: professionalId });
    expect(await response.json()).toBe(professionalId);
    await expect(heading).toHaveCount(0);
    await expect(page.getByText('Profissional excluído. Histórico e valores preservados.', { exact: true })).toBeVisible();
    expect(rpcCalls).toBe(1);
    expect(directDeletes).toBe(0);
    await page.reload();
    await expect(page.locator('main h2').filter({ hasText: 'Equipe' })).toBeVisible();
    await expect(page.locator('main .animate-pulse')).toHaveCount(0);
    await expect(heading).toHaveCount(0);
    const professionals = await professionalHistoryRequest('professionals', 'GET');
    expect(professionals.some(row => row.id === professionalId)).toBe(false);

    const after = await historySnapshot(prefix);
    expect(withoutAttribution(after)).toEqual(withoutAttribution(before));
    for (const table of ['appointments', 'blocks', 'subscribers']) {
      expect(after[table][0].professional_id).toBeNull();
    }
    for (const table of ['prothesis_sales', 'mentoria_sessions']) {
      expect(after[table][0].seller_id).toBeNull();
    }

    await openModule(page, '/controle', 'Controle Diário');
    const attendance = page.locator('tbody tr').filter({ hasText: `${prefix} atendimento` });
    await expect(attendance).toContainText('Profissional não disponível');
    await expect(attendance).toContainText(/140,00/);
    await page.reload();
    await expect(attendance).toContainText('Profissional não disponível');
    await expect(attendance).toContainText(/140,00/);

    await openModule(page, '/agenda', 'Agenda');
    const appointment = page.getByText(`${prefix} atendimento`, { exact: true }).last().locator('..');
    await expect(appointment).toContainText('Profissional removido');

    await openModule(page, '/planos', 'Planos Disponíveis');
    const history = page.locator('section').filter({ hasText: 'Histórico presencial' });
    const payment = history.getByText(`${prefix} assinante`, { exact: true }).locator('..').locator('..');
    const subscriber = page.getByRole('table').getByRole('row').filter({ hasText: `${prefix} assinante` });
    await expect(payment).toContainText(/149,90/);
    await expect(payment).toContainText('Paga');
    await page.reload();
    await expect(subscriber).toBeVisible();
    await expect(payment).toContainText(/149,90/);
    expect(await financialTotals(page)).toEqual(totalsBefore);
  });

  test('RPC ausente mostra orientação e mantém profissional, histórico e valores', async ({ page }) => {
    test.setTimeout(90_000);
    const { prefix } = await seedProfessionalHistory();
    const before = await historySnapshot(prefix);
    const totalsBefore = await financialTotals(page);
    await openModule(page, '/profissionais', 'Equipe');
    const heading = page.getByRole('heading', { name: prefix, exact: true });
    await expect(heading).toBeVisible();
    let rpcCalls = 0;
    let directDeletes = 0;
    page.on('request', request => {
      if (request.url().includes('/rest/v1/') && request.method() === 'DELETE') directDeletes++;
    });
    // Simulate PostgREST's missing-function response without removing the real
    // RPC or changing the shared test database schema.
    await page.route(`**${rpcPath}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      rpcCalls++;
      await route.fulfill({
        status: 404, contentType: 'application/json',
        body: JSON.stringify({
          code: 'PGRST202', details: null, hint: null,
          message: 'Could not find the function public.delete_professional_preserving_history in the schema cache',
        }),
      });
    });
    await page.getByRole('button', { name: `Excluir ${prefix}`, exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir profissional', exact: true }).click();
    await expect(page.getByText('Aplique a migração de exclusão segura de profissionais no Supabase antes de excluir um profissional com histórico.', { exact: true })).toBeVisible();
    await expect(heading).toBeVisible();
    expect(rpcCalls).toBe(1);
    expect(directDeletes).toBe(0);
    await expect(page.getByText('Profissional excluído. Histórico e valores preservados.', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(heading).toBeVisible();
    expect(await historySnapshot(prefix)).toEqual(before);
    expect(await financialTotals(page)).toEqual(totalsBefore);
  });
});

import { accounts, expect, loginAs, openModule, requireAccount, test } from '../fixtures';
import { seedProfessionalHistory } from '../professional-history-fixtures';
import { professionalHistoryRequest } from '../provision';

test.describe('revogação de acesso em sessões abertas', () => {
  test.beforeEach(async ({ baseURL }) => {
    if (process.env.E2E_PROVISION !== 'true' || process.env.E2E_START_SERVER !== 'true') {
      throw new Error('Run access-revocation.spec.ts with the isolated provisioned E2E server.');
    }
    expect(baseURL).toBe(`http://127.0.0.1:${process.env.E2E_PORT || '23946'}`);
  });

  for (const trigger of ['polling', 'retorno à aba'] as const) {
    test(`exclusão pelo gestor encerra a sessão protegida via ${trigger}, sem afetar os demais membros`, async ({ page, browser }) => {
      test.setTimeout(120_000);
      const operational = requireAccount(accounts.operational, 'operational');
      const { prefix, professionalId } = await seedProfessionalHistory();
      const professionals = await professionalHistoryRequest('professionals', 'GET');
      const originalProfessional = professionals.find(row => row.name === 'Profissional operacional E2E');
      if (!originalProfessional) throw new Error('Operational professional fixture not found.');
      const memberships = await professionalHistoryRequest('organization_members', 'GET');
      const membership = memberships.find(row => row.professional_id === originalProfessional.id);
      if (!membership) throw new Error('Operational membership fixture not found.');
      const filter = { column: 'user_id' as const, value: String(membership.user_id) };
      const managerContext = await browser.newContext();
      const otherContext = await browser.newContext();
      try {
        await professionalHistoryRequest('organization_members', 'PATCH', {
          professional_id: professionalId, is_active: true,
        }, filter);
        await loginAs(page, operational);
        await openModule(page, '/controle', 'Controle Diário');
        const cachedAttendance = page.locator('tbody tr').filter({ hasText: `${prefix} atendimento` });
        await expect(cachedAttendance).toBeVisible();

        const manager = await managerContext.newPage();
        const other = await otherContext.newPage();
        await loginAs(manager, requireAccount(accounts.manager, 'manager'));
        await openModule(manager, '/profissionais', 'Equipe');
        await loginAs(other, requireAccount(accounts.customRole, 'custom_role'));
        await openModule(other, '/agenda', 'Agenda');
        // Keep the professional's page open: never reload or log it out.
        await manager.getByRole('button', { name: `Excluir ${prefix}`, exact: true }).click();
        await manager.getByRole('alertdialog').getByRole('button', { name: 'Excluir profissional', exact: true }).click();
        await expect(manager.getByRole('heading', { name: prefix, exact: true })).toHaveCount(0);
        if (trigger === 'retorno à aba') {
          await page.evaluate("window.dispatchEvent(new Event('focus'))");
        }
        await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 });
        await expect(
          page.getByRole('alert').filter({ hasText: 'Seu acesso a este estabelecimento foi removido' }),
        ).toBeVisible();
        await expect(page.locator('main')).toHaveCount(0);
        await expect(cachedAttendance).toHaveCount(0);
        await page.goBack();
        await expect(page).toHaveURL(/\/onboarding$/);
        await expect(cachedAttendance).toHaveCount(0);

        // Revalidate both unaffected accounts, rather than trusting cached UI.
        await other.evaluate("window.dispatchEvent(new Event('focus'))");
        await expect(other.locator('main h2').filter({ hasText: 'Agenda' })).toBeVisible();
        await manager.evaluate("window.dispatchEvent(new Event('focus'))");
        await expect(manager.locator('main h2').filter({ hasText: 'Equipe' })).toBeVisible();
        const after = await professionalHistoryRequest('organization_members', 'GET', undefined, filter);
        expect(after[0].is_active).toBe(false);
        expect(after[0].professional_id).toBeNull();
      } finally {
        // Restore only the disposable account's original membership so this
        // regression can run alongside the existing permissions/CRUD suites.
        await professionalHistoryRequest('organization_members', 'PATCH', {
          professional_id: originalProfessional.id, is_active: membership.is_active,
        }, filter);
        await managerContext.close();
        await otherContext.close();
      }
    });
  }

  test('falha na revalidação bloqueia dados; recuperação da conexão valida novamente', async ({ page }) => {
    await loginAs(page, requireAccount(accounts.operational, 'operational'));
    await openModule(page, '/controle', 'Controle Diário');
    const membershipRoute = '**/rest/v1/organization_members?*';
    await page.route(membershipRoute, route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ message: 'Temporary access validation outage' }),
    }));
    await page.evaluate("window.dispatchEvent(new Event('focus'))");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Não foi possível validar seu acesso' }),
    ).toBeVisible();
    await expect(page.locator('main')).toHaveCount(0);
    await page.unroute(membershipRoute);
    await page.evaluate("window.dispatchEvent(new Event('online'))");
    const validationError = page.getByRole('alert').filter({
      hasText: 'Não foi possível validar seu acesso',
    });
    await expect(validationError).toHaveCount(0);
    // Navigate without a reload: the restored scope must not need a new login.
    await page.evaluate("window.history.pushState(null, '', '/controle'); window.dispatchEvent(new PopStateEvent('popstate'))");
    await expect(page.locator('main h2').filter({ hasText: 'Controle Diário' })).toBeVisible();
    await expect(validationError).toHaveCount(0);
  });
});

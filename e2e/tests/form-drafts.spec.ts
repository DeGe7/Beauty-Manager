import {
  accounts,
  expect,
  loginAs,
  requireAccount,
  test,
  uniqueName,
} from '../fixtures';

const viewports = [
  { name: 'desktop', width: 1440, height: 900, navPrefix: 'nav-link' },
  { name: 'mobile', width: 390, height: 844, navPrefix: 'mobile-nav-link' },
] as const;

async function navigateModule(
  page: Parameters<typeof loginAs>[0],
  viewport: (typeof viewports)[number],
  module: 'clientes' | 'agenda' | 'controle',
) {
  if (viewport.name === 'mobile') {
    await page.getByRole('button', { name: 'Abrir menu de navegação' }).click();
    await page.getByRole('dialog', { name: 'Menu de navegação' })
      .getByTestId(`nav-link-${module}`).click();
  } else {
    await page.getByTestId(`${viewport.navPrefix}-${module}`).click();
  }
  const heading = module === 'clientes' ? 'Clientes' : module === 'agenda' ? 'Agenda' : 'Controle Diário';
  await expect(page.getByRole('heading').filter({ hasText: heading }).first()).toBeVisible();
}

async function navigateSpa(page: Parameters<typeof loginAs>[0], route: string) {
  await page.evaluate(nextRoute => {
    const browser = globalThis as any;
    browser.history.pushState({}, '', nextRoute);
    browser.dispatchEvent(new browser.PopStateEvent('popstate'));
  }, route);
  await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}$`));
}

function uniquePhone() {
  return `119${Math.floor(Math.random() * 100_000_000).toString().padStart(8, '0')}`;
}

for (const viewport of viewports) {
  test.describe(`Rascunhos de formulários em ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      if (!accounts.manager) {
        test.skip(true, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
        return;
      }
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAs(page, requireAccount(accounts.manager, 'manager'));
    });

    test(`retoma o cliente ao voltar e descarta ao fechar explicitamente (${viewport.name})`, async ({ page }) => {
      await page.goto('/clientes');
      await expect(page.getByRole('heading', { name: 'Clientes', exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const draftName = uniqueName(`Rascunho ${viewport.name}`);
      await dialog.locator('input').nth(0).fill(draftName);
      await dialog.locator('input').nth(1).fill('11987654321');

      let clientWrites = 0;
      page.on('request', request => {
        if (
          request.url().includes('/rest/v1/clients')
          && ['POST', 'PATCH'].includes(request.method())
        ) clientWrites += 1;
      });

      await navigateSpa(page, '/agenda');
      await navigateSpa(page, '/clientes');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').locator('input').nth(0)).toHaveValue(draftName);
      expect(clientWrites).toBe(0);

      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const reopenedDialog = page.getByRole('dialog');
      await expect(reopenedDialog.locator('input').nth(0)).toHaveValue('');
      const savedName = uniqueName(`Cliente salvo ${viewport.name}`);
      await reopenedDialog.locator('input').nth(0).fill(savedName);
      await reopenedDialog.locator('input').nth(1).fill(uniquePhone());
      await reopenedDialog.getByRole('button', { name: 'Salvar Cliente', exact: true }).click();
      await expect(page.getByText(savedName, { exact: true }).filter({ visible: true })).toBeVisible();

      await navigateSpa(page, '/agenda');
      await navigateSpa(page, '/clientes');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test(`limpa o diálogo após 60 segundos fora do módulo (${viewport.name})`, async ({ page }) => {
      await page.goto('/clientes');
      await expect(page.getByRole('heading', { name: 'Clientes', exact: true }).first()).toBeVisible();
      await page.clock.install();
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const draftName = uniqueName(`Rascunho expirado ${viewport.name}`);
      await page.getByRole('dialog').locator('input').nth(0).fill(draftName);

      await navigateSpa(page, '/agenda');
      await page.clock.fastForward(60_001);
      await navigateSpa(page, '/clientes');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      await expect(page.getByRole('dialog').locator('input').nth(0)).toHaveValue('');
    });

    test(`retoma o formulário extenso de atendimento sem enviar dados ao servidor (${viewport.name})`, async ({ page }) => {
      await page.goto('/controle');
      await expect(page.getByRole('heading', { name: 'Controle Diário', exact: true }).first()).toBeVisible();
      const form = page.locator('form').filter({ has: page.getByTestId('button-save-attendance') });
      const draftName = uniqueName(`Atendimento rascunho ${viewport.name}`);
      await form.getByTestId('input-attendance-client-name').fill(draftName);
      await form.getByTestId('input-attendance-notes').fill('Observação ainda não salva');

      let appointmentWrites = 0;
      page.on('request', request => {
        if (
          request.url().includes('/rest/v1/appointments')
          && request.method() === 'POST'
        ) appointmentWrites += 1;
      });

      await navigateModule(page, viewport, 'agenda');
      await navigateModule(page, viewport, 'controle');
      const restoredForm = page.locator('form').filter({ has: page.getByTestId('button-save-attendance') });
      await expect(restoredForm.getByTestId('input-attendance-client-name')).toHaveValue(draftName);
      await expect(restoredForm.getByTestId('input-attendance-notes')).toHaveValue('Observação ainda não salva');
      expect(appointmentWrites).toBe(0);
    });

    test(`descarta rascunhos ao encerrar a sessão (${viewport.name})`, async ({ page }) => {
      await page.goto('/controle');
      const form = page.locator('form').filter({ has: page.getByTestId('button-save-attendance') });
      await form.getByTestId('input-attendance-client-name').fill(uniqueName(`Sessão encerrada ${viewport.name}`));
      await form.getByTestId('input-attendance-notes').fill('Este rascunho não deve voltar');

      if (viewport.name === 'mobile') {
        await page.getByRole('button', { name: 'Abrir menu de navegação' }).click();
        await page.getByRole('dialog', { name: 'Menu de navegação' })
          .getByRole('button', { name: 'Sair do sistema', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Sair do sistema', exact: true }).click();
      }

      await expect(page).toHaveURL(/\/login(?:\?|$)/);
      await loginAs(page, requireAccount(accounts.manager, 'manager'));
      await page.goto('/controle');
      const freshForm = page.locator('form').filter({ has: page.getByTestId('button-save-attendance') });
      await expect(freshForm.getByTestId('input-attendance-client-name')).toHaveValue('');
      await expect(freshForm.getByTestId('input-attendance-notes')).toHaveValue('');
    });
  });
}

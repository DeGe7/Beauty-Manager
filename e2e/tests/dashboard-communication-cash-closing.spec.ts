import {
  accounts,
  expect,
  loginAs,
  openModule,
  requireAccount,
  test,
  today,
  waitForRpcMutation,
} from '../fixtures';
import type { Page } from '@playwright/test';
import {
  cleanupCashCalculationFixtures,
  createCashCalculationFixtures,
  readScenarioOrganizationSettingsPayload,
  restoreScenarioOrganizationSettingsPayload,
} from '../provision';

async function stubCampaignRecipients(
  page: Page,
  recipients: Array<{ id: string; name: string; email: string; whatsapp?: string }>,
) {
  await page.route('**/rest/v1/clients**', async route => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(recipients.map(recipient => ({
        ...recipient,
        whatsapp: recipient.whatsapp ?? '',
        source: 'Anúncio',
        visits: [],
        created_at: new Date().toISOString(),
      }))),
    });
  });
  await page.addInitScript(() => {
    const browserWindow = globalThis as unknown as {
      __e2eOpenedUrls?: string[];
      open: (url?: string) => object | null;
    };
    browserWindow.__e2eOpenedUrls = [];
    browserWindow.open = (url?: string) => {
      browserWindow.__e2eOpenedUrls?.push(String(url ?? ''));
      return {};
    };
  });
}

test.describe('Dashboard, mensagens e fechamento de caixa', () => {
  test('recepção mostra valores conhecidos por forma de pagamento no gráfico diário', async ({ page }) => {
    test.skip(
      !accounts.reception || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned receptionist account and isolated E2E database.',
    );

    await page.route('**/rest/v1/rpc/get_reception_daily_operations', async route => {
      const requestBody = route.request().postDataJSON() as { p_date?: string };
      expect(requestBody.p_date).toBe(today());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: today(),
          attendances: 4,
          planUses: 1,
          incomeByMethod: { debito: 10, credito: 20, pix: 30, dinheiro: 40 },
          incomeTotal: 100,
          incomeWithoutMethod: 0,
          expenseByMethod: { debito: 0, credito: 0, pix: 0, dinheiro: 0 },
          expenseTotal: 0,
          planReceiptsByMethod: { debito: 50, credito: 0, pix: 0, dinheiro: 0, sem_forma: 0 },
          planReceiptTotal: 50,
        }),
      });
    });

    await loginAs(page, requireAccount(accounts.reception, 'reception'));
    await openModule(page, '/dashboard', 'Visão geral');

    const operations = page.getByTestId('reception-daily-operations');
    await expect(operations.getByRole('img', {
      name: 'Gráfico de pizza das entradas de hoje por forma de pagamento',
    })).toBeVisible();
    for (const [method, amount] of [
      ['debito', '10,00'],
      ['credito', '20,00'],
      ['pix', '30,00'],
      ['dinheiro', '40,00'],
      ['planos', '50,00'],
    ]) {
      await expect(operations.getByTestId(`reception-payment-legend-${method}`)).toContainText(`R$ ${amount}`);
    }
    await expect(operations.getByTestId('reception-payment-total')).toHaveText(/R\$\s*150,00/);
  });

  test('o Dashboard soma movimentações reais de caixa e recebimentos de planos', async ({ page }) => {
    test.skip(
      !accounts.reception || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned receptionist account and isolated E2E database.',
    );

    type DailyOperations = {
      date: string;
      incomeByMethod: Record<'debito' | 'credito' | 'pix' | 'dinheiro', number>;
      incomeTotal: number;
      planReceiptsByMethod: Record<'debito' | 'credito' | 'pix' | 'dinheiro' | 'sem_forma', number>;
      planReceiptTotal: number;
    };

    const amounts = {
      debito: 10,
      credito: 20,
      pix: 30,
      dinheiro: 40,
    } as const;
    let fixtures: Awaited<ReturnType<typeof createCashCalculationFixtures>> | undefined;

    try {
      await loginAs(page, requireAccount(accounts.reception, 'reception'));
      const baselineResponse = waitForRpcMutation(page, 'get_reception_daily_operations');
      await openModule(page, '/dashboard', 'Visão geral');
      const baselineRpcResponse = await baselineResponse;
      expect(baselineRpcResponse.ok()).toBe(true);
      const baseline = await baselineRpcResponse.json() as DailyOperations;
      expect(baseline.date).toBe(today());

      fixtures = await createCashCalculationFixtures();
      expect(fixtures.date).toBe(baseline.date);

      const updatedResponse = waitForRpcMutation(page, 'get_reception_daily_operations');
      await page.reload();
      const updatedRpcResponse = await updatedResponse;
      expect(updatedRpcResponse.ok()).toBe(true);
      const updated = await updatedRpcResponse.json() as DailyOperations;

      expect(updated.date).toBe(fixtures.date);
      expect(updated.incomeTotal - baseline.incomeTotal).toBeCloseTo(100, 2);
      expect(updated.planReceiptTotal - baseline.planReceiptTotal).toBeCloseTo(50, 2);
      expect(
        updated.planReceiptsByMethod.credito - baseline.planReceiptsByMethod.credito,
      ).toBeCloseTo(50, 2);
      for (const [method, amount] of Object.entries(amounts) as Array<
        [keyof typeof amounts, number]
      >) {
        expect(updated.incomeByMethod[method] - baseline.incomeByMethod[method])
          .toBeCloseTo(amount, 2);
      }

      const formatBrl = (amount: number) => amount.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const operations = page.getByTestId('reception-daily-operations');
      for (const method of Object.keys(amounts) as Array<keyof typeof amounts>) {
        await expect(operations.getByTestId(`reception-payment-legend-${method}`))
          .toContainText(`R$ ${formatBrl(updated.incomeByMethod[method])}`);
      }
      await expect(operations.getByTestId('reception-payment-legend-planos'))
        .toContainText(`R$ ${formatBrl(updated.planReceiptTotal)}`);
      await expect(operations.getByTestId('reception-payment-total'))
        .toContainText(`R$ ${formatBrl(updated.incomeTotal + updated.planReceiptTotal)}`);
    } finally {
      if (fixtures) await cleanupCashCalculationFixtures(fixtures);
    }
  });

  test('compõe, abre a prévia e registra a campanha sem abrir um canal real', async ({ page }) => {
    test.skip(
      !accounts.manager || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned manager account and isolated E2E database.',
    );

    const clientName = 'Cliente Campanha E2E';
    const phone = '11999990002';
    const messageTemplate = 'Olá, {nome}! Seja bem-vindo à {empresa}.';
    await page.route('**/rest/v1/clients**', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: `e2e-campaign-${Date.now().toString(36)}`,
          name: clientName,
          email: '',
          whatsapp: phone,
          source: 'Anúncio',
          visits: [],
          created_at: new Date().toISOString(),
        }]),
      });
    });
    await page.addInitScript(() => {
      const browserWindow = globalThis as unknown as {
        __e2eOpenedUrls?: string[];
        open: (url?: string) => object | null;
      };
      browserWindow.__e2eOpenedUrls = [];
      browserWindow.open = (url?: string) => {
        browserWindow.__e2eOpenedUrls?.push(String(url ?? ''));
        return {};
      };
    });

    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/comunicacao', 'Disparos de Mensagens');
    await expect(page.getByText(clientName, { exact: true })).toBeVisible();
    await page.locator('textarea').fill(messageTemplate);
    await page.getByLabel('Confirmo que estes contatos autorizaram o recebimento desta comunicação.').check();

    const sendResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/communication_sends') &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Enviar por WhatsApp', exact: true }).click();
    const sendResponse = await sendResponsePromise;
    expect(sendResponse.ok()).toBe(true);
    const savedSend = await sendResponse.json() as Record<string, unknown>;
    expect(savedSend).toMatchObject({
      channel: 'whatsapp',
      kind: 'campaign',
      campaign_id: 'anuncios',
      recipient_name: clientName,
      recipient_address: phone,
      status: 'initiated',
    });

    const openedUrls = await page.evaluate(() => (
      (globalThis as unknown as { __e2eOpenedUrls?: string[] }).__e2eOpenedUrls ?? []
    ));
    expect(openedUrls).toHaveLength(1);
    const openedUrl = openedUrls[0];
    expect(openedUrl).toMatch(/^https:\/\/wa\.me\/5511999990002\?text=/);
    const previewMessage = decodeURIComponent(openedUrl.slice(openedUrl.indexOf('?text=') + 6));
    expect(previewMessage).toMatch(
      /^Olá, Cliente Campanha E2E! Seja bem-vindo à .+\.$/,
    );
    expect(savedSend.message).toBe(previewMessage);
    expect(page.context().pages()).toHaveLength(1);
    await expect(page.getByText('1 envio(s) encaminhado(s) por WhatsApp.')).toBeVisible();

    await page.reload();
    const history = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Histórico de envios', exact: true }),
    });
    await expect(history).toContainText(clientName);
    await expect(history.getByText('Canal aberto para confirmação do envio')).toBeVisible();
  });

  test('prepara e registra uma campanha por e-mail sem abrir um aplicativo real', async ({ page }) => {
    test.skip(
      !accounts.manager || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned manager account and isolated E2E database.',
    );

    const clientName = 'Cliente E-mail Campanha E2E';
    const email = 'cliente-campanha-e2e@example.com';
    const messageTemplate = 'Olá, {nome}! Veja as novidades da {empresa}.';
    const expectedMessage = 'Olá, Cliente E-mail Campanha E2E! Veja as novidades da Beauty Manager.';
    await stubCampaignRecipients(page, [{
      id: `e2e-email-campaign-${Date.now().toString(36)}`,
      name: clientName,
      email,
    }]);

    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/comunicacao', 'Disparos de Mensagens');
    await expect(page.getByText(clientName, { exact: true })).toBeVisible();
    await page.locator('#campaign-channel').selectOption('email');
    await page.locator('textarea').fill(messageTemplate);
    const sendButton = page.getByRole('button', { name: 'Enviar por e-mail', exact: true });
    await expect(sendButton).toBeDisabled();
    await page.getByLabel('Confirmo que estes contatos autorizaram o recebimento desta comunicação.').check();

    const sendResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/communication_sends') &&
      response.request().method() === 'POST',
    );
    await sendButton.click();
    const sendResponse = await sendResponsePromise;
    expect(sendResponse.ok()).toBe(true);
    const savedSend = await sendResponse.json() as Record<string, unknown>;
    expect(savedSend).toMatchObject({
      channel: 'email',
      kind: 'campaign',
      campaign_id: 'anuncios',
      recipient_name: clientName,
      recipient_address: email,
      message: expectedMessage,
      status: 'initiated',
    });

    const openedUrls = await page.evaluate(() => (
      (globalThis as unknown as { __e2eOpenedUrls?: string[] }).__e2eOpenedUrls ?? []
    ));
    expect(openedUrls).toHaveLength(1);
    const openedUrl = openedUrls[0];
    expect(openedUrl).toMatch(/^mailto:/);
    const [encodedRecipient, query = ''] = openedUrl.slice('mailto:'.length).split('?');
    expect(decodeURIComponent(encodedRecipient)).toBe(email);
    const decodedParameters = query.split('&').map(parameter => (
      parameter.split('=').map(value => decodeURIComponent(value))
    ));
    expect(decodedParameters.find(([key]) => key === 'subject')?.[1])
      .toBe('Leads de anúncio — Beauty Manager');
    expect(decodedParameters.find(([key]) => key === 'body')?.[1]).toBe(expectedMessage);
    expect(page.context().pages()).toHaveLength(1);
    await expect(page.getByText('1 envio(s) encaminhado(s) por e-mail.')).toBeVisible();

    await page.reload();
    const history = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Histórico de envios', exact: true }),
    });
    await expect(history).toContainText(clientName);
    await expect(history.getByText('Canal aberto para confirmação do envio')).toBeVisible();
  });

  test('impede iniciar campanha quando o e-mail do contato é inválido', async ({ page }) => {
    test.skip(
      !accounts.manager || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned manager account and isolated E2E database.',
    );

    const clientName = 'Cliente E-mail Inválido E2E';
    await stubCampaignRecipients(page, [{
      id: `e2e-invalid-email-${Date.now().toString(36)}`,
      name: clientName,
      email: 'endereco-invalido',
    }]);

    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/comunicacao', 'Disparos de Mensagens');
    await page.locator('#campaign-channel').selectOption('email');
    await page.getByLabel('Confirmo que estes contatos autorizaram o recebimento desta comunicação.').check();

    await expect(page.getByText('1 contato(s) encontrado(s) • 0 com e-mail válido')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar por e-mail', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: `Enviar mensagem para ${clientName}` })).toBeDisabled();
    const openedUrls = await page.evaluate(() => (
      (globalThis as unknown as { __e2eOpenedUrls?: string[] }).__e2eOpenedUrls ?? []
    ));
    expect(openedUrls).toHaveLength(0);
  });

  test('persiste a agenda semanal e mensal de fechamento após recarregar', async ({ page }) => {
    test.skip(
      !accounts.manager || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned manager account and isolated E2E database.',
    );
    const originalPayload = await readScenarioOrganizationSettingsPayload();
    if (!originalPayload) throw new Error('The E2E organization settings row is missing.');

    try {
      await loginAs(page, requireAccount(accounts.manager, 'manager'));
      await openModule(page, '/financeiro', 'Financeiro');
      const frequency = page.getByRole('combobox', { name: 'Frequência do fechamento de caixa' });
      const saveButton = page.getByRole('button', { name: 'Salvar agenda', exact: true });
      const waitForSave = () => page.waitForResponse(response =>
        response.url().includes('/rest/v1/organization_settings') &&
        response.request().method() === 'POST' &&
        response.ok(),
      );

      await frequency.selectOption('weekly');
      await page.getByRole('combobox', { name: 'Dia da semana do fechamento' }).selectOption('2');
      const weeklySave = waitForSave();
      await saveButton.click();
      expect((await weeklySave).ok()).toBe(true);
      await expect(page.getByText('Agenda de fechamento atualizada.', { exact: true })).toBeVisible();
      await page.reload();
      await expect(frequency).toHaveValue('weekly');
      await expect(page.getByRole('combobox', { name: 'Dia da semana do fechamento' })).toHaveValue('2');

      await frequency.selectOption('monthly');
      await page.getByRole('spinbutton', { name: 'Dia do mês do fechamento' }).fill('19');
      const monthlySave = waitForSave();
      await saveButton.click();
      expect((await monthlySave).ok()).toBe(true);
      await expect(page.getByText('Agenda de fechamento atualizada.', { exact: true })).toBeVisible();
      await page.reload();
      await expect(frequency).toHaveValue('monthly');
      await expect(page.getByRole('spinbutton', { name: 'Dia do mês do fechamento' })).toHaveValue('19');
    } finally {
      await restoreScenarioOrganizationSettingsPayload(originalPayload);
    }
  });
});

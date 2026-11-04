import { accounts, expect, loginAs, openModule, test, uniqueName } from '../fixtures';

function uniquePhone(offset = 0) {
  return `119${String(Date.now() + offset).slice(-8)}`;
}

test.describe('atribuição de vendas no Controle Diário', () => {
  test.beforeEach(async ({ page }) => {
    if (process.env.E2E_PROVISION !== 'true' || process.env.E2E_START_SERVER !== 'true') {
      throw new Error('Execute attendance-attribution.spec.ts no servidor E2E isolado e provisionado.');
    }
    if (!accounts.manager) throw new Error('A conta de gestor E2E é obrigatória.');
    await loginAs(page, accounts.manager);
  });

  test('registra atendimento sem nome sem criar cliente ou visita', async ({ page }) => {
    await openModule(page, '/controle', 'Controle Diário');
    const form = page.locator('form').filter({
      has: page.getByTestId('button-save-attendance'),
    });
    await form.getByTestId('checkbox-anonymous-attendance').check();
    await expect(form.getByTestId('input-attendance-client-name')).toHaveCount(0);
    await expect(form.getByTestId('select-attendance-plan')).toBeDisabled();

    const professional = form.getByTestId('select-attendance-professional');
    const professionalId = await professional.locator('option').nth(1).getAttribute('value');
    expect(professionalId).toBeTruthy();
    await professional.selectOption(professionalId!);
    await form.getByTestId('input-attendance-service-value').fill('50');

    let clientCreates = 0;
    page.on('request', request => {
      if (
        request.url().includes('/rest/v1/clients') &&
        request.method() === 'POST'
      ) clientCreates += 1;
    });
    const appointmentCreated = page.waitForResponse(response =>
      response.url().includes('/rest/v1/appointments') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await form.getByTestId('button-save-attendance').click();
    const appointmentResponse = await appointmentCreated;
    const appointment = await appointmentResponse.json() as {
      client: string;
      client_id: string | null;
      client_phone: string | null;
    };

    expect(appointment.client).toBe('Atendimento sem identificação');
    expect(appointment.client_id).toBeNull();
    expect(appointment.client_phone).toBeNull();
    expect(clientCreates).toBe(0);
    await expect(page.getByRole('row').filter({ hasText: 'Atendimento sem identificação' })).toBeVisible();
  });

  test('persiste a descrição livre separada da categoria de comissão', async ({ page }) => {
    await openModule(page, '/controle', 'Controle Diário');
    const form = page.locator('form').filter({
      has: page.getByTestId('button-save-attendance'),
    });
    await form.getByTestId('checkbox-anonymous-attendance').check();
    const professional = form.getByTestId('select-attendance-professional');
    const professionalId = await professional.locator('option').nth(1).getAttribute('value');
    expect(professionalId).toBeTruthy();
    await professional.selectOption(professionalId!);
    await form.getByTestId('select-attendance-service').selectOption({ label: 'Barbearia' });
    await form.getByTestId('input-attendance-service-description').fill('Corte degradê e acabamento');
    await form.getByTestId('input-attendance-service-value').fill('50');

    const created = page.waitForResponse(response =>
      response.url().includes('/rest/v1/appointments') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await form.getByTestId('button-save-attendance').click();
    const appointment = await (await created).json() as {
      service: string;
      service_id: string;
      service_description: string;
    };
    expect(appointment.service).toBe('Barbearia');
    expect(appointment.service_id).toBeTruthy();
    expect(appointment.service_description).toBe('Corte degradê e acabamento');
  });

  test('não cria cliente nem atendimento identificado sem contato', async ({ page }) => {
    await openModule(page, '/controle', 'Controle Diário');
    const form = page.locator('form').filter({
      has: page.getByTestId('button-save-attendance'),
    });
    const name = uniqueName('Cliente sem telefone');
    await form.getByTestId('input-attendance-client-name').fill(name);
    const professional = form.getByTestId('select-attendance-professional');
    const professionalId = await professional.locator('option').nth(1).getAttribute('value');
    expect(professionalId).toBeTruthy();
    await professional.selectOption(professionalId!);
    await form.getByTestId('input-attendance-service-value').fill('50');

    let clientCreates = 0;
    let appointmentCreates = 0;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (request.url().includes('/rest/v1/rpc/create_or_get_client_by_phone')) clientCreates += 1;
      if (request.url().includes('/rest/v1/appointments')) appointmentCreates += 1;
    });
    await form.getByTestId('button-save-attendance').click();
    await expect(page.getByText('Informe o telefone para criar o cadastro.', { exact: false })).toBeVisible();
    expect(clientCreates).toBe(0);
    expect(appointmentCreates).toBe(0);
  });

  test('salva atribuições distintas, venda própria e serviço comum sem atribuição', async ({ page }) => {
    await openModule(page, '/controle', 'Controle Diário');
    const form = page.locator('form').filter({
      has: page.getByTestId('button-save-attendance'),
    });
    const executor = form.getByTestId('select-attendance-professional');
    const professionals = await executor.locator('option').evaluateAll(options =>
      options
        .map(option => option.getAttribute('value'))
        .filter((value): value is string => Boolean(value)),
    );
    expect(professionals.length).toBeGreaterThanOrEqual(2);

    const saved: Array<{ client: string; sellerId: string | null; company: boolean }> = [];
    const cases = [
      { service: 'Mentoria', sellerId: professionals[1], company: false },
      { service: 'Mentoria', sellerId: 'company', company: true },
      { service: 'Barbearia', sellerId: null, company: false },
    ];

    for (const [scenarioIndex, scenario] of cases.entries()) {
      const client = uniqueName(`Cliente ${scenario.service}`);
      await form.getByTestId('input-attendance-client-name').fill(client);
      await form.getByTestId('select-attendance-service').selectOption({ label: scenario.service });
      await executor.selectOption(professionals[0]);
      await expect(form.getByTestId('attendance-sales-attribution')).toHaveCount(
        scenario.service === 'Barbearia' ? 0 : 1,
      );
      if (scenario.service !== 'Barbearia') {
        await form.getByTestId('select-attendance-seller').selectOption(scenario.sellerId!);
      }
      await form.getByTestId('input-attendance-service-value').fill('100');
      const phone = uniquePhone(scenarioIndex);
      await form.getByTestId('input-attendance-client-phone').fill(phone);
      await expect(form.getByTestId('input-attendance-client-phone')).toHaveValue(phone);

      const created = page.waitForResponse(response =>
        response.url().includes('/rest/v1/appointments') &&
        response.request().method() === 'POST',
      );
      await form.getByTestId('button-save-attendance').click();
      const response = await created;
      const row = await response.json() as {
        seller_professional_id: string | null;
        seller_is_company: boolean;
      };
      expect(row.seller_professional_id).toBe(scenario.company || !scenario.sellerId ? null : scenario.sellerId);
      expect(row.seller_is_company).toBe(scenario.company);
      saved.push({
        client,
        sellerId: row.seller_professional_id,
        company: row.seller_is_company,
      });
    }

    const listResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/appointments?') &&
      response.request().method() === 'GET' &&
      response.ok(),
    );
    await page.reload();
    const listResponse = await listResponsePromise;
    const appointments = await listResponse.json() as Array<{
      client: string;
      seller_professional_id: string | null;
      seller_is_company: boolean;
    }>;
    for (const expected of saved) {
      const persisted = appointments.find(appointment => appointment.client === expected.client);
      expect(persisted).toBeDefined();
      expect(persisted?.seller_professional_id).toBe(expected.sellerId);
      expect(persisted?.seller_is_company).toBe(expected.company);
    }
  });

  test('permite atribuir vários profissionais com comissão manual individual', async ({ page }) => {
    await openModule(page, '/controle', 'Controle Diário');
    const form = page.locator('form').filter({
      has: page.getByTestId('button-save-attendance'),
    });
    const primarySelect = form.getByTestId('select-attendance-professional');
    const professionals = await primarySelect.locator('option').evaluateAll(options =>
      options
        .map(option => option.getAttribute('value'))
        .filter((value): value is string => Boolean(value)),
    );
    expect(professionals.length).toBeGreaterThanOrEqual(2);

    const primaryId = professionals[0];
    const secondId = professionals[1];
    await form.getByTestId('input-attendance-client-name').fill(uniqueName('Cliente comissão manual'));
    await form.getByTestId('select-attendance-service').selectOption({ label: 'Barbearia' });
    await form.getByTestId('input-attendance-service-value').fill('100');
    const phone = uniquePhone(20);
    await form.getByTestId('input-attendance-client-phone').fill(phone);
    await expect(form.getByTestId('input-attendance-client-phone')).toHaveValue(phone);
    await primarySelect.selectOption(primaryId);
    await form.getByRole('button', { name: '+ Adicionar outro profissional' }).click();
    await form.getByTestId('select-attendance-additional-professional-0').selectOption(secondId);
    await expect(form.getByTestId('attendance-manual-commissions')).toBeVisible();
    await form.getByTestId(`input-attendance-manual-commission-${primaryId}`).fill('18.50');
    await form.getByTestId(`input-attendance-manual-commission-${secondId}`).fill('12');
    await expect(form.getByTestId('attendance-manual-commission-balance')).toContainText('Faltam');
    await form.getByTestId(`input-attendance-manual-commission-${secondId}`).fill('31.50');
    await expect(form.getByTestId('attendance-manual-commission-balance')).toContainText('Divisão completa');

    const created = page.waitForResponse(response =>
      response.url().includes('/rest/v1/appointments') &&
      response.request().method() === 'POST',
    );
    await form.getByTestId('button-save-attendance').click();
    const response = await created;
    expect(response.ok(), `appointment insert returned ${response.status()}`).toBe(true);
    const row = await response.json() as {
      professional_id: string;
      professional_commissions: Array<{ professionalId: string; amount: number }>;
      value: number;
    };
    expect(row.professional_id).toBe(primaryId);
    expect(row.value).toBe(100);
    expect(row.professional_commissions).toEqual([
      { professionalId: primaryId, amount: 18.5 },
      { professionalId: secondId, amount: 31.5 },
    ]);
  });

  test('perfil com profissional fixo registra venda sem trocar quem realizou', async ({ browser }) => {
    if (!accounts.operational) {
      test.skip(true, 'A conta operacional E2E é necessária para validar o profissional fixo.');
      return;
    }
    const page = await browser.newPage();
    try {
      await loginAs(page, accounts.operational);
      await openModule(page, '/controle', 'Controle Diário');
      const form = page.locator('form').filter({
        has: page.getByTestId('button-save-attendance'),
      });
      const executor = form.getByTestId('select-attendance-professional');
      await expect(executor).toBeDisabled();
      const fixedProfessionalId = await executor.inputValue();
      expect(fixedProfessionalId).not.toBe('');

      const client = uniqueName('Cliente perfil fixo');
      await form.getByTestId('input-attendance-client-name').fill(client);
      await form.getByTestId('select-attendance-service').selectOption({ label: 'Mentoria' });
      await form.getByTestId('select-attendance-seller').selectOption('company');
      await form.getByTestId('input-attendance-service-value').fill('100');
      const phone = uniquePhone(30);
      await form.getByTestId('input-attendance-client-phone').fill(phone);
      await expect(form.getByTestId('input-attendance-client-phone')).toHaveValue(phone);

      const created = page.waitForResponse(response =>
        response.url().includes('/rest/v1/appointments') &&
        response.request().method() === 'POST',
      );
      await form.getByTestId('button-save-attendance').click();
      const response = await created;
      const row = await response.json() as {
        professional_id: string;
        seller_professional_id: string | null;
        seller_is_company: boolean;
      };
      expect(row.professional_id).toBe(fixedProfessionalId);
      expect(row.seller_professional_id).toBeNull();
      expect(row.seller_is_company).toBe(true);
    } finally {
      if (!page.isClosed()) await page.close().catch(() => undefined);
    }
  });
});

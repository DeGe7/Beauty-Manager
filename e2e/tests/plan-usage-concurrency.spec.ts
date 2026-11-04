import { accounts, expect, loginAs, openModule, test, today, uniqueName } from '../fixtures';

function uniquePhone() {
  return `119${String(Date.now() % 100_000_000).padStart(8, '0')}`;
}

test.describe('consumo concorrente de créditos de planos', () => {
  test('uma última utilização só pode ser consumida por um atendimento', async ({ page }) => {
    test.skip(
      process.env.E2E_PROVISION !== 'true' ||
        process.env.E2E_START_SERVER !== 'true' ||
        !accounts.manager,
      'Requires the isolated provisioned E2E server and manager account.',
    );
    await loginAs(page, accounts.manager!);

    const planName = uniqueName('Plano com último crédito E2E');
    const clientName = uniqueName('Cliente concorrência plano E2E');
    const phone = uniquePhone();
    await openModule(page, '/planos', 'Planos Disponíveis');
    await page.getByRole('button', { name: 'Novo Plano', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('input').nth(0).fill(planName);
    await dialog.locator('input').nth(1).fill('149');
    await dialog.getByTestId('plan-salon-share-percent').fill('50');
    await dialog.getByRole('combobox').nth(0).selectOption({ index: 1 });
    await dialog.getByRole('combobox').nth(1).selectOption({ index: 1 });
    await dialog.locator('input').nth(2).fill('1');
    await dialog.getByRole('button', { name: 'Salvar Plano', exact: true }).click();
    await expect(page.getByText(planName, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Adicionar Assinante', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByTestId('input-subscriber-client-name').fill(clientName);
    await dialog.getByTestId('input-subscriber-client-phone').fill(phone);
    await dialog.locator('select').nth(0).selectOption({ label: planName });
    await dialog.locator('input[type="date"]').fill(today());
    const subscriberCreated = page.waitForResponse(response =>
      response.url().includes('/rest/v1/subscribers') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await dialog.getByRole('button', { name: 'Salvar Assinante', exact: true }).click();
    await subscriberCreated;

    const subscriberRow = page.locator('tbody tr').filter({ hasText: clientName });
    await expect(subscriberRow).toBeVisible();
    await subscriberRow.getByRole('button', { name: `Registrar mensalidade de ${clientName}`, exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('select').nth(0).selectOption('pago');
    await dialog.locator('input[type="number"]').fill('149');
    await dialog.locator('input[type="date"]').nth(1).fill(today());
    await dialog.locator('select').nth(1).selectOption('pix');
    const paymentSaved = page.waitForResponse(response =>
      response.url().includes('/rest/v1/rpc/set_subscription_payment_status') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await dialog.getByRole('button', { name: 'Salvar controle presencial', exact: true }).click();
    await paymentSaved;
    await expect(dialog).toBeHidden();

    const secondPage = await page.context().newPage();
    try {
      await Promise.all([
        openModule(page, '/controle', 'Controle Diário'),
        loginAs(secondPage, accounts.manager!),
      ]);
      await openModule(secondPage, '/controle', 'Controle Diário');

      const forms = [page, secondPage].map(currentPage => currentPage.locator('form').filter({
        has: currentPage.getByTestId('button-save-attendance'),
      }));
      for (const form of forms) {
        await form.getByTestId('input-attendance-client-name').fill(clientName);
        const clientOption = form.locator('[data-testid^="button-select-attendance-client-"]').filter({
          hasText: clientName,
        }).first();
        await expect(clientOption).toBeVisible();
        await clientOption.click();

        const subscriberOption = form.getByTestId('select-attendance-plan').locator('option').filter({
          hasText: clientName,
        }).first();
        const subscriberId = await subscriberOption.getAttribute('value');
        expect(subscriberId).toBeTruthy();
        await form.getByTestId('select-attendance-plan').selectOption(subscriberId!);
        const professional = form.getByTestId('select-attendance-professional');
        const professionalId = await professional.locator('option').evaluateAll(options =>
          options.find(option => Boolean(option.getAttribute('value')))?.getAttribute('value'),
        );
        expect(professionalId).toBeTruthy();
        await professional.selectOption(professionalId!);
      }

      const appointmentResponses = [page, secondPage].map(currentPage =>
        currentPage.waitForResponse(response =>
          response.url().includes('/rest/v1/appointments') &&
          response.request().method() === 'POST',
        ),
      );
      await Promise.all(forms.map(form => form.getByTestId('button-save-attendance').click()));
      const responses = await Promise.all(appointmentResponses);
      const successfulResponses = responses.filter(response => response.ok());
      const rejectedResponses = responses.filter(response => !response.ok());
      expect(successfulResponses).toHaveLength(1);
      expect(rejectedResponses).toHaveLength(1);

      const appointment = await successfulResponses[0].json() as {
        professional_id: string;
        plan_subscriber_id: string;
        plan_usage_value: number;
        value: number;
      };
      expect(appointment.plan_subscriber_id).toBeTruthy();
      expect(appointment.plan_usage_value).toBeGreaterThan(0);
      expect(appointment.value).toBe(0);
    } finally {
      await secondPage.close();
    }
  });
});

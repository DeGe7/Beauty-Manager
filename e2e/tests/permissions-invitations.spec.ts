import {
  accounts,
  expect,
  invitationTokens,
  loginAs,
  openModule,
  receptionAttendance,
  requireAccount,
  test,
  waitForMutation,
} from '../fixtures';
import {
  createE2EJoinRequest,
  getFixtureOrganizationId,
  professionalHistoryRequest,
  setE2EOrganizationCreationEnabled,
} from '../provision';

async function submitPublicJoinRequest(
  page: Parameters<typeof loginAs>[0],
  applicantName: string,
  applicantEmail: string,
) {
  const organizationId = getFixtureOrganizationId();
  if (!organizationId) throw new Error('The disposable E2E organization is unavailable.');
  if (process.env.E2E_PROVISION === 'true') {
    await page.route('**/rpc/request_organization_join*', async route => {
      const requestRow = await createE2EJoinRequest({ applicantName, applicantEmail });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(requestRow),
      });
    });
  }

  await page.goto(`/solicitar-acesso?organization=${encodeURIComponent(organizationId)}`);
  await page.getByLabel('Nome e sobrenome').fill(applicantName);
  await page.getByLabel('E-mail para receber o convite').fill(applicantEmail);
  await page.getByRole('button', { name: 'Enviar pedido ao gestor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pedido enviado', exact: true })).toBeVisible();
}

test.describe('visibilidade e restrições por papel', () => {
  test('gestor alterna entre salões sem permanecer no contexto anterior', async ({ page }) => {
    test.skip(
      process.env.E2E_PROVISION !== 'true' || !accounts.manager,
      'Requires the isolated multi-salon E2E fixtures.',
    );
    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    const selector = page.getByLabel('Salão ativo');
    await expect(selector).toBeVisible();
    await expect(selector.locator('option')).toHaveCount(2);
    const originalOrganizationId = await selector.inputValue();
    const secondaryOption = selector.locator('option').filter({ hasText: 'Salão secundário E2E' });
    const secondaryOrganizationId = await secondaryOption.getAttribute('value');
    expect(secondaryOrganizationId).toBeTruthy();
    if (!secondaryOrganizationId) throw new Error('Secondary E2E organization is missing from the selector.');

    await selector.selectOption(secondaryOrganizationId);
    await expect(selector).toHaveValue(secondaryOrganizationId);
    await page.reload();
    await expect(selector).toHaveValue(secondaryOrganizationId);

    await selector.selectOption(originalOrganizationId);
    await expect(selector).toHaveValue(originalOrganizationId);
  });

  test('gestor cria outro salão e ele aparece na lista de troca', async ({ page }) => {
    test.skip(
      process.env.E2E_PROVISION !== 'true' || !accounts.manager,
      'Requires the isolated multi-salon E2E fixtures.',
    );
    await setE2EOrganizationCreationEnabled(true);
    try {
      await loginAs(page, requireAccount(accounts.manager, 'manager'));
      await page.goto('/onboarding');
      await expect(
        page.getByRole('heading', { name: 'Adicionar outro salão', exact: true }),
      ).toBeVisible();
      const salonName = `Salão criado E2E ${Date.now()}`;
      await page.getByLabel('Nome do estabelecimento').fill(salonName);
      await page.getByRole('button', { name: 'Criar salão', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);

      const selector = page.getByLabel('Salão ativo');
      await expect(selector.locator('option')).toHaveCount(3);
      const newSalonOption = selector.locator('option').filter({ hasText: salonName });
      const newSalonId = await newSalonOption.getAttribute('value');
      expect(newSalonId).toBeTruthy();
      if (!newSalonId) throw new Error('The newly created salon is missing from the selector.');
      await expect(selector).toHaveValue(newSalonId);
      await page.reload();
      await expect(selector).toHaveValue(newSalonId);
    } finally {
      await setE2EOrganizationCreationEnabled(false);
    }
  });

  test('profissional sem conta solicita acesso; gestor aprova e emite convite', async ({ page }) => {
    test.skip(
      !accounts.manager || !getFixtureOrganizationId(),
      'Requires the isolated organization and manager E2E fixtures.',
    );
    const manager = requireAccount(accounts.manager, 'manager');
    const applicantEmail = `request-${Date.now()}@example.test`;
    const applicantName = 'Profissional sem conta E2E';

    await submitPublicJoinRequest(page, applicantName, applicantEmail);

    const browser = page.context().browser();
    if (!browser) throw new Error('Could not create an isolated browser context for the manager.');
    const baseURL = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    if (!baseURL) throw new Error('Could not determine the application URL for the manager context.');
    const managerContext = await browser.newContext({ baseURL });
    try {
      const managerPage = await managerContext.newPage();
      await loginAs(managerPage, manager);
      await openModule(managerPage, '/profissionais', 'Profissionais');
      await managerPage.clock.install();

      const requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      const profileSelect = requestRow.getByRole('combobox', {
        name: `Perfil profissional para ${applicantName}`,
      });
      const profileOption = profileSelect
        .locator('option')
        .filter({ hasText: 'Profissional pedido de acesso E2E' });
      await expect(profileOption).toBeAttached();
      const profileId = await profileOption.getAttribute('value');
      if (!profileId) throw new Error('The expected unlinked professional profile was not available.');
      await profileSelect.selectOption(profileId);
      await requestRow.getByRole('button', { name: 'Aprovar', exact: true }).click();
      await expect(requestRow.getByText('Aprovado', { exact: true })).toBeVisible();
      await expect(requestRow.getByLabel(`Link de convite para ${applicantName}`)).toHaveValue(/\/convite\//);
      await expect(requestRow).toContainText('A conta só será criada e vinculada depois que a pessoa aceitar o convite');
      await managerPage.clock.fastForward(5 * 60 * 1000 + 10_000);
      await expect(requestRow.getByText('Aprovado', { exact: true })).toBeVisible();
      await expect(
        managerPage.getByTestId('organization-join-request-archived-row').filter({ hasText: applicantEmail }),
      ).toHaveCount(0);

      const revokeResponse = managerPage.waitForResponse(response =>
        response.url().includes('/rpc/revoke_approved_join_request_invitation') &&
        response.request().method() === 'POST',
      );
      managerPage.once('dialog', dialog => void dialog.accept());
      await requestRow.getByRole('button', { name: 'Revogar convite e liberar perfil', exact: true }).click();
      expect((await revokeResponse).ok()).toBe(true);
      await expect(requestRow.getByText('Pendente', { exact: true })).toBeVisible();
      await managerPage.clock.fastForward(5 * 60 * 1000 + 10_000);
      await expect(requestRow.getByText('Pendente', { exact: true })).toBeVisible();
      await expect(
        managerPage.getByTestId('organization-join-request-archived-row').filter({ hasText: applicantEmail }),
      ).toHaveCount(0);
      const reopenedProfileSelect = requestRow.getByLabel(`Perfil profissional para ${applicantName}`);
      await expect(
        reopenedProfileSelect.locator('option').filter({ hasText: 'Profissional pedido de acesso E2E' }),
      ).toHaveAttribute('value', profileId);
      const historicalInvite = managerPage.getByTestId('invitation-history-row').filter({ hasText: applicantEmail });
      await expect(historicalInvite).toContainText('Revogado');
      await expect(historicalInvite.getByTestId('invitation-created-by')).toContainText(/Criado por .+/);
      await expect(historicalInvite.getByTestId('invitation-created-at')).toContainText(
        /em \d{2}\/\d{2}\/\d{4}/,
      );
      await expect(historicalInvite.getByTestId('invitation-revoked-by')).toContainText(/Revogado por .+/);
      await expect(historicalInvite.getByTestId('invitation-revoked-at')).toContainText(
        /em \d{2}\/\d{2}\/\d{4}/,
      );

      await reopenedProfileSelect.selectOption(profileId);
      await requestRow.getByRole('button', { name: 'Aprovar', exact: true }).click();
      await expect(requestRow.getByText('Aprovado', { exact: true })).toBeVisible();
      await expect(requestRow.getByLabel(`Link de convite para ${applicantName}`)).toHaveValue(/\/convite\//);
    } finally {
      await managerContext.close();
    }

    await expect(page).toHaveURL(/\/solicitar-acesso$/);
    await expect(page.getByRole('heading', { name: 'Pedido enviado', exact: true })).toBeVisible();
  });

  test('gestor restaura um pedido recusado arquivado e ele não volta ao arquivo automaticamente', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires the provisioned manager account.');
    const manager = requireAccount(accounts.manager, 'manager');
    const applicantEmail = `restore-request-${Date.now()}@example.test`;
    const applicantName = 'Profissional restaurado E2E';

    await submitPublicJoinRequest(page, applicantName, applicantEmail);

    const browser = page.context().browser();
    if (!browser) throw new Error('Could not create an isolated browser context for the manager.');
    const baseURL = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    if (!baseURL) throw new Error('Could not determine the application URL for the manager context.');
    const managerContext = await browser.newContext({ baseURL });
    try {
      const managerPage = await managerContext.newPage();
      await loginAs(managerPage, manager);
      await openModule(managerPage, '/profissionais', 'Profissionais');

      let requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      managerPage.once('dialog', dialog => void dialog.accept());
      await requestRow.getByRole('button', { name: 'Recusar', exact: true }).click();
      await expect(requestRow.getByText('Recusado', { exact: true })).toBeVisible();

      await requestRow.getByRole('button', { name: `Excluir ${applicantName} da lista principal` }).click();
      await managerPage.getByRole('button', { name: 'Arquivar agora', exact: true }).click();
      await managerPage.locator('summary').filter({ hasText: 'Pedidos recusados arquivados' }).click();
      const archivedRow = managerPage
        .getByTestId('organization-join-request-archived-row')
        .filter({ hasText: applicantEmail });
      await expect(archivedRow).toBeVisible();

      await archivedRow.getByRole('button', { name: `Restaurar pedido de ${applicantName}` }).click();
      requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      await expect(requestRow.getByText('Recusado', { exact: true })).toBeVisible();
      await requestRow.locator('summary').filter({ hasText: 'Histórico do pedido' }).click();
      await expect(managerPage.getByText(/^Pedido movido para Arquivados\b/)).toBeVisible();
      await expect(managerPage.getByText(/^Pedido restaurado para a lista principal\b/)).toBeVisible();

      await managerPage.reload();
      await openModule(managerPage, '/profissionais', 'Profissionais');
      requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      await expect(
        managerPage.getByTestId('organization-join-request-archived-row').filter({ hasText: applicantEmail }),
      ).toHaveCount(0);
    } finally {
      await managerContext.close();
    }
  });

  test('pedido recusado permanece ativo por cinco minutos e depois vai para Arquivados com o histórico', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires the provisioned manager account.');
    const manager = requireAccount(accounts.manager, 'manager');
    const applicantEmail = `auto-archive-request-${Date.now()}@example.test`;
    const applicantName = 'Profissional arquivado automaticamente E2E';

    await submitPublicJoinRequest(page, applicantName, applicantEmail);

    const browser = page.context().browser();
    if (!browser) throw new Error('Could not create an isolated browser context for the manager.');
    const baseURL = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    if (!baseURL) throw new Error('Could not determine the application URL for the manager context.');
    const managerContext = await browser.newContext({ baseURL });
    try {
      const managerPage = await managerContext.newPage();
      await loginAs(managerPage, manager);
      await openModule(managerPage, '/profissionais', 'Profissionais');
      await managerPage.clock.install();

      const requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      managerPage.once('dialog', dialog => void dialog.accept());
      await requestRow.getByRole('button', { name: 'Recusar', exact: true }).click();
      await expect(requestRow.getByText('Recusado', { exact: true })).toBeVisible();
      await expect(requestRow).toContainText('Vai para Arquivados em');

      await managerPage.clock.fastForward(4 * 60 * 1000 + 30_000);
      await expect(requestRow).toBeVisible();
      await expect(requestRow.getByText('Recusado', { exact: true })).toBeVisible();

      await managerPage.clock.fastForward(45_000);
      await expect(requestRow).toHaveCount(0);

      await managerPage.locator('summary').filter({ hasText: 'Pedidos recusados arquivados' }).click();
      const archivedRow = managerPage
        .getByTestId('organization-join-request-archived-row')
        .filter({ hasText: applicantEmail });
      await expect(archivedRow).toBeVisible();
      await expect(archivedRow).toContainText(applicantName);
      await expect(archivedRow).toContainText('Arquivado automaticamente após 5 minutos');
      await archivedRow.locator('summary').filter({ hasText: 'Histórico do pedido' }).click();
      await expect(archivedRow.getByText(/^Pedido enviado\b/)).toBeVisible();
      await expect(archivedRow.getByText(/^Pedido recusado\b/)).toBeVisible();

      await managerPage.reload();
      await openModule(managerPage, '/profissionais', 'Profissionais');
      await managerPage.locator('summary').filter({ hasText: 'Pedidos recusados arquivados' }).click();
      const refreshedArchivedRow = managerPage
        .getByTestId('organization-join-request-archived-row')
        .filter({ hasText: applicantEmail });
      await expect(refreshedArchivedRow).toBeVisible();
      await expect(refreshedArchivedRow).toContainText(applicantName);
      await refreshedArchivedRow.locator('summary').filter({ hasText: 'Histórico do pedido' }).click();
      await expect(refreshedArchivedRow.getByText(/^Pedido enviado\b/)).toBeVisible();
      await expect(refreshedArchivedRow.getByText(/^Pedido recusado\b/)).toBeVisible();
    } finally {
      await managerContext.close();
    }
  });

  test('mostra prazo de nova tentativa ao atingir o limite público de pedidos por e-mail', async ({ page }) => {
    const organizationId = '31111111-1111-1111-1111-111111111111';
    await page.route('**/rpc/get_public_organization_name*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify('Salão E2E'),
      }),
    );
    await page.route('**/rest/v1/rpc/request_organization_join', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rate_limited: true, retry_after_seconds: 1800 }),
      }),
    );

    await page.goto(`/solicitar-acesso?organization=${organizationId}`);
    await page.getByLabel('Nome e sobrenome').fill('Profissional teste limite');
    await page.getByLabel('E-mail para receber o convite').fill('limite@example.test');
    await page.getByRole('button', { name: 'Enviar pedido ao gestor', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Muitos pedidos foram enviados recentemente. Aguarde cerca de 30 minutos e tente novamente.',
    );

    await expect(page.getByRole('button', { name: 'Telefone', exact: true })).toHaveCount(0);
  });

  test('permite iniciar cadastro de um novo salão sem convite', async ({ page }) => {
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { name: 'Criar conta do salão', exact: true })).toBeVisible();
    await expect(page.getByLabel('Nome e sobrenome')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });

  test('bloqueia bootstrap direto em modo fechado', async ({ page }) => {
    test.skip(
      !accounts.onboarding ||
        process.env.E2E_PROVISION !== 'true' ||
        !process.env.E2E_SUPABASE_TEST_URL ||
        !process.env.E2E_SUPABASE_TEST_ANON_KEY,
      'The direct RPC check requires the isolated provisioned E2E Supabase project.',
    );
    const account = requireAccount(accounts.onboarding, 'onboarding');
    const supabaseUrl = process.env.E2E_SUPABASE_TEST_URL!.replace(/\/+$/, '');
    const anonKey = process.env.E2E_SUPABASE_TEST_ANON_KEY!;
    const authResponse = await page.request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey },
      data: { email: account.email, password: account.password },
    });
    expect(authResponse.ok()).toBe(true);
    const authSession = await authResponse.json() as { access_token?: string };
    const accessToken = authSession.access_token;
    expect(accessToken).toBeTruthy();
    if (!accessToken) throw new Error('Supabase did not return an E2E access token.');

    const bootstrapResponse = await page.request.post(`${supabaseUrl}/rest/v1/rpc/bootstrap_organization`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      data: {
        p_name: 'Empresa avulsa E2E',
        p_cnpj: '',
        p_address: '',
      },
    });
    expect(bootstrapResponse.ok()).toBe(false);
    const failure = await bootstrapResponse.json() as { message?: string };
    expect(failure.message).toContain('organization creation is disabled for this deployment');
  });

  test('gestor vê todos os módulos e pode abrir configurações', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    for (const label of [
      'Controle Diário',
      'Agenda',
      'Clientes',
      'Profissionais',
      'Produtos & Estoque',
      'Planos & Mensalidades',
      'Financeiro',
      'Configurações',
    ]) {
      await expect(page.getByRole('complementary').getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await openModule(page, '/configuracoes/acesso', 'Configurações');
    await expect(page.getByRole('button', { name: 'Salvar permissões', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Papéis e Acesso', exact: true })).toBeVisible();
  });

  test('o gestor encontra a fila de pedidos de acesso na equipe', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/profissionais', 'Profissionais');
    await expect(page.getByRole('heading', { name: 'Pedidos de acesso', exact: true })).toBeVisible();
  });

  test('gestor vê valores e percentuais corretos em cada período', async ({ page }) => {
    test.skip(
      !accounts.manager || process.env.E2E_PROVISION !== 'true',
      'Requires the provisioned manager account and revenue fixtures.',
    );
    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/dashboard', 'Visão geral');

    const paymentCard = page.getByTestId('payment-method-summary-card');
    await expect(paymentCard).toBeVisible();

    const card = page.getByTestId('professional-revenue-card');
    await expect(card).toBeVisible();

    const expectedByPeriod = {
      Diária: [
        ['Profissional operacional E2E', '110,00', '68,75%'],
        ['Profissional convidado E2E', '50,00', '31,25%'],
      ],
      Semanal: [
        ['Profissional operacional E2E', '610,00', '92,42%'],
        ['Profissional convidado E2E', '50,00', '7,58%'],
      ],
      Mensal: [
        ['Profissional operacional E2E', '610,00', '63,54%'],
        ['Profissional convidado E2E', '350,00', '36,46%'],
      ],
    } as const;

    for (const [label, expectedRows] of Object.entries(expectedByPeriod)) {
      const button = paymentCard.getByRole('button', { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');

      for (const [professional, value, percentage] of expectedRows) {
        const row = card.getByTestId('revenue-professional-row').filter({ hasText: professional });
        await expect(row).toContainText(new RegExp(`R\\$\\s*${value}`));
        await expect(row).toContainText(percentage);
      }
    }
  });

  test('gestor vê o estado vazio quando não há faturamento no período', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    await page.route('**/rest/v1/appointments**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });

    await loginAs(page, requireAccount(accounts.manager, 'manager'));
    await openModule(page, '/dashboard', 'Visão geral');

    const card = page.getByTestId('professional-revenue-card');
    await expect(card.getByText('Nenhum faturamento registrado no período selecionado')).toBeVisible();
    await expect(card.getByTestId('revenue-professional-row')).toHaveCount(0);
  });

  test('profissional operacional acessa sua operação e o Financeiro individual', async ({ page }) => {
    test.skip(!accounts.operational, 'Requires E2E_OPERATIONAL_EMAIL and E2E_OPERATIONAL_PASSWORD.');
    await loginAs(page, requireAccount(accounts.operational, 'operational'));
    await openModule(page, '/dashboard', 'Visão geral');
    await expect(page.getByTestId('payment-method-summary-card')).toHaveCount(0);

    for (const label of ['Controle Diário', 'Agenda']) {
      await expect(page.getByRole('complementary').getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Financeiro', exact: true })).toBeVisible();
    for (const label of ['Profissionais', 'Produtos & Estoque', 'Configurações']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }
    await openModule(page, '/financeiro', 'Financeiro');
    await expect(page.getByRole('region', { name: 'Meus ganhos', exact: true })).toBeVisible();
    await expect(page.getByTestId('finance-plan-receipts')).toHaveCount(0);
    await expect(page.locator('[data-testid^="finance-movement-"]')).toHaveCount(0);
    await openModule(page, '/dashboard', 'Visão geral');
    await page.goto('/produtos');
    await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar Produto', exact: true })).toHaveCount(0);
    await page.goto('/profissionais');
    await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
    await expect(page.getByTestId('invitation-history-row')).toHaveCount(0);
  });

  test('profissional não pode excluir atendimento com mais de 24 horas', async ({ page }) => {
    test.skip(
      !accounts.operational || !receptionAttendance.current || process.env.E2E_PROVISION !== 'true',
      'Requires a provisioned operational profile and disposable attendance fixture.',
    );
    const fixture = receptionAttendance.current!;
    const seededAppointments = await professionalHistoryRequest('appointments', 'GET');
    const oldAttendance = seededAppointments.find(appointment =>
      appointment.professional_id === fixture.professionalId &&
      String(appointment.client).startsWith('Cliente faturamento hoje'),
    );
    expect(oldAttendance?.id).toBeTruthy();

    await loginAs(page, requireAccount(accounts.operational, 'operational'));
    await openModule(page, '/controle', 'Controle Diário');
    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await page.route('**/rest/v1/appointments**', async route => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const appointments = await response.json() as Array<Record<string, unknown>>;
      await route.fulfill({
        response,
        json: appointments.map(appointment => String(appointment.id) === String(oldAttendance!.id)
          ? { ...appointment, attendance_recorded_at: expiredAt }
          : appointment),
      });
    });
    await page.reload();

    const clientName = String(oldAttendance!.client);
    const deleteButton = page.getByRole('button', {
      name: `Excluir atendimento de ${clientName} (prazo de 24 horas encerrado)`,
      exact: true,
    });
    await expect(deleteButton).toBeDisabled();
    await expect(page.getByRole('row').filter({ hasText: clientName })).toBeVisible();
  });

  test('Financeiro restringe cada profissional aos próprios ganhos', async ({ page }) => {
    test.skip(
      !accounts.operational ||
        !accounts.invited ||
        process.env.E2E_PROVISION !== 'true' ||
        !process.env.E2E_SUPABASE_TEST_URL,
      'Requires two provisioned professionals, isolated revenue fixtures, and the E2E Supabase URL.',
    );

    const professionals = await professionalHistoryRequest('professionals', 'GET');
    const professionalIds = new Map(
      professionals.map(professional => [String(professional.name), String(professional.id)]),
    );
    const profiles = [
      {
        account: requireAccount(accounts.operational, 'operational'),
        ownName: 'Profissional operacional E2E',
        otherName: 'Profissional convidado E2E',
        expectsProsthesisCommission: true,
      },
      {
        account: requireAccount(accounts.invited, 'invited'),
        ownName: 'Profissional convidado E2E',
        otherName: 'Profissional operacional E2E',
        expectsProsthesisCommission: false,
      },
    ] as const;

    for (const profile of profiles) {
      const otherProfessionalId = professionalIds.get(profile.otherName);
      expect(otherProfessionalId, `fixture for ${profile.otherName}`).toBeTruthy();
      await loginAs(page, profile.account);

      const earningsRpcs = [
        'get_my_financial_earnings',
        'get_my_plan_usage_earnings',
        'get_my_manual_appointment_commissions',
      ] as const;
      const ownRequestPromises = earningsRpcs.map(rpcName => page.waitForRequest(request =>
        request.url().includes(`/rest/v1/rpc/${rpcName}`) && request.method() === 'POST',
      ));
      const ownResponsePromise = page.waitForResponse(response =>
        response.url().includes('/rest/v1/rpc/get_my_financial_earnings') &&
        response.request().method() === 'POST' && response.ok(),
      );
      await openModule(page, '/financeiro', 'Financeiro');

      const [ownRequests, ownResponse] = await Promise.all([
        Promise.all(ownRequestPromises),
        ownResponsePromise,
      ]);
      const requestHeaders = await ownRequests[0].allHeaders();
      for (const request of ownRequests) {
        const requestBody = request.postDataJSON() as { p_professional_id?: string | null };
        expect(requestBody.p_professional_id ?? null).toBeNull();
      }
      const ownEarnings = await ownResponse.json() as Array<Record<string, unknown>>;
      expect(ownEarnings.length).toBeGreaterThan(0);
      if (profile.expectsProsthesisCommission) {
        expect(ownEarnings.some(earning =>
          earning.source === 'Comissão por aplicação de prótese capilar' &&
          Number(earning.amount) === 140,
        )).toBe(true);
      }

      const personalPanel = page.getByRole('region', { name: 'Meus ganhos', exact: true });
      await expect(personalPanel.getByRole('heading', { name: `Ganhos de ${profile.ownName}`, exact: true })).toBeVisible();
      await expect(personalPanel.getByText('Nenhum ganho registrado neste período.', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('finance-plan-receipts')).toHaveCount(0);
      await expect(page.locator('[data-testid^="finance-movement-"]')).toHaveCount(0);

      const supabaseUrl = process.env.E2E_SUPABASE_TEST_URL!.trim().replace(/\/+$/, '');
      for (const rpcName of earningsRpcs) {
        const otherEarningsResponse = await page.request.post(
          `${supabaseUrl}/rest/v1/rpc/${rpcName}`,
          {
            headers: {
              apikey: requestHeaders.apikey,
              authorization: requestHeaders.authorization,
            },
            data: {
              p_start_date: '2020-01-01',
              p_end_date: '2100-12-31',
              p_professional_id: otherProfessionalId,
            },
          },
        );
        expect(otherEarningsResponse.ok(), `${rpcName} must not return another person's earnings`).toBe(false);
        expect(await otherEarningsResponse.text()).toContain('cannot_request_another_professional_earnings');
      }
    }
  });

  test('recepção acessa somente os módulos autorizados e registra atendimento para o profissional correto', async ({ page }) => {
    const fixture = receptionAttendance.current;
    test.skip(!accounts.reception || !fixture, 'Requires the provisioned receptionist E2E account and attendance fixtures.');
    const reception = requireAccount(accounts.reception, 'reception');
    await loginAs(page, reception);
    await openModule(page, '/dashboard', 'Visão geral');

    const sidebar = page.getByRole('complementary');
    await expect(page.getByTestId('reception-daily-operations')).toBeVisible();
    await expect(page.getByTestId('payment-method-summary-card')).toHaveCount(0);
    await expect(page.getByTestId('reception-daily-operations-error')).toHaveCount(0);
    for (const label of [
      'Controle Diário',
      'Agenda',
      'Clientes',
      'Produtos & Estoque',
      'Planos & Mensalidades',
    ]) {
      await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Profissionais', 'Financeiro', 'Configurações']) {
      await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }

    for (const path of ['/profissionais', '/financeiro', '/configuracoes', '/comunicacao']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
    }
    for (const path of ['/agenda', '/clientes', '/produtos', '/planos']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toHaveCount(0);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main .animate-pulse')).toHaveCount(0, { timeout: 20_000 });
    }

    await openModule(page, '/controle', 'Controle Diário');
    await page.getByTestId('input-attendance-client-name').fill('Cliente recepção E2E');
    await page.getByTestId(`button-select-attendance-client-${fixture!.clientId}`).click();
    await page.getByTestId('select-attendance-professional').selectOption(fixture!.professionalId);
    await page.getByTestId('input-attendance-service-value').fill('50');
    await page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();

    const productSelect = page.locator(`select:has(option[value="${fixture!.productId}"])`);
    await expect(productSelect).toHaveCount(1);
    await productSelect.selectOption(fixture!.productId);
    await productSelect.locator('..').getByRole('spinbutton').fill('2');
    await expect(page.locator('form').getByText(/Comissão/)).toHaveCount(0);

    const stockResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/rpc/adjust_product_stock') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    const clientResponsePromise = page.waitForResponse(response =>
      response.url().includes(`/rest/v1/clients?id=eq.${encodeURIComponent(fixture!.clientId)}`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
    );
    const appointmentResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/appointments') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await page.getByRole('button', { name: /Salvar atendimento/i }).click();

    const [stockResponse, clientResponse, appointmentResponse] = await Promise.all([
      stockResponsePromise,
      clientResponsePromise,
      appointmentResponsePromise,
    ]);
    const stockResult = await stockResponse.json() as { stock?: number } | Array<{ stock?: number }>;
    expect(Array.isArray(stockResult) ? stockResult[0]?.stock : stockResult.stock).toBe(8);
    expect(clientResponse.ok()).toBe(true);

    const savedAppointment = appointmentResponse.request().postDataJSON() as Record<string, unknown>;
    expect(savedAppointment.professional_id).toBe(fixture!.professionalId);
    expect(savedAppointment.client_id).toBe(fixture!.clientId);
    expect(savedAppointment.products).toEqual([{ productId: fixture!.productId, quantity: 2 }]);
    await expect(page.getByRole('heading', { name: 'Atendimentos de hoje', exact: true })).toBeVisible();
    await expect(page.getByText('Cliente recepção E2E')).toBeVisible();
    const recordedReceptionAttendance = page.getByRole('article').filter({ hasText: 'Cliente recepção E2E' });
    await expect(recordedReceptionAttendance).toContainText('Profissional operacional E2E');

    const deleteAttendance = recordedReceptionAttendance.getByRole('button', {
      name: 'Excluir atendimento de Cliente recepção E2E',
      exact: true,
    });
    await expect(deleteAttendance).toBeEnabled();
    const attendanceDeleteResponse = waitForMutation(page, 'appointments', 'DELETE');
    await deleteAttendance.click();
    await page.getByRole('alertdialog').getByRole('button', {
      name: 'Excluir atendimento',
      exact: true,
    }).click();
    await attendanceDeleteResponse;
    await expect(recordedReceptionAttendance).toHaveCount(0);

    await openModule(page, '/clientes', 'Clientes');
    await page.getByPlaceholder('Buscar por nome, email ou whatsapp...').fill('Cliente recepção E2E');
    const deleteClient = page.getByRole('button', {
      name: 'Excluir Cliente recepção E2E',
      exact: true,
    });
    await expect(deleteClient).toBeVisible();
    const clientDeleteResponse = waitForMutation(page, 'clients', 'DELETE');
    await deleteClient.click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir', exact: true }).click();
    await clientDeleteResponse;
    await expect(page.getByText('Cliente recepção E2E', { exact: true })).toHaveCount(0);
  });

  test('papel customizado respeita o módulo permitido e bloqueia o módulo removido', async ({ page }) => {
    test.skip(!accounts.customRole, 'Requires E2E_CUSTOM_ROLE_EMAIL and E2E_CUSTOM_ROLE_PASSWORD.');
    const allowedPath = process.env.E2E_CUSTOM_ALLOWED_PATH || '/agenda';
    const allowedHeading = process.env.E2E_CUSTOM_ALLOWED_HEADING || 'Agenda';
    const deniedPath = process.env.E2E_CUSTOM_DENIED_PATH || '/produtos';
    await loginAs(page, requireAccount(accounts.customRole, 'custom_role'));
    await openModule(page, allowedPath, allowedHeading);
    await page.goto(deniedPath);
    await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
  });
});

test.describe('convites da equipe', () => {
  test('exibe uma página pública de convite e preserva o token nos links', async ({ page }) => {
    const token = invitationTokens.pending;
    test.skip(!token, 'Requires E2E_INVITATION_TOKEN from a pending invitation.');
    await page.goto(`/convite/${encodeURIComponent(token!)}`);
    await expect(page.getByRole('heading', { name: 'Convite para a equipe', exact: true })).toBeVisible();
    await page.getByTestId('button-enter-invited-company').click();
    await expect(page.getByTestId('input-invitation-email')).toHaveValue(/@/);
    await expect(page.getByTestId('link-login-from-invitation')).toHaveAttribute(
      'href',
      new RegExp(`convite=${encodeURIComponent(token!)}`),
    );
  });

  test('cadastro abre somente para um convite válido', async ({ page }) => {
    const token = invitationTokens.pending;
    test.skip(!token, 'Requires E2E_INVITATION_TOKEN from a pending invitation.');
    await page.goto(`/cadastro?convite=${encodeURIComponent(token!)}`);
    await expect(page.getByLabel('Nome e sobrenome')).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });

  test('não aceita um token inexistente mesmo que a URL indique convite por telefone', async ({ page }) => {
    const token = 'convite-telefone-publico-e2e';
    await page.goto(`/convite/${token}?canal=telefone`);

    await expect(page.getByRole('heading', { name: 'Convite não disponível', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar minha conta', exact: true })).toHaveCount(0);
  });

  async function submitInvitationLogin(page: Parameters<typeof loginAs>[0], accountName: 'expired' | 'revoked' | 'invited' | 'manager', token: string) {
    const account = requireAccount(accounts[accountName], accountName);
    await page.goto(`/login?convite=${encodeURIComponent(token)}`);
    await page.getByLabel('E-mail').fill(account.email);
    await page.getByLabel('Senha').fill(account.password);
    const invitationResponse = page.waitForResponse(response =>
      response.url().includes('/rpc/accept_organization_invitation') &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const response = await invitationResponse;
    expect(response.ok()).toBe(false);
  }

  test('recusa convite expirado', async ({ page }) => {
    const token = invitationTokens.expired;
    test.skip(!token || !accounts.expired, 'Requires the provisioned expired-invitation account.');
    await submitInvitationLogin(page, 'expired', token!);
    await expect(page.locator('[role="alert"]').filter({ hasText: 'Este convite expirou' })).toBeVisible();
  });

  test('recusa convite revogado', async ({ page }) => {
    const token = invitationTokens.revoked;
    test.skip(!token || !accounts.revoked, 'Requires the provisioned revoked-invitation account.');
    await submitInvitationLogin(page, 'revoked', token!);
    await expect(page.locator('[role="alert"]').filter({ hasText: 'convite foi revogado' })).toBeVisible();
  });

  test('recusa convite que já foi usado', async ({ page }) => {
    const token = invitationTokens.used;
    test.skip(!token || !accounts.expired, 'Requires the provisioned used-invitation account.');
    await submitInvitationLogin(page, 'expired', token!);
    await expect(page.locator('[role="alert"]').filter({ hasText: 'convite já foi utilizado' })).toBeVisible();
  });

  test('recusa o uso por uma conta com e-mail diferente', async ({ page }) => {
    const token = invitationTokens.emailCheck;
    test.skip(!token || !accounts.manager, 'Requires E2E_EMAIL_CHECK_INVITATION_TOKEN and a manager account.');
    await submitInvitationLogin(page, 'manager', token!);
    await expect(page.locator('[role="alert"]').filter({ hasText: 'e-mail que recebeu este convite' })).toBeVisible();
  });

  test('gestor limpa convites expirados e revogados sem remover aceitos ou pendentes', async ({ page }) => {
    test.skip(
      !accounts.manager ||
        process.env.E2E_PROVISION !== 'true' ||
        process.env.E2E_START_SERVER !== 'true',
      'Requires the isolated, provisioned E2E Supabase project and server.',
    );
    const manager = requireAccount(accounts.manager, 'manager');
    await loginAs(page, manager);
    await openModule(page, '/profissionais', 'Equipe');

    const history = page.locator('section').filter({
      hasText: 'Histórico de convites da equipe',
    });
    const rows = history.getByTestId('invitation-history-row');
    const expired = rows.filter({ hasText: 'Profissional convite expirado E2E' });
    const revoked = rows.filter({ hasText: 'Profissional convite revogado E2E' });
    const accepted = rows.filter({ hasText: 'Profissional convidado E2E' });
    const pending = rows.filter({ hasText: 'Profissional convite pendente E2E' });

    await expect(expired).toContainText('Expirado');
    await expect(revoked).toContainText('Revogado');
    await expect(accepted).toHaveCount(2);
    await expect(accepted.nth(0)).toContainText('Aceito');
    await expect(accepted.nth(1)).toContainText('Aceito');
    await expect(pending).toContainText('Pendente');
    const initialRowCount = await rows.count();
    expect(initialRowCount).toBeGreaterThan(4);

    const cleanupButton = page.getByRole('button', { name: 'Limpar 2', exact: true });
    await expect(cleanupButton).toBeVisible();
    await cleanupButton.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(
      'Serão removidos permanentemente 2 convites expirados ou revogados. Convites aceitos e pendentes serão preservados.',
    );

    const cleanupRpc = '**/rest/v1/rpc/cleanup_historical_organization_invitations';
    await page.route(cleanupRpc, route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'XX000',
          details: null,
          hint: null,
          message: 'Falha simulada da limpeza de convites.',
        }),
      }),
    );
    const failedCleanup = page.waitForResponse(response =>
      response.url().includes('/rpc/cleanup_historical_organization_invitations') &&
      response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: 'Confirmar limpeza', exact: true }).click();
    expect((await failedCleanup).ok()).toBe(false);
    await expect(
      page.getByText(
        'Não foi possível limpar o histórico de convites: Falha simulada da limpeza de convites.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(rows).toHaveCount(initialRowCount);
    await expect(expired).toBeVisible();
    await expect(revoked).toBeVisible();
    await expect(confirmation).toContainText(
      'Serão removidos permanentemente 2 convites expirados ou revogados.',
    );
    await page.unroute(cleanupRpc);

    const successfulCleanup = page.waitForResponse(response =>
      response.url().includes('/rpc/cleanup_historical_organization_invitations') &&
      response.request().method() === 'POST',
    );
    await confirmation.getByRole('button', { name: 'Confirmar limpeza', exact: true }).click();
    const response = await successfulCleanup;
    expect(response.ok()).toBe(true);
    expect(await response.json()).toHaveLength(2);
    await expect(expired).toHaveCount(0);
    await expect(revoked).toHaveCount(0);
    await expect(accepted.nth(0)).toContainText('Aceito');
    await expect(accepted.nth(1)).toContainText('Aceito');
    await expect(pending).toContainText('Pendente');

    await page.reload();
    await openModule(page, '/profissionais', 'Equipe');
    const refreshedHistory = page.locator('section').filter({
      hasText: 'Histórico de convites da equipe',
    });
    const refreshedRows = refreshedHistory.getByTestId('invitation-history-row');
    await expect(
      refreshedRows.filter({ hasText: 'Profissional convite expirado E2E' }),
    ).toHaveCount(0);
    await expect(
      refreshedRows.filter({ hasText: 'Profissional convite revogado E2E' }),
    ).toHaveCount(0);
    const refreshedAccepted = refreshedRows.filter({ hasText: 'Profissional convidado E2E' });
    await expect(refreshedAccepted).toHaveCount(2);
    await expect(refreshedAccepted.nth(0)).toContainText('Aceito');
    await expect(refreshedAccepted.nth(1)).toContainText('Aceito');
    await expect(
      refreshedRows.filter({ hasText: 'Profissional convite pendente E2E' }),
    ).toContainText('Pendente');
    await expect(page.getByRole('button', { name: 'Limpar 2', exact: true })).toHaveCount(0);
  });
});

test.describe('pedidos de acesso à empresa', () => {
  test('pedido público é salvo no salão indicado pelo link', async ({ page }) => {
    const organizationId = getFixtureOrganizationId();
    test.skip(
      process.env.E2E_PROVISION !== 'true' || !organizationId || !accounts.manager,
      'Requires the isolated E2E salon and manager account.',
    );
    const applicantName = 'Profissional com link do salão E2E';
    const applicantEmail = `salon-link-${Date.now()}@example.test`;
    await page.goto(`/solicitar-acesso?organization=${encodeURIComponent(organizationId!)}`);
    await page.getByLabel('Nome e sobrenome').fill(applicantName);
    await page.getByLabel('E-mail para receber o convite').fill(applicantEmail);
    await page.getByRole('button', { name: 'Enviar pedido ao gestor', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Pedido enviado', exact: true })).toBeVisible();

    const browser = page.context().browser();
    if (!browser) throw new Error('Could not create an isolated browser context for the manager.');
    const baseURL = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    if (!baseURL) throw new Error('Could not determine the application URL for the manager context.');
    const managerContext = await browser.newContext({ baseURL });
    try {
      const managerPage = await managerContext.newPage();
      await loginAs(managerPage, requireAccount(accounts.manager, 'manager'));
      await openModule(managerPage, '/profissionais', 'Profissionais');
      const requestRow = managerPage
        .getByTestId('organization-join-request-row')
        .filter({ hasText: applicantEmail });
      await expect(requestRow).toBeVisible();
      await expect(requestRow).toContainText(applicantName);
    } finally {
      await managerContext.close();
    }
  });

  test('mostra no login o link para pedir autorização', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('link', { name: 'Crie sua conta', exact: true }),
    ).toHaveAttribute('href', '/cadastro');
  });

  test('solicitação pública exige um link específico do salão', async ({ page }) => {
    await page.goto('/solicitar-acesso');
    await expect(page).toHaveURL(/\/solicitar-acesso$/);
    await expect(
      page.getByRole('heading', { name: 'Solicitar autorização', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/link específico do salão/)).toBeVisible();
    await expect(page.getByLabel('Nome e sobrenome')).toHaveCount(0);
  });
});
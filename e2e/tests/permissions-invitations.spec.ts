import {
  accounts,
  expect,
  invitationTokens,
  loginAs,
  openModule,
  receptionAttendance,
  requireAccount,
  test,
} from '../fixtures';

test.describe('visibilidade e restrições por papel', () => {
  test('profissional sem conta solicita acesso; gestor aprova e emite convite', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires the provisioned manager account.');
    const manager = requireAccount(accounts.manager, 'manager');
    const applicantEmail = `request-${Date.now()}@example.test`;
    const applicantName = 'Profissional sem conta E2E';

    await page.goto('/solicitar-acesso');
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

    await page.goto('/solicitar-acesso');
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
      await expect(managerPage.getByText('Pedido movido para Arquivados', { exact: true })).toBeVisible();
      await expect(managerPage.getByText('Pedido restaurado para a lista principal', { exact: true })).toBeVisible();

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

    await page.goto('/solicitar-acesso');
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
      await expect(archivedRow.getByText('Pedido enviado', { exact: true })).toBeVisible();
      await expect(archivedRow.getByText('Pedido recusado', { exact: true })).toBeVisible();

      await managerPage.reload();
      await openModule(managerPage, '/profissionais', 'Profissionais');
      await managerPage.locator('summary').filter({ hasText: 'Pedidos recusados arquivados' }).click();
      const refreshedArchivedRow = managerPage
        .getByTestId('organization-join-request-archived-row')
        .filter({ hasText: applicantEmail });
      await expect(refreshedArchivedRow).toBeVisible();
      await expect(refreshedArchivedRow).toContainText(applicantName);
      await refreshedArchivedRow.locator('summary').filter({ hasText: 'Histórico do pedido' }).click();
      await expect(refreshedArchivedRow.getByText('Pedido enviado', { exact: true })).toBeVisible();
      await expect(refreshedArchivedRow.getByText('Pedido recusado', { exact: true })).toBeVisible();
    } finally {
      await managerContext.close();
    }
  });

  test('mostra prazo de nova tentativa ao atingir o limite público e mantém o envio por telefone', async ({ page }) => {
    await page.route('**/rest/v1/rpc/request_organization_join', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rate_limited: true, retry_after_seconds: 1800 }),
      }),
    );

    await page.goto('/solicitar-acesso');
    await page.getByLabel('Nome e sobrenome').fill('Profissional teste limite');
    await page.getByLabel('E-mail para receber o convite').fill('limite@example.test');
    await page.getByRole('button', { name: 'Enviar pedido ao gestor', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Muitos pedidos foram enviados recentemente. Aguarde cerca de 30 minutos e tente novamente.',
    );

    await page.getByRole('button', { name: 'Telefone', exact: true }).click();
    await expect(page.getByLabel('Telefone para receber o convite')).toBeVisible();
    await page.getByLabel('Telefone para receber o convite').fill('+55 11 99999-9999');
    await page.getByRole('button', { name: 'Enviar pedido ao gestor', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Aguarde cerca de 30 minutos');
  });

  test('bloqueia cadastro sem convite', async ({ page }) => {
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { name: 'Cadastro somente por convite', exact: true })).toBeVisible();
    await expect(page.getByLabel('Nome e sobrenome')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Solicitar autorização', exact: true })).toBeVisible();
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
        ['Profissional customizado E2E', '50,00', '31,25%'],
      ],
      Semanal: [
        ['Profissional operacional E2E', '310,00', '86,11%'],
        ['Profissional customizado E2E', '50,00', '13,89%'],
      ],
      Mensal: [
        ['Profissional customizado E2E', '350,00', '53,03%'],
        ['Profissional operacional E2E', '310,00', '46,97%'],
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

  test('profissional operacional vê apenas a operação autorizada e recebe acesso restrito', async ({ page }) => {
    test.skip(!accounts.operational, 'Requires E2E_OPERATIONAL_EMAIL and E2E_OPERATIONAL_PASSWORD.');
    await loginAs(page, requireAccount(accounts.operational, 'operational'));
    await openModule(page, '/dashboard', 'Visão geral');
    await expect(page.getByTestId('payment-method-summary-card')).toHaveCount(0);

    for (const label of ['Controle Diário', 'Agenda']) {
      await expect(page.getByRole('complementary').getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Profissionais', 'Produtos & Estoque', 'Financeiro', 'Configurações']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }
    await page.goto('/produtos');
    await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar Produto', exact: true })).toHaveCount(0);
    await page.goto('/profissionais');
    await expect(page.getByRole('heading', { name: 'Acesso Restrito', exact: true })).toBeVisible();
    await expect(page.getByTestId('invitation-history-row')).toHaveCount(0);
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
    await expect(page.getByRole('link', { name: 'Já tenho uma conta', exact: true })).toHaveAttribute('href', /convite=/);
    await expect(page.getByRole('link', { name: 'Criar minha conta', exact: true })).toHaveAttribute('href', /convite=/);
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
    await expect(accepted.first()).toContainText('Aceito');
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
    await expect(accepted.first()).toContainText('Aceito');
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
    await expect(
      refreshedRows.filter({ hasText: 'Profissional convidado E2E' }).first(),
    ).toContainText('Aceito');
    await expect(
      refreshedRows.filter({ hasText: 'Profissional convite pendente E2E' }),
    ).toContainText('Pendente');
    await expect(page.getByRole('button', { name: 'Limpar 2', exact: true })).toHaveCount(0);
  });
});

test.describe('pedidos de acesso à empresa', () => {
  test('mostra no login o link para pedir autorização', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('link', { name: 'Solicite autorização', exact: true }),
    ).toHaveAttribute('href', '/solicitar-acesso');
  });

  test('permite solicitar acesso sem autenticação', async ({ page }) => {
    await page.goto('/solicitar-acesso');
    await expect(page).toHaveURL(/\/solicitar-acesso$/);
    await expect(
      page.getByRole('heading', { name: 'Solicitar autorização', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Nome e sobrenome')).toBeVisible();
  });
});
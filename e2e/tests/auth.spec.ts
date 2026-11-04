import { accounts, expect, invitationTokens, loginAs, requireAccount, test } from '../fixtures';

async function mockValidInvitation(
  page: Parameters<typeof loginAs>[0],
  channel: 'email' | 'phone',
  overrides: Record<string, unknown> = {},
) {
  await page.route('**/rest/v1/rpc/get_public_organization_invitation_info', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: true,
        status: 'valid',
        channel,
        ...(channel === 'email'
          ? {
              email: 'profissional@example.com',
              organization_name: 'Barbearia Exemplo',
              professional_name: 'Profissional E2E',
            }
          : {}),
        ...overrides,
      }),
    }),
  );
}

test.describe('autenticação e onboarding', () => {
  test('redireciona uma rota protegida para o login quando não há sessão', async ({ page }) => {
    await page.goto('/clientes');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });

  test('o convite mostra a empresa e abre cadastro com e-mail fixo e somente senha', async ({ page }) => {
    const invitationToken = 'convite-fluxo-simples-e2e';
    await mockValidInvitation(page, 'email');
    await page.goto(`/convite/${invitationToken}`);

    await expect(page.getByTestId('text-invitation-company')).toHaveText('Barbearia Exemplo');
    await page.getByRole('button', { name: 'Entrar em Barbearia Exemplo' }).click();
    await expect(page.getByTestId('text-invited-company')).toHaveText('Barbearia Exemplo');
    await expect(page.getByTestId('input-invitation-email')).toHaveValue('profissional@example.com');
    await expect(page.getByTestId('input-invitation-email')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('input-invitation-password')).toBeVisible();
    await expect(page.locator('#signup-name')).toHaveCount(0);
    await expect(page.locator('#signup-confirmation')).toHaveCount(0);
  });

  test('cria a conta pelo convite e preserva o token no retorno de confirmação', async ({ page }) => {
    const invitationToken = 'convite-e2e-token';
    let emailRedirectTo = '';
    let signupPayload: { email?: string; data?: { full_name?: string } } = {};
    await mockValidInvitation(page, 'email', {
      email: 'email-confirmation@example.com',
      professional_name: 'Usuário E2E',
    });
    await page.route('**/auth/v1/signup**', async route => {
      const redirectMatch = route.request().url().match(/[?&]redirect_to=([^&]+)/);
      emailRedirectTo = redirectMatch ? decodeURIComponent(redirectMatch[1]) : '';
      signupPayload = route.request().postDataJSON() as typeof signupPayload;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'e2e-user-email-confirmation',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'email-confirmation@example.com',
            email_confirmed_at: null,
            user_metadata: { full_name: 'Usuário E2E' },
            app_metadata: { provider: 'email', providers: ['email'] },
            identities: [],
          },
          session: null,
        }),
      });
    });

    await page.goto(`/convite/${encodeURIComponent(invitationToken)}`);
    await page.getByRole('button', { name: 'Entrar em Barbearia Exemplo' }).click();
    await page.getByLabel('Crie uma senha').fill('senha-e2e-123');
    await page.getByRole('button', { name: 'Criar conta e entrar' }).click();

    await expect.poll(() => emailRedirectTo).not.toBe('');
    expect(signupPayload.email).toBe('email-confirmation@example.com');
    expect(signupPayload.data?.full_name).toBe('Usuário E2E');
    const pageOrigin = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    expect(emailRedirectTo).toMatch(new RegExp(`^${pageOrigin}/conta-verificada\\?`));
    expect(emailRedirectTo).toContain('confirmacao=email');
    expect(emailRedirectTo).toContain(`convite=${encodeURIComponent(invitationToken)}`);
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    await expect(page.getByText('email-confirmation@example.com')).toBeVisible();
  });

  test('cadastra por telefone e só tenta aceitar o convite após um código SMS válido', async ({ page }) => {
    const invitationToken = 'convite-telefone-e2e';
    let signupPhone = '';
    let invitationAcceptanceCalls = 0;
    await mockValidInvitation(page, 'phone');
    await page.route('**/auth/v1/signup**', async route => {
      const payload = route.request().postDataJSON() as { phone?: string };
      signupPhone = String(payload.phone ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'e2e-phone-user',
            aud: 'authenticated',
            role: 'authenticated',
            phone: signupPhone,
            phone_confirmed_at: null,
            user_metadata: { full_name: 'Profissional SMS' },
            app_metadata: { provider: 'phone', providers: ['phone'] },
            identities: [],
          },
          session: null,
        }),
      });
    });
    await page.route('**/auth/v1/verify**', async route => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 400, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
      });
    });
    await page.route('**/rest/v1/rpc/accept_organization_invitation', async route => {
      invitationAcceptanceCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/cadastro?convite=${invitationToken}&canal=telefone`);
    await page.getByLabel('Nome e sobrenome').fill('Profissional SMS');
    await page.getByLabel('Telefone').fill('(11) 98765-4321');
    await page.locator('#signup-password').fill('senha-e2e-123');
    await page.getByLabel('Confirmar senha').fill('senha-e2e-123');
    await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

    await expect.poll(() => signupPhone).toBe('+5511987654321');
    await expect(page.getByLabel('Código SMS')).toBeVisible();
    await page.getByLabel('Código SMS').fill('123456');
    const verificationResponse = page.waitForResponse(response =>
      response.url().includes('/auth/v1/verify') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Confirmar telefone e aceitar convite' }).click();
    await verificationResponse;
    expect(invitationAcceptanceCalls).toBe(0);
    await expect(page.getByLabel('Código SMS')).toHaveValue('123456');
  });

  test('recupera senha por SMS sem permitir criação de conta', async ({ page }) => {
    const capturedOtp: { payload?: { phone?: string; create_user?: boolean } } = {};
    await page.route('**/auth/v1/otp**', async route => {
      capturedOtp.payload = route.request().postDataJSON() as { phone?: string; create_user?: boolean };
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/esqueci-senha?canal=telefone');
    await page.getByLabel('Telefone da conta').fill('11 98765-4321');
    await page.getByRole('button', { name: 'Enviar código SMS' }).click();

    await expect(page.getByLabel('Código SMS')).toBeVisible();
    expect(capturedOtp.payload?.phone).toBe('+5511987654321');
    expect(capturedOtp.payload?.create_user).toBe(false);
  });

  test('confirma a conta somente após validar o retorno do Supabase e mantém o convite', async ({ page }) => {
    await page.route('**/auth/v1/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'e2e-user-verified',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'verified@example.com',
          email_confirmed_at: '2026-10-14T12:00:00.000Z',
          confirmed_at: '2026-10-14T12:00:00.000Z',
          user_metadata: { full_name: 'Usuário Verificado' },
          app_metadata: { provider: 'email', providers: ['email'] },
          identities: [],
        }),
      });
    });

    const invitationToken = 'convite-verificacao-e2e';
    await page.goto(
      `/conta-verificada?confirmacao=email&convite=${encodeURIComponent(invitationToken)}` +
        '#access_token=e2e-access-token&refresh_token=e2e-refresh-token&expires_in=3600&token_type=bearer&type=signup',
    );

    await expect(page.getByRole('heading', { name: 'Conta verificada', exact: true })).toBeVisible();
    await expect(page.getByText('Você já pode fechar esta aba e voltar ao aplicativo.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continuar para o convite' }))
      .toHaveAttribute('href', `/convite/${invitationToken}`);
  });

  test('mostra orientação para link de confirmação expirado ou inválido', async ({ page }) => {
    await page.goto(
      '/conta-verificada?confirmacao=email&error=access_denied&error_code=otp_expired&error_description=Link+expired',
    );

    await expect(page.getByRole('heading', { name: 'Não foi possível verificar', exact: true })).toBeVisible();
    await expect(page.getByText(/Solicite um novo e-mail de confirmação/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar ao login' })).toHaveAttribute('href', '/login');
  });

  test('oferece recuperação de senha e protege a página de nova senha', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute('href', '/esqueci-senha');
    await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
    await expect(page).toHaveURL(/\/esqueci-senha/);
    await expect(page.getByRole('heading', { name: 'Recuperar acesso' })).toBeVisible();

    await page.goto('/redefinir-senha');
    await expect(page).toHaveURL(/\/redefinir-senha/);
    await expect(page.getByText('Link inválido ou expirado.', { exact: true })).toBeVisible();
  });

  test('shows the login form and rejects invalid credentials', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Beauty Manager' })).toBeVisible();
    await page.getByLabel('E-mail').fill(account.email);
    await page.getByLabel('Senha').fill(`${account.password}-invalid`);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(
      page.locator('[role="alert"]').filter({ hasText: 'E-mail ou senha inválidos.' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('keeps a valid session after reload and logs out', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    await loginAs(page, account);
    await expect(page.getByRole('link', { name: 'Abrir meu perfil' })).toBeVisible();

    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Segurança da conta' })).toBeVisible();
    await expect(page.getByLabel('Nova senha', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirmar nova senha')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('link', { name: 'Abrir meu perfil' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair do sistema', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });

  test('redirects an unlinked session to onboarding without offering company creation', async ({ page }) => {
    test.skip(!accounts.onboarding, 'Requires a dedicated Supabase user without an organization.');
    const account = requireAccount(accounts.onboarding, 'onboarding');
    await loginAs(page, account);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: 'Solicitar acesso à equipe' })).toBeVisible();
    await expect(page.getByLabel('Nome do estabelecimento')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continuar para o pedido', exact: true })).toBeVisible();
  });

  test('preserves an invitation token when navigating to sign in or sign up', async ({ page }) => {
    const token = invitationTokens.pending;
    test.skip(!token, 'Requires E2E_INVITATION_TOKEN from a pending invitation.');
    await page.goto(`/login?convite=${encodeURIComponent(token!)}`);
    await expect(page.getByText(/Convite por e-mail encontrado/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar meu acesso' })).toHaveAttribute('href', `/convite/${encodeURIComponent(token!)}`);
  });

  test('direciona e-mail já cadastrado para login e preserva o convite', async ({ page }) => {
    const invitationToken = 'convite-conta-existente-e2e';
    await mockValidInvitation(page, 'email', { email: 'existente@example.com' });
    await page.route('**/auth/v1/signup**', async route => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'user_already_exists', message: 'User already registered' }),
      });
    });

    await page.goto(`/convite/${encodeURIComponent(invitationToken)}`);
    await page.getByRole('button', { name: 'Entrar em Barbearia Exemplo' }).click();
    await expect(page.getByLabel('E-mail do convite')).toHaveValue('existente@example.com');
    await page.getByLabel('Crie uma senha').fill('senha-e2e-123');
    await page.getByRole('button', { name: 'Criar conta e entrar' }).click();

    await expect(page.getByTestId('alert-invitation-signup')).toContainText('Este e-mail já possui uma conta.');
    await expect(page.getByTestId('link-login-existing-invitation')).toHaveAttribute(
      'href',
      `/login?convite=${encodeURIComponent(invitationToken)}`,
    );
  });

  test('oferece criar o acesso do convite a partir do login', async ({ page }) => {
    const invitationToken = 'convite-login-senha-e2e';
    await page.goto(`/login?convite=${encodeURIComponent(invitationToken)}`);

    await expect(
      page.getByRole('link', { name: 'Criar meu acesso', exact: true }),
    ).toHaveAttribute('href', `/convite/${encodeURIComponent(invitationToken)}`);
  });
});
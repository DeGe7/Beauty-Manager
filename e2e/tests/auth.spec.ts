import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
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

async function mockAvatarProfile(
  page: Parameters<typeof loginAs>[0],
  account: { email: string },
  options: { failUpdate?: boolean } = {},
) {
  let previousAvatarPath = '';
  await page.route('**/rest/v1/profiles?*', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      const authorization = request.headers().authorization || '';
      const encodedClaims = authorization.replace(/^Bearer\s+/i, '').split('.')[1] || '';
      const decoder = globalThis as unknown as { atob(value: string): string };
      const payload = encodedClaims.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(decoder.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { sub?: string };
      const userId = String(claims.sub || '');
      previousAvatarPath = `${userId}/old-avatar.png`;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          id: userId,
          email: account.email,
          full_name: 'Usuário E2E',
          avatar_url: previousAvatarPath,
        },
      });
    }
    if (request.method() === 'PATCH') {
      if (options.failUpdate) {
        return route.fulfill({ status: 500, json: { message: 'profile update failed' } });
      }
      const update = request.postDataJSON() as { avatar_url: string };
      return route.fulfill({ status: 200, json: { avatar_url: update.avatar_url } });
    }
    return route.continue();
  });
  return { previousAvatarPath: () => previousAvatarPath };
}

async function mockAvatarStorage(
  page: Parameters<typeof loginAs>[0],
  options: { failUpload?: boolean; failRemoval?: boolean } = {},
) {
  const removedPaths: string[][] = [];
  const uploadedPaths: string[] = [];
  await page.route('**/object/sign/avatars/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/u5sAAAAASUVORK5CYII=', 'base64'),
    }),
  );
  await page.route('**/storage/v1/object/**', async route => {
    const request = route.request();
    const requestUrl = request.url();
    if (request.method() === 'DELETE' && requestUrl.endsWith('/storage/v1/object/avatars')) {
      const body = request.postDataJSON() as { prefixes: string[] };
      removedPaths.push(body.prefixes);
      if (options.failRemoval) {
        return route.fulfill({ status: 500, json: { message: 'avatar removal failed' } });
      }
      return route.fulfill({ status: 200, json: [] });
    }
    if (request.method() !== 'POST') return route.continue();
    if (requestUrl.includes('/storage/v1/object/sign/avatars/')) {
      const objectPath = decodeURIComponent(requestUrl.split('/storage/v1/object/sign/avatars/')[1].split('?')[0]);
      return route.fulfill({
        status: 200,
        json: { signedURL: `/object/sign/avatars/${objectPath}?token=e2e` },
      });
    }
    if (requestUrl.includes('/storage/v1/object/avatars/')) {
      const objectPath = decodeURIComponent(requestUrl.split('/storage/v1/object/avatars/')[1].split('?')[0]);
      if (options.failUpload) {
        return route.fulfill({ status: 500, json: { message: 'upload failed' } });
      }
      uploadedPaths.push(objectPath);
      return route.fulfill({ status: 200, json: { Key: `avatars/${objectPath}` } });
    }
    return route.continue();
  });
  return { removedPaths, uploadedPaths };
}

async function readStoredSupabaseSession(page: Parameters<typeof loginAs>[0]) {
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
      try {
        const session = JSON.parse(browser.localStorage.getItem(key) || '') as {
          access_token?: unknown;
          user?: { id?: unknown };
        };
        if (typeof session.access_token !== 'string') continue;
        const tokenPayload = session.access_token.split('.')[1];
        if (!tokenPayload) continue;
        const base64 = tokenPayload.replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(
          browser.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
        ) as { sub?: unknown };
        const userId = typeof session.user?.id === 'string' ? session.user.id : claims.sub;
        if (typeof userId === 'string') {
          return { accessToken: session.access_token, userId };
        }
      } catch {
        // Ignore unrelated local-storage entries.
      }
    }
    return null;
  });
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

  test('cria conta de um salão sem convite e solicita confirmação por e-mail', async ({ page }) => {
    let emailRedirectTo = '';
    let signupPayload: { email?: string; data?: { full_name?: string } } = {};
    await page.route('**/auth/v1/signup**', async route => {
      const redirectMatch = route.request().url().match(/[?&]redirect_to=([^&]+)/);
      emailRedirectTo = redirectMatch ? decodeURIComponent(redirectMatch[1]) : '';
      signupPayload = route.request().postDataJSON() as typeof signupPayload;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'e2e-new-salon-owner',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'nova-proprietaria@example.test',
            email_confirmed_at: null,
            user_metadata: { full_name: 'Nova Proprietária' },
            app_metadata: { provider: 'email', providers: ['email'] },
            identities: [],
          },
          session: null,
        }),
      });
    });

    await page.goto('/cadastro');
    await page.getByLabel('Nome e sobrenome').fill('Nova Proprietária');
    await page.getByLabel('E-mail').fill('nova-proprietaria@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('senha-e2e-123');
    await page.getByLabel('Confirmar senha').fill('senha-e2e-123');
    await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

    await expect(page).toHaveURL(/\/login$/);
    expect(signupPayload.email).toBe('nova-proprietaria@example.test');
    expect(signupPayload.data?.full_name).toBe('Nova Proprietária');
    const pageOrigin = page.url().match(/^https?:\/\/[^/]+/)?.[0];
    expect(emailRedirectTo).toBe(`${pageOrigin}/conta-verificada?confirmacao=email`);
  });

  test('convite legado por telefone explica que o novo acesso exige e-mail', async ({ page }) => {
    const invitationToken = 'convite-telefone-legado-e2e';
    await mockValidInvitation(page, 'phone');

    await page.goto(`/cadastro?convite=${encodeURIComponent(invitationToken)}`);

    await expect(page.getByRole('heading', { name: 'Convite não disponível', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(
      'Convites por telefone foram desativados. Peça ao Gestor/Proprietário para gerar um novo convite pelo seu e-mail.',
    );
    await expect(page.getByRole('button', { name: 'Cadastrar', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Código SMS')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ir para o login', exact: true })).toHaveAttribute('href', '/login');
  });

  test('recupera senha por e-mail sem permitir criação de conta', async ({ page }) => {
    let recoveryEmail = '';
    await page.route('**/auth/v1/recover**', async route => {
      const payload = route.request().postDataJSON() as { email?: string };
      recoveryEmail = String(payload.email ?? '');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/esqueci-senha');
    await page.getByLabel('E-mail da conta').fill('recuperacao@example.test');
    await page.getByRole('button', { name: 'Enviar link de recuperação', exact: true }).click();

    await expect.poll(() => recoveryEmail).toBe('recuperacao@example.test');
    await expect(page.getByText(/Se o endereço informado estiver cadastrado, enviaremos um link de recuperação/)).toBeVisible();
    await expect(page.getByLabel('Código SMS')).toHaveCount(0);
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

  test('removes only the previous avatar after the new profile photo is confirmed', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    const profileMock = await mockAvatarProfile(page, account);
    const storageMock = await mockAvatarStorage(page);
    await loginAs(page, account);
    await page.goto('/perfil');

    const photoInput = page.locator('input[type="file"]');
    await expect(photoInput).toHaveAttribute('accept', 'image/*');
    await expect(page.getByText('Todos os formatos de imagem, incluindo GIF · máximo de 2 MB')).toBeVisible();

    await photoInput.setInputFiles('artifacts/barber-manager/public/favicon-32x32.png');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByTestId('photo-save-feedback')).toHaveText('Foto de perfil atualizada.');
    const previousAvatarPath = profileMock.previousAvatarPath();
    expect(previousAvatarPath).toMatch(/^[^/]+\/old-avatar\.png$/);
    await expect.poll(() => storageMock.removedPaths).toEqual([[previousAvatarPath]]);
    expect(storageMock.uploadedPaths).toHaveLength(1);
    expect(storageMock.uploadedPaths[0]).not.toBe(previousAvatarPath);
    await expect(page.getByRole('img', { name: /^Foto de / })).toHaveAttribute(
      'src',
      new RegExp(`/object/sign/avatars/${profileMock.previousAvatarPath().split('/')[0]}/`),
    );
  });

  test('uploads a real GIF to isolated storage and keeps it after reloading the profile', async ({ page }) => {
    const projectUrl = process.env.E2E_SUPABASE_TEST_URL?.trim().replace(/\/+$/, '');
    const anonKey = process.env.E2E_SUPABASE_TEST_ANON_KEY?.trim();
    test.skip(
      process.env.E2E_PROVISION !== 'true' || !projectUrl || !anonKey,
      'Requires a disposable account and the isolated Supabase E2E project.',
    );
    const isolatedProjectUrl = projectUrl || '';
    const isolatedAnonKey = anonKey || '';
    expect(isolatedProjectUrl).not.toBe(
      process.env.E2E_SUPABASE_PRODUCTION_URL?.trim().replace(/\/+$/, ''),
    );

    const account = requireAccount(accounts.manager, 'manager');
    let uploadedPath = '';
    await loginAs(page, account);
    await page.setViewportSize({ width: 390, height: 844 });
    const storedSession = await readStoredSupabaseSession(page);
    expect(storedSession, 'The disposable account session is required for safe test cleanup.')
      .not.toBeNull();
    const accessToken = storedSession?.accessToken || '';
    const userId = storedSession?.userId || '';
    const profileResponse = await page.request.get(
      `${isolatedProjectUrl}/rest/v1/profiles?select=avatar_url&id=eq.${encodeURIComponent(userId)}`,
      {
        headers: {
          apikey: isolatedAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    expect(profileResponse.ok, 'The original test avatar must be readable before replacement.')
      .toBeTruthy();
    const profileRows = await profileResponse.json() as Array<{ avatar_url: string | null }>;
    const originalAvatarUrl = profileRows[0]?.avatar_url ?? null;
    const preservedAvatarRemovals: string[][] = [];
    await page.route('**/storage/v1/object/avatars', async route => {
      if (route.request().method() !== 'DELETE') return route.continue();
      const body = route.request().postDataJSON() as { prefixes?: string[] };
      preservedAvatarRemovals.push(body.prefixes || []);
      return route.fulfill({ status: 200, json: [] });
    });

    try {
      await page.goto('/perfil');
      await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 20_000 });
      const uploadResponse = page.waitForResponse(response =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.includes('/storage/v1/object/avatars/'),
      );
      await page.locator('input[type="file"]').setInputFiles({
        name: 'e2e-avatar.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'),
      });
      await expect(page.getByTestId('photo-save-feedback')).toHaveText('Imagem pronta para salvar.');
      await page.evaluate(() => {
        const browser = globalThis as unknown as {
          Event: new (type: string) => unknown;
          dispatchEvent(event: unknown): boolean;
        };
        browser.dispatchEvent(new browser.Event('focus'));
      });
      const authValidationScreen = page.getByRole('status', { name: 'Validando seu acesso...' });
      await expect(authValidationScreen).toBeVisible();
      await expect(authValidationScreen).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId('photo-save-feedback')).toHaveText('Imagem pronta para salvar.');
      await page.getByRole('button', { name: 'Salvar alterações' }).click();

      const response = await uploadResponse;
      const uploadUrl = new URL(response.url());
      uploadedPath = decodeURIComponent(
        uploadUrl.pathname.split('/storage/v1/object/avatars/')[1] || '',
      );
      expect(uploadedPath).toMatch(/^[^/]+\/[^/]+\.gif$/);
      expect(response.ok(), `GIF storage upload failed (${response.status()}).`).toBeTruthy();

      await expect(page.getByTestId('photo-save-feedback')).toHaveText('Foto de perfil atualizada.');
      await page.reload();
      const savedAvatar = page.getByRole('img', { name: /^Foto de / });
      await expect(savedAvatar).toBeVisible();
      await expect.poll(() => savedAvatar.evaluate(image => (image as unknown as { naturalWidth: number }).naturalWidth))
        .toBeGreaterThan(0);
      const signedAvatarUrl = await savedAvatar.getAttribute('src');
      expect(signedAvatarUrl).toContain(`/object/sign/avatars/${uploadedPath}`);
      const storedImageResponse = await page.request.get(signedAvatarUrl!);
      expect(storedImageResponse.ok()).toBeTruthy();
      expect(storedImageResponse.headers()['content-type']).toContain('image/gif');
    } finally {
      if (storedSession) {
        const restoreProfileResponse = await fetch(
          `${isolatedProjectUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
          {
            method: 'PATCH',
            headers: {
              apikey: isolatedAnonKey,
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ avatar_url: originalAvatarUrl }),
          },
        );
        expect(restoreProfileResponse.ok, 'The original profile avatar must be restored after the test.')
          .toBeTruthy();
      }
      if (uploadedPath) {
        const encodedPath = uploadedPath.split('/').map(encodeURIComponent).join('/');
        const cleanupResponse = await fetch(
          `${isolatedProjectUrl}/storage/v1/object/avatars/${encodedPath}`,
          {
            method: 'DELETE',
            headers: {
              apikey: isolatedAnonKey,
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        expect(cleanupResponse.ok, 'The test GIF must be removed from Supabase Storage.')
          .toBeTruthy();
      }
    }
  });

  test('preserves the current avatar when uploading a replacement fails', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    const profileMock = await mockAvatarProfile(page, account);
    const storageMock = await mockAvatarStorage(page, { failUpload: true });
    await loginAs(page, account);
    await page.goto('/perfil');

    await page.locator('input[type="file"]').setInputFiles('artifacts/barber-manager/public/favicon-32x32.png');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByTestId('photo-save-feedback')).toContainText(/Não foi possível enviar a foto/);
    await expect(page.getByRole('img', { name: /^Foto de / })).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();
    expect(profileMock.previousAvatarPath()).toMatch(/^[^/]+\/old-avatar\.png$/);
    expect(storageMock.removedPaths).toEqual([]);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('img', { name: /^Foto de / })).toHaveAttribute('src', /object\/sign\/avatars\/[^/]+\/old-avatar\.png/);
  });

  test('preserves the current avatar when saving its replacement fails', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    const profileMock = await mockAvatarProfile(page, account, { failUpdate: true });
    const storageMock = await mockAvatarStorage(page);
    await loginAs(page, account);
    await page.goto('/perfil');

    await page.locator('input[type="file"]').setInputFiles('artifacts/barber-manager/public/favicon-32x32.png');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByTestId('photo-save-feedback')).toContainText(/Não foi possível salvar a foto/);
    await expect(page.getByRole('img', { name: /^Foto de / })).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();
    expect(profileMock.previousAvatarPath()).toMatch(/^[^/]+\/old-avatar\.png$/);
    expect(storageMock.removedPaths).toEqual([]);
  });

  test('keeps the saved replacement successful when removing the old avatar fails', async ({ page }) => {
    test.skip(!accounts.manager, 'Requires E2E_MANAGER_EMAIL and E2E_MANAGER_PASSWORD.');
    const account = requireAccount(accounts.manager, 'manager');
    const profileMock = await mockAvatarProfile(page, account);
    const storageMock = await mockAvatarStorage(page, { failRemoval: true });
    await loginAs(page, account);
    await page.goto('/perfil');

    await page.locator('input[type="file"]').setInputFiles('artifacts/barber-manager/public/favicon-32x32.png');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByTestId('photo-save-feedback')).toHaveText('Foto de perfil atualizada.');
    await expect.poll(() => storageMock.removedPaths).toEqual([[profileMock.previousAvatarPath()]]);
    expect(storageMock.uploadedPaths).toHaveLength(1);
    await expect(page.getByRole('img', { name: /^Foto de / })).toHaveAttribute(
      'src',
      new RegExp(`/object/sign/avatars/${profileMock.previousAvatarPath().split('/')[0]}/`),
    );
  });

  test('redirects an unlinked session to access control without offering company or request creation', async ({ page }) => {
    test.skip(!accounts.onboarding, 'Requires a dedicated Supabase user without an organization.');
    const account = requireAccount(accounts.onboarding, 'onboarding');
    await loginAs(page, account);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: 'Acesso controlado', exact: true })).toBeVisible();
    await expect(page.getByLabel('Nome do estabelecimento')).toHaveCount(0);
    await expect(page.getByText('Não é possível criar outro salão com este perfil. Entre por um convite ou peça ao Gestor/Proprietário o link de acesso desta empresa.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite', exact: true })).toBeVisible();
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
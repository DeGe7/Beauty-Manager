import { expect, test } from '../fixtures';

test('visualizar cargos não altera dados, identidade nem a sessão real', async ({ page }) => {
  const writes: string[] = [];
  const user = {
    id: '00000000-0000-4000-8000-000000000175',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'dev-admin@example.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Gestor E2E' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const roles = [
    { id: 'role-gestor', key: 'gestor', label: 'Gestor / Proprietário', description: '', isActive: true, permissions: [] },
    { id: 'role-dev-admin', key: 'dev-admin', label: 'DEV/ADMIN', description: '', isActive: true, permissions: [] },
    { id: 'role-barbeiro', key: 'barbeiro', label: 'Barbeiro', description: '', isActive: true, permissions: ['dashboard', 'agenda', 'controle'] },
    { id: 'role-manicure', key: 'manicure', label: 'Manicure', description: '', isActive: true, permissions: ['dashboard', 'agenda', 'controle'] },
    { id: 'role-vendedor', key: 'vendedor', label: 'Vendedor de Prótese', description: '', isActive: true, permissions: ['dashboard', 'agenda', 'clientes', 'controle'] },
  ];

  await page.route('**/auth/v1/token?grant_type=password', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'role-preview-test-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'role-preview-test-refresh-token',
      user,
    }),
  }));
  await page.route('**/auth/v1/logout*', route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/auth/v1/user*', async route => {
    if (route.request().method() !== 'GET') writes.push(`AUTH ${route.request().method()}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
  });
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    const path = request.url().split('/rest/v1/')[1]?.split(/[?#]/, 1)[0] ?? '';
    const table = path.split('/').pop();
    let body: unknown = [];

    if (request.method() !== 'GET') {
      if (path === 'rpc/current_organization_id') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify('organization-role-preview-test'),
        });
        return;
      }
      if (path === 'rpc/get_my_financial_earnings') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{
            entry_id: 'earning-preview',
            entry_date: '2026-10-20',
            kind: 'commission',
            source: 'Comissão por execução · Barbearia',
            attribution: 'Atendimento',
            amount: 25,
          }]),
        });
        return;
      }
      if (
        path === 'rpc/get_my_plan_usage_earnings' ||
        path === 'rpc/get_my_manual_appointment_commissions'
      ) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      if (
        path === 'rpc/list_professional_account_emails' ||
        path === 'rpc/list_organization_join_request_candidates'
      ) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      writes.push(`${request.method()} /rest/v1/${path}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (table === 'profiles') {
      body = {
        id: user.id,
        email: user.email,
        full_name: 'Gestor E2E',
        avatar_url: null,
        default_organization_id: 'organization-role-preview-test',
      };
    } else if (table === 'organization_members') {
      body = {
        organization_id: 'organization-role-preview-test',
        role: 'dev-admin',
        professional_id: null,
      };
    } else if (table === 'organization_settings') {
      body = { payload: { name: 'Beauty Manager', roles } };
    } else if (table === 'professionals') {
      body = [{
        id: 'professional-preview-barber',
        name: 'Barbeiro E2E',
        role: 'barbeiro',
        initials: 'BE',
        color: '#3b82f6',
        is_active: true,
        commissions: { barbearia: 0.5, manutencao: 0, manicure: 0, protese: 0, mentoria: 0 },
      }];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill('e2e-role-preview');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const roleSelector = page.getByRole('combobox', { name: 'Visualizar como cargo' });
  await expect(roleSelector).toBeVisible();
  const signedInIdentity = page.locator('header a[aria-label="Abrir meu perfil"] span');
  await expect(signedInIdentity).toHaveText('Gestor E2E');
  const mobileNavigation = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(page.getByTestId('dashboard-quick-attendance')).toBeVisible();
  await expect(page.getByTestId('dashboard-quick-agenda')).toBeVisible();
  await expect(mobileNavigation.getByRole('link')).toHaveCount(4);
  for (const [path, description] of [
    ['/agenda', 'Veja os horários do dia e acompanhe o andamento dos atendimentos.'],
    ['/clientes', 'Busque por nome, e-mail ou WhatsApp e consulte o histórico de visitas.'],
    ['/planos', 'Crie planos, vincule assinantes e acompanhe usos e pagamentos.'],
  ]) {
    await page.evaluate(`window.history.pushState(null, '', '${path}'); window.dispatchEvent(new PopStateEvent('popstate'))`);
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  }

  await roleSelector.selectOption('barbeiro');
  await expect(page.getByText(/Visualizando como Barbeiro/)).toBeVisible();
  await expect(signedInIdentity).toHaveText('Gestor E2E');
  await expect(page.getByRole('link', { name: 'Financeiro' })).toBeVisible();
  await expect(mobileNavigation.getByTestId('mobile-nav-link-financeiro')).toBeVisible();
  await expect(mobileNavigation.getByRole('link')).toHaveCount(4);
  await page.getByTestId('button-mobile-nav-more').click();
  const mobileMenu = page.getByRole('dialog', { name: 'Menu de navegação' });
  await expect(mobileMenu.getByRole('heading', { name: 'Atendimento' })).toBeVisible();
  await expect(mobileMenu.getByRole('heading', { name: 'Gestão' })).toBeVisible();
  await expect(mobileMenu.getByRole('link', { name: 'Financeiro' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar menu' }).click();
  await page.evaluate("window.history.pushState(null, '', '/controle'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('heading', { name: '1. Cliente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2. Plano, serviço e profissional' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3. Valores, produtos e pagamento' })).toBeVisible();
  await page.evaluate("window.history.pushState(null, '', '/financeiro'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('heading', { name: 'Ganhos de Barbeiro' })).toBeVisible();
  await expect(page.getByText('Comissão por execução · Barbearia')).toBeVisible();
  await expect(page.getByText('Entradas', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Despesas', { exact: true })).toHaveCount(0);
  await page.evaluate("window.history.pushState(null, '', '/configuracoes/acesso'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('heading', { name: 'Acesso Restrito' })).toBeVisible();

  await roleSelector.selectOption('gestor');
  await page.evaluate("window.history.pushState(null, '', '/configuracoes/acesso'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('heading', { name: 'Papéis e Acesso' })).toBeVisible();
  const readOnlyContent = page.locator('main [inert]');
  await expect(readOnlyContent).toBeVisible();
  const savePermissions = page.getByRole('button', { name: 'Salvar permissões', exact: true });
  await expect(savePermissions).toBeVisible();

  await savePermissions.evaluate(button => {
    button.dispatchEvent(new button.ownerDocument.defaultView!.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
  });
  await page.waitForTimeout(250);
  expect(writes).toEqual([]);

  await page.evaluate("window.history.pushState(null, '', '/perfil'); window.dispatchEvent(new PopStateEvent('popstate'))");
  const editName = page.getByRole('button', { name: 'Editar nome' });
  await editName.evaluate(button => {
    button.dispatchEvent(new button.ownerDocument.defaultView!.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
  });
  const nameInput = page.getByRole('textbox', { name: 'Nome e sobrenome' });
  await expect(nameInput).toBeVisible();
  await nameInput.evaluate(input => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    setter?.call(input, 'Nome alterado no teste');
    input.dispatchEvent(new input.ownerDocument.defaultView!.Event('input', { bubbles: true }));
  });
  await expect(nameInput).toHaveValue('Nome alterado no teste');
  await page.getByRole('button', { name: 'Salvar nome' }).evaluate(button => {
    button.dispatchEvent(new button.ownerDocument.defaultView!.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
  });
  await expect(page.getByText('Não é possível realizar alterações durante a visualização por cargo.')).toBeVisible();
  expect(writes).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 900 });
  await roleSelector.selectOption('');
  await expect(page.getByText(/Visualizando como/)).toHaveCount(0);
  await expect(signedInIdentity).toHaveText('Gestor E2E');
  await expect(page.getByRole('complementary').getByText('DEV/ADMIN', { exact: true })).toBeVisible();
  await page.evaluate("window.history.pushState(null, '', '/configuracoes/acesso'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('heading', { name: 'Papéis e Acesso' })).toBeVisible();

  await roleSelector.selectOption('recepcao');
  await page.getByRole('link', { name: 'Controle Diário', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lançar Despesa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar Despesa', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Financeiro', exact: true })).toHaveCount(0);
  await roleSelector.selectOption('');

  await roleSelector.selectOption('barbeiro');
  await page.getByRole('button', { name: 'Sair do sistema' }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('E-mail').fill(user.email);
  await page.getByLabel('Senha').fill('e2e-role-preview');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(roleSelector).toHaveValue('');
  await expect(signedInIdentity).toHaveText('Gestor E2E');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageAnimationDuration = await page.locator('.page-fade-in').evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).animationDuration);
  const buttonTransitionDuration = await page.locator('button').first().evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(pageAnimationDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(buttonTransitionDuration)).toBeLessThanOrEqual(0.001);

  await page.setViewportSize({ width: 390, height: 844 });
  await roleSelector.selectOption('gestor');
  const bodyOverflowBeforeMenu = await page.locator('body').evaluate(element => element.style.overflow);
  const openMoreOptions = page.getByRole('button', { name: 'Abrir mais opções', exact: true });
  await openMoreOptions.click();
  const mobileMenuPanel = page.locator('.bm-mobile-drawer-panel');
  await expect(mobileMenuPanel).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Menu de navegação' })).toBeVisible();
  expect(Number.parseFloat(await mobileMenuPanel.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.001);
  await expect.poll(() => page.locator('body').evaluate(element => element.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Menu de navegação' })).toBeHidden();
  await expect(openMoreOptions).toBeFocused();
  await expect.poll(() => page.locator('body').evaluate(element => element.style.overflow)).toBe(bodyOverflowBeforeMenu);

  await openMoreOptions.click();
  const reopenedMobileMenu = page.getByRole('dialog', { name: 'Menu de navegação' });
  await reopenedMobileMenu.locator('a[href="/profissionais"]').click();
  await expect(page).toHaveURL(/\/profissionais$/);
  await expect(reopenedMobileMenu).toBeHidden();
  await expect.poll(() => page.locator('body').evaluate(element => element.style.overflow)).toBe(bodyOverflowBeforeMenu);
  await roleSelector.selectOption('');
  await page.evaluate("window.history.pushState(null, '', '/profissionais'); window.dispatchEvent(new PopStateEvent('popstate'))");
  await expect(page.getByRole('button', { name: 'Adicionar Profissional', exact: true })).toBeVisible();

  const addProfessional = page.getByRole('button', { name: 'Adicionar Profissional', exact: true });
  await addProfessional.click();
  const professionalDialog = page.getByRole('dialog');
  await expect(professionalDialog).toBeVisible();
  expect(Number.parseFloat(await professionalDialog.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.001);
  const dialogName = professionalDialog.locator('input[type="text"]').first();
  await dialogName.fill('Profissional temporário E2E');
  const professionalRole = professionalDialog.locator('select');
  await professionalRole.selectOption('manicure');
  await expect(professionalRole).toHaveValue('manicure');
  expect(await professionalDialog.evaluate(element => element.contains(element.ownerDocument.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(professionalDialog).toBeHidden();
  await expect(addProfessional).toBeFocused();

  const deleteProfessional = page.getByRole('button', { name: 'Excluir Barbeiro E2E', exact: true });
  await deleteProfessional.click();
  const deleteAlert = page.getByRole('alertdialog');
  await expect(deleteAlert).toBeVisible();
  expect(Number.parseFloat(await deleteAlert.evaluate(element => element.ownerDocument.defaultView!.getComputedStyle(element).animationDuration))).toBeLessThanOrEqual(0.001);
  expect(await deleteAlert.evaluate(element => element.contains(element.ownerDocument.activeElement))).toBe(true);
  await deleteAlert.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(deleteAlert).toBeHidden();
  await expect(deleteProfessional).toBeFocused();
  expect(writes).toEqual([]);
});

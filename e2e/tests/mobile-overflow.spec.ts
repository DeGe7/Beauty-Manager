import {
  accounts,
  expect,
  loginAs,
  openModule,
  test,
  uniqueName,
  waitForMutation,
  waitForRpcMutation,
} from '../fixtures';

type TestPage = Parameters<typeof loginAs>[0];
type TestLocator = ReturnType<TestPage['locator']>;

async function expectNoHorizontalPageScroll(page: Parameters<typeof loginAs>[0], label: string) {
  const viewport = page.viewportSize();
  expect(viewport, `${label}: a tela deve ter dimensões`).not.toBeNull();
  if (!viewport) return;

  const documentWidth = await page.locator('html').evaluate(
    element => (element as { scrollWidth: number }).scrollWidth,
  );
  const contentDimensions = await page.locator('main > div:nth-child(2)').evaluate(element => {
    const content = element as { clientWidth: number; scrollWidth: number };
    return { width: content.clientWidth, scrollWidth: content.scrollWidth };
  });
  const horizontalScrollAreas = await page.locator('main > div:nth-child(2)').evaluate(element => {
    const content = element as unknown as { querySelectorAll: (selector: string) => ArrayLike<unknown> };
    return Array.from(content.querySelectorAll('*'))
      .filter(candidate => {
        const node = candidate as {
          clientWidth: number;
          scrollWidth: number;
          closest: (selector: string) => unknown;
          ownerDocument: {
            defaultView: {
              getComputedStyle: (element: unknown) => { overflowX: string };
            } | null;
          };
        };
        const overflowX = node.ownerDocument.defaultView?.getComputedStyle(node).overflowX;
        const isHorizontallyScrollable = overflowX === 'auto' || overflowX === 'scroll';
        return isHorizontallyScrollable &&
          node.scrollWidth > node.clientWidth + 1 &&
          !node.closest('nav[aria-label]');
      })
      .map(candidate => {
        const node = candidate as { tagName: string; className: string };
        return { tag: node.tagName, className: node.className };
      });
  });

  expect(documentWidth, `${label}: largura do documento`).toBeLessThanOrEqual(viewport.width);
  expect(
    contentDimensions.scrollWidth,
    `${label}: rolagem horizontal na área de conteúdo principal`,
  ).toBeLessThanOrEqual(contentDimensions.width);
  expect(
    horizontalScrollAreas,
    `${label}: rolagem horizontal somente em navegação identificada`,
  ).toEqual([]);
}

async function expectDialogWithinViewport(
  page: Parameters<typeof loginAs>[0],
  dialog: ReturnType<typeof page.getByRole>,
  label: string,
) {
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();

  expect(bounds, `${label}: o diálogo deve ter dimensões`).not.toBeNull();
  expect(viewport, `${label}: a tela deve ter dimensões`).not.toBeNull();
  if (!bounds || !viewport) return;

  expect(bounds.x, `${label}: margem esquerda`).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width, `${label}: margem direita`).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y, `${label}: margem superior`).toBeGreaterThanOrEqual(-1);
  expect(bounds.y + bounds.height, `${label}: margem inferior`).toBeLessThanOrEqual(viewport.height + 1);
  const contentWidth = await dialog.evaluate(element => {
    const content = element as { clientWidth: number; scrollWidth: number };
    return { width: content.clientWidth, scrollWidth: content.scrollWidth };
  });
  expect(
    contentWidth.scrollWidth,
    `${label}: o conteúdo do diálogo não ultrapassa sua largura`,
  ).toBeLessThanOrEqual(contentWidth.width + 1);
}

async function expectDialogStateWithinViewport(
  page: Parameters<typeof loginAs>[0],
  dialog: ReturnType<typeof page.getByRole>,
  label: string,
) {
  await expectDialogWithinViewport(page, dialog, label);
  await expectNoHorizontalPageScroll(page, label);
}

async function expectFormWithinViewport(
  page: Parameters<typeof loginAs>[0],
  form: TestLocator,
  label: string,
) {
  await expect(form, `${label}: formulário visível`).toBeVisible();
  const bounds = await form.boundingBox();
  const viewport = page.viewportSize();

  expect(bounds, `${label}: formulário com dimensões`).not.toBeNull();
  expect(viewport, `${label}: a tela deve ter dimensões`).not.toBeNull();
  if (!bounds || !viewport) return;

  expect(bounds.x, `${label}: formulário dentro da tela à esquerda`).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width, `${label}: formulário dentro da tela à direita`).toBeLessThanOrEqual(viewport.width + 1);
  const width = await form.evaluate(element => {
    const content = element as { clientWidth: number; scrollWidth: number };
    return { width: content.clientWidth, scrollWidth: content.scrollWidth };
  });
  expect(width.scrollWidth, `${label}: conteúdo do formulário sem largura extra`)
    .toBeLessThanOrEqual(width.width + 1);
}

async function expectCardTextReadable(
  card: TestLocator,
  text: TestLocator,
  label: string,
  blockers: TestLocator[] = [],
) {
  const cardBounds = await card.boundingBox();
  expect(cardBounds, `${label}: cartão com dimensões`).not.toBeNull();
  if (!cardBounds) return;

  await expect(text, `${label}: texto visível`).toBeVisible();
  const textLayout = await text.evaluate(element => {
    const textElement = element as unknown as {
      clientWidth: number;
      scrollWidth: number;
      clientHeight: number;
      scrollHeight: number;
      ownerDocument: {
        createRange: () => {
          selectNodeContents: (node: unknown) => void;
          getClientRects: () => ArrayLike<{ left: number; right: number; top: number; bottom: number }>;
        };
      };
    };
    const range = textElement.ownerDocument.createRange();
    range.selectNodeContents(textElement);
    const rects = range.getClientRects();
    return {
      clientWidth: textElement.clientWidth,
      scrollWidth: textElement.scrollWidth,
      clientHeight: textElement.clientHeight,
      scrollHeight: textElement.scrollHeight,
      textRects: Array.from({ length: rects.length }, (_, index) => {
        const rect = rects[index];
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    };
  });

  expect(textLayout.textRects.length, `${label}: o texto tem linhas renderizadas`).toBeGreaterThan(0);
  expect(textLayout.scrollWidth, `${label}: sem corte horizontal do texto`).toBeLessThanOrEqual(textLayout.clientWidth + 1);
  expect(textLayout.scrollHeight, `${label}: sem corte vertical do texto`).toBeLessThanOrEqual(textLayout.clientHeight + 1);
  for (const line of textLayout.textRects) {
    expect(line.left, `${label}: texto dentro do cartão à esquerda`).toBeGreaterThanOrEqual(cardBounds.x - 1);
    expect(line.right, `${label}: texto dentro do cartão à direita`).toBeLessThanOrEqual(cardBounds.x + cardBounds.width + 1);
    expect(line.top, `${label}: texto dentro do cartão no topo`).toBeGreaterThanOrEqual(cardBounds.y - 1);
    expect(line.bottom, `${label}: texto dentro do cartão na base`).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
  }

  for (const blocker of blockers) {
    await expect(blocker, `${label}: controle visível`).toBeVisible();
    const blockerBounds = await blocker.boundingBox();
    expect(blockerBounds, `${label}: controle com dimensões`).not.toBeNull();
    if (!blockerBounds) continue;

    expect(blockerBounds.x, `${label}: controle dentro do cartão à esquerda`).toBeGreaterThanOrEqual(cardBounds.x - 1);
    expect(blockerBounds.x + blockerBounds.width, `${label}: controle dentro do cartão à direita`).toBeLessThanOrEqual(cardBounds.x + cardBounds.width + 1);
    expect(blockerBounds.y, `${label}: controle dentro do cartão no topo`).toBeGreaterThanOrEqual(cardBounds.y - 1);
    expect(blockerBounds.y + blockerBounds.height, `${label}: controle dentro do cartão na base`).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
    for (const line of textLayout.textRects) {
      const overlaps = line.left < blockerBounds.x + blockerBounds.width &&
        line.right > blockerBounds.x &&
        line.top < blockerBounds.y + blockerBounds.height &&
        line.bottom > blockerBounds.y;
      expect(overlaps, `${label}: texto não cobre nem cruza um controle`).toBe(false);
    }
  }
}

async function expectControlsInsideCard(card: TestLocator, controls: TestLocator[], label: string) {
  const cardBounds = await card.boundingBox();
  expect(cardBounds, `${label}: cartão com dimensões`).not.toBeNull();
  if (!cardBounds) return;

  for (const control of controls) {
    await expect(control, `${label}: ação acessível`).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds, `${label}: ação com dimensões`).not.toBeNull();
    if (!bounds) continue;
    expect(bounds.x, `${label}: ação dentro do cartão à esquerda`).toBeGreaterThanOrEqual(cardBounds.x - 1);
    expect(bounds.x + bounds.width, `${label}: ação dentro do cartão à direita`).toBeLessThanOrEqual(cardBounds.x + cardBounds.width + 1);
    expect(bounds.y, `${label}: ação dentro do cartão no topo`).toBeGreaterThanOrEqual(cardBounds.y - 1);
    expect(bounds.y + bounds.height, `${label}: ação dentro do cartão na base`).toBeLessThanOrEqual(cardBounds.y + cardBounds.height + 1);
  }
}

test.describe('textos e ações nos cartões de celular', () => {
  for (const width of [320, 360, 390, 402]) {
    test(`quebra nomes e descrições sem esconder ações em ${width}px`, async ({ page }) => {
      if (!accounts.manager) {
        test.skip(true, 'Requires an E2E manager account or E2E provisioning.');
        return;
      }

      await page.setViewportSize({ width, height: 640 });
      await loginAs(page, accounts.manager);

      const longWord = 'NomeSemEspacosQuePrecisaQuebrar'.repeat(3);

      await openModule(page, '/clientes', 'Clientes');
      await expectNoHorizontalPageScroll(page, `${width}px /clientes`);
      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const clientDialog = page.getByRole('dialog');
      await expectDialogStateWithinViewport(page, clientDialog, `${width}px /clientes com formulário aberto`);
      const clientName = uniqueName(`Cliente nome longo ${longWord}`);
      const clientPhone = `119${Date.now().toString().slice(-8)}`;
      await clientDialog.locator('input').nth(0).fill(clientName);
      await clientDialog.locator('input').nth(1).fill(clientPhone);
      const createClient = waitForRpcMutation(page, 'create_or_get_client_by_phone');
      await clientDialog.getByRole('button', { name: 'Salvar Cliente', exact: true }).click();
      await createClient;

      const clientCard = page.locator('[data-testid^="mobile-client-card-"]').filter({ hasText: clientName });
      await expect(clientCard).toBeVisible();
      const clientProfileButton = clientCard.getByRole('button', { name: `Ver ficha de ${clientName}`, exact: true });
      const clientEditButton = clientCard.getByRole('button', { name: `Editar ${clientName}`, exact: true });
      const clientDeleteButton = clientCard.getByRole('button', { name: `Excluir ${clientName}`, exact: true });
      await expectCardTextReadable(
        clientCard,
        clientCard.getByTestId(/mobile-client-name-/),
        `${width}px cliente: nome`,
        [clientProfileButton, clientEditButton, clientDeleteButton],
      );

      await clientProfileButton.click();
      const clientProfile = page.getByRole('dialog');
      await expectDialogStateWithinViewport(page, clientProfile, `${width}px /clientes com ficha aberta`);
      const visitDescription = `Descrição do atendimento ${longWord} com detalhes completos para leitura no celular`;
      const visitForm = clientProfile.locator('form').filter({ hasText: 'Salvar visita' });
      await expectFormWithinViewport(page, visitForm, `${width}px /clientes com formulário de visita`);
      await visitForm.locator('input[type="text"]').fill(visitDescription);
      await expectDialogStateWithinViewport(page, clientProfile, `${width}px /clientes com formulário de visita preenchido`);
      const saveVisit = waitForMutation(page, 'clients', 'PATCH');
      await visitForm.getByRole('button', { name: 'Salvar visita', exact: true }).click();
      await saveVisit;
      const visitCard = page.locator('[data-testid^="mobile-client-visit-"]').filter({ hasText: visitDescription });
      await expect(visitCard).toBeVisible();
      await expectCardTextReadable(
        visitCard,
        visitCard.getByTestId(/mobile-client-visit-description-/),
        `${width}px cliente: descrição do histórico`,
        [visitCard.getByRole('button', { name: 'Remover visita', exact: true })],
      );
      await page.keyboard.press('Escape');
      await expect(clientProfile).toBeHidden();
      await clientDeleteButton.click();
      const clientDeleteDialog = page.getByRole('alertdialog');
      await expectDialogStateWithinViewport(page, clientDeleteDialog, `${width}px /clientes com confirmação de exclusão`);
      const deleteClient = waitForMutation(page, 'clients', 'DELETE');
      await clientDeleteDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
      await deleteClient;
      await expect(clientCard).toHaveCount(0);

      await openModule(page, '/produtos', 'Produtos & Estoque');
      await expectNoHorizontalPageScroll(page, `${width}px /produtos`);
      await page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();

      const productName = uniqueName(`Produto de nome longo ${longWord}`);
      const productDescription = `Categoria de descrição longa ${longWord} para o cartão`;
      const productForm = page.locator('form').filter({ hasText: 'Salvar Produto' });
      await expectFormWithinViewport(page, productForm, `${width}px /produtos com formulário aberto`);
      await expectNoHorizontalPageScroll(page, `${width}px /produtos com formulário aberto`);
      const productInputs = productForm.locator('input');
      await productInputs.nth(0).fill(productName);
      await productInputs.nth(1).fill(productDescription);
      await productInputs.nth(2).fill('20');
      await productInputs.nth(3).fill('10');
      await productInputs.nth(4).fill('3');
      await productInputs.nth(5).fill('1');
      const createProduct = waitForMutation(page, 'products', 'POST');
      await productForm.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
      await createProduct;
      const productCard = page.locator('[data-testid^="mobile-product-card-"]').filter({ hasText: productName });
      await expect(productCard).toBeVisible();
      const productActions = [
        productCard.getByRole('button', { name: `Repor estoque de ${productName}`, exact: true }),
        productCard.getByRole('button', { name: `Editar ${productName}`, exact: true }),
        productCard.getByRole('button', { name: `Excluir ${productName}`, exact: true }),
      ];
      const productStock = productCard.getByText('3 un.', { exact: true });
      await expectCardTextReadable(
        productCard,
        productCard.getByTestId(/mobile-product-name-/),
        `${width}px produto: nome`,
        [productStock],
      );
      await expectCardTextReadable(
        productCard,
        productCard.getByTestId(/mobile-product-category-/),
        `${width}px produto: descrição`,
        [productStock],
      );
      await expectControlsInsideCard(productCard, productActions, `${width}px produto`);

      await productActions[2].click();
      const productDeleteDialog = page.getByRole('alertdialog');
      await expectDialogWithinViewport(page, productDeleteDialog, `${width}px /produtos`);
      await expectNoHorizontalPageScroll(page, `${width}px /produtos com diálogo aberto`);
      const deleteProduct = waitForMutation(page, 'products', 'DELETE');
      await productDeleteDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
      await deleteProduct;
      await expect(productCard).toHaveCount(0);

      await openModule(page, '/planos', 'Planos Disponíveis');
      await expectNoHorizontalPageScroll(page, `${width}px /planos`);
      await page.getByRole('button', { name: 'Novo Plano', exact: true }).click();
      const planDialog = page.getByRole('dialog');
      await expectDialogStateWithinViewport(page, planDialog, `${width}px /planos com formulário aberto`);
      const planName = uniqueName(`Plano com nome longo ${longWord}`);
      const planInputs = planDialog.locator('input');
      await planInputs.nth(0).fill(planName);
      await planInputs.nth(1).fill('99');
      await planDialog.getByTestId('plan-service-select-0').selectOption({ index: 1 });
      await planDialog.getByTestId('plan-service-uses-0').fill('1');
      await planDialog.getByTestId('plan-salon-share-percent').fill('50');
      const createPlan = waitForMutation(page, 'subscription_plans', 'POST');
      await planDialog.getByRole('button', { name: 'Salvar Plano', exact: true }).click();
      await createPlan;
      await expect(planDialog).toBeHidden();
      const planCard = page.locator('[data-testid^="mobile-plan-card-"]').filter({ hasText: planName });
      await expect(planCard).toBeVisible();
      const planEditButton = planCard.getByRole('button', { name: `Editar plano ${planName}`, exact: true });
      const planDeleteButton = planCard.getByRole('button', { name: `Excluir plano ${planName}`, exact: true });
      await expectCardTextReadable(
        planCard,
        planCard.getByTestId(/mobile-plan-name-/),
        `${width}px plano: nome`,
        [planEditButton, planDeleteButton],
      );
      await expectCardTextReadable(
        planCard,
        planCard.getByTestId(/mobile-plan-service-/),
        `${width}px plano: descrição`,
        [planEditButton, planDeleteButton],
      );

      const subscriberName = uniqueName(`Assinante com nome longo ${longWord}`);
      await page.getByRole('button', { name: 'Adicionar Assinante', exact: true }).click();
      const subscriberDialog = page.getByRole('dialog');
      await expectDialogStateWithinViewport(page, subscriberDialog, `${width}px /planos com formulário de assinante`);
      const subscriberForm = subscriberDialog.locator('form');
      await expectFormWithinViewport(page, subscriberForm, `${width}px /planos com formulário de assinante`);
      await subscriberDialog.locator('input').nth(0).fill(subscriberName);
      await subscriberDialog.locator('input').nth(1).fill('11955554444');
      await subscriberDialog.locator('select').nth(0).selectOption({ label: planName });
      await subscriberDialog.locator('select').nth(1).selectOption({ index: 1 });
      const createSubscriber = waitForMutation(page, 'subscribers', 'POST');
      await subscriberDialog.getByRole('button', { name: 'Salvar Assinante', exact: true }).click();
      await createSubscriber;

      await page.getByRole('combobox', { name: 'Período dos avisos de vencimento' }).selectOption('all');
      const noticeCard = page.locator('[data-testid^="card-subscription-notice-"]').filter({ hasText: subscriberName });
      await expect(noticeCard).toBeVisible();
      await expectNoHorizontalPageScroll(page, `${width}px /planos com aviso de vencimento`);
      const whatsappButton = noticeCard.getByTestId(/button-subscription-notice-whatsapp-/);
      await expectCardTextReadable(
        noticeCard,
        noticeCard.getByTestId(/text-subscription-notice-name-/),
        `${width}px aviso de vencimento: nome do assinante`,
        [whatsappButton],
      );
      await expectCardTextReadable(
        noticeCard,
        noticeCard.getByTestId(/text-subscription-notice-plan-/),
        `${width}px aviso de vencimento: nome do plano`,
        [whatsappButton],
      );

      await page.getByRole('button', { name: `Excluir assinante ${subscriberName}`, exact: true }).click();
      const subscriberDeleteDialog = page.getByRole('alertdialog');
      await expectDialogStateWithinViewport(page, subscriberDeleteDialog, `${width}px /planos com confirmação de exclusão de assinante`);
      const deleteSubscriber = waitForMutation(page, 'subscribers', 'DELETE');
      await subscriberDeleteDialog.getByRole('button', { name: 'Excluir', exact: true }).click();
      await deleteSubscriber;

      const deletePlan = waitForMutation(page, 'subscription_plans', 'DELETE');
      await planDeleteButton.click();
      const planDeleteDialog = page.getByRole('alertdialog');
      await expectDialogStateWithinViewport(page, planDeleteDialog, `${width}px /planos com confirmação de exclusão`);
      await deletePlan;
      await expect(planCard).toHaveCount(0);
    });
  }
});

test.describe('nomes longos nas abas de clientes no celular', () => {
  for (const width of [320, 360, 390, 402]) {
    test(`mantém nomes e ações legíveis nas abas filtradas em ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      if (!accounts.manager) {
        test.skip(true, 'Requires an E2E manager account or E2E provisioning.');
        return;
      }

      await page.setViewportSize({ width, height: 640 });
      await loginAs(page, accounts.manager);
      await openModule(page, '/clientes', 'Clientes');
      await expectNoHorizontalPageScroll(page, `${width}px /clientes`);

      const longWord = 'NomeSemEspacosQuePrecisaQuebrar'.repeat(3);
      const clientName = uniqueName(`Cliente aniversário ${longWord}`);
      const clientPhone = `119${Date.now().toString().slice(-8)}`;
      const now = new Date();
      const birthday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const lastVisit = new Date(now);
      lastVisit.setDate(lastVisit.getDate() - 60);
      const oldVisitDate = `${lastVisit.getFullYear()}-${String(lastVisit.getMonth() + 1).padStart(2, '0')}-${String(lastVisit.getDate()).padStart(2, '0')}`;

      await page.getByRole('button', { name: 'Novo Cliente', exact: true }).click();
      const clientDialog = page.getByRole('dialog');
      await clientDialog.locator('input').nth(0).fill(clientName);
      await clientDialog.locator('input').nth(1).fill(clientPhone);
      await clientDialog.locator('input').nth(2).fill(birthday);
      const createClient = waitForRpcMutation(page, 'create_or_get_client_by_phone');
      await clientDialog.getByRole('button', { name: 'Salvar Cliente', exact: true }).click();
      await createClient;

      const clientCard = page.locator('[data-testid^="mobile-client-card-"]').filter({ hasText: clientName });
      await expect(clientCard).toBeVisible();
      await clientCard.getByRole('button', { name: `Ver ficha de ${clientName}`, exact: true }).click();
      const profileDialog = page.getByRole('dialog');
      const visitForm = profileDialog.locator('form').filter({ hasText: 'Salvar visita' });
      await visitForm.locator('input[type="date"]').fill(oldVisitDate);
      await visitForm.locator('input[type="text"]').fill(`Visita antiga ${clientName}`);
      await visitForm.locator('input[type="number"]').fill('0');
      const addOldVisit = waitForMutation(page, 'clients', 'PATCH');
      await visitForm.getByRole('button', { name: 'Salvar visita', exact: true }).click();
      await addOldVisit;
      await page.keyboard.press('Escape');
      await expect(profileDialog).toBeHidden();

      await page.getByRole('button', { name: 'Aniversariantes', exact: true }).click();
      await expectNoHorizontalPageScroll(page, `${width}px /clientes / Aniversariantes`);
      const birthdayCard = page.locator('[data-testid^="birthday-client-card-"]').filter({ hasText: clientName });
      const birthdayAction = birthdayCard.getByRole('button', { name: 'Enviar Parabéns', exact: true });
      await expectCardTextReadable(
        birthdayCard,
        birthdayCard.getByTestId(/birthday-client-name-/),
        `${width}px aniversariantes: nome`,
        [birthdayAction],
      );

      await page.getByRole('button', { name: 'Inativos', exact: true }).click();
      await expectNoHorizontalPageScroll(page, `${width}px /clientes / Inativos`);
      const inactiveCard = page.locator('[data-testid^="inactive-client-card-"]').filter({ hasText: clientName });
      const inactiveAction = inactiveCard.getByRole('button', { name: `Reativar contato com ${clientName}`, exact: true });
      await expectCardTextReadable(
        inactiveCard,
        inactiveCard.getByTestId(/inactive-client-name-/),
        `${width}px inativos: nome`,
        [inactiveAction],
      );
    });
  }
});

test.describe('formulários principais em janelas de celular', () => {
  for (const width of [320, 360, 390, 402]) {
    test(`mantém controle, agenda e profissionais dentro da tela em ${width}px`, async ({ page }) => {
      test.setTimeout(90_000);
      if (!accounts.manager) {
        test.skip(true, 'Requires an E2E manager account or E2E provisioning.');
        return;
      }

      await page.setViewportSize({ width, height: 640 });
      await loginAs(page, accounts.manager);

      await openModule(page, '/controle', 'Controle Diário');
      await expect(page.getByTestId('attendance-submit-bar'))
        .toHaveCSS('position', 'static');

      await openModule(page, '/agenda', 'Agenda');
      for (const [buttonName, formName] of [
        ['Novo Agendamento', 'Agendamento'],
        ['Bloquear Horário', 'Bloquear Horário'],
      ]) {
        await page.getByRole('button', { name: buttonName, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expectDialogStateWithinViewport(page, dialog, `${width}px /agenda: ${formName}`);
        await expectFormWithinViewport(page, dialog.locator('form'), `${width}px /agenda: ${formName}`);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }

      await openModule(page, '/profissionais', 'Profissionais');
      await page.getByRole('button', { name: 'Adicionar Profissional', exact: true }).click();
      const professionalDialog = page.getByRole('dialog');
      await expectDialogStateWithinViewport(page, professionalDialog, `${width}px /profissionais: novo profissional`);
      await expectFormWithinViewport(
        page,
        professionalDialog.locator('form').first(),
        `${width}px /profissionais: novo profissional`,
      );
    });
  }
});

test.describe('rolagem horizontal nas demais telas autenticadas', () => {
  const excludedRoutes = new Set(['/clientes', '/produtos', '/planos']);

  for (const width of [320, 360, 390, 402]) {
    test(`mantém as rotas acessíveis dentro da tela em ${width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      if (!accounts.manager) {
        test.skip(true, 'Requires an E2E manager account or E2E provisioning.');
        return;
      }

      await page.setViewportSize({ width, height: 640 });
      await loginAs(page, accounts.manager);

      await page.getByRole('button', { name: 'Abrir mais opções', exact: true }).click();
      const mobileMenu = page.getByRole('dialog', { name: 'Menu de navegação' });
      await expectDialogStateWithinViewport(page, mobileMenu, `${width}px menu móvel aberto`);
      const routes = new Map<string, string>(
        await mobileMenu.getByRole('link').evaluateAll(links =>
          links.map(link => {
            const anchor = link as { getAttribute: (name: string) => string | null; innerText: string };
            return [anchor.getAttribute('href') || '', anchor.innerText.trim()] as [string, string];
          }),
        ),
      );
      await page.getByRole('button', { name: 'Fechar menu', exact: true }).click();

      const profilePath = await page
        .getByRole('link', { name: 'Abrir meu perfil', exact: true })
        .getAttribute('href');
      if (profilePath) routes.set(profilePath, 'Meu Perfil');

      // Collect nested settings sections only when this account's menu grants access.
      if (routes.has('/configuracoes')) {
        await page.goto('/configuracoes');
        await expect(page.locator('main > header h1')).toHaveText('Configurações');
        const settingsNavigation = page.locator('nav[aria-label="Seções de configurações"]');
        await expect(settingsNavigation).toBeVisible();
        const settingsRoutes = await page
          .locator('nav[aria-label="Seções de configurações"] a')
          .evaluateAll(links =>
            links.map(link => {
              const anchor = link as { getAttribute: (name: string) => string | null; innerText: string };
              return [anchor.getAttribute('href') || '', anchor.innerText.trim()] as [string, string];
            }),
          );
        for (const [path, label] of settingsRoutes) routes.set(path, label);
      }

      const accessibleRoutes = [...routes.entries()]
        .filter(([path]) => path && !excludedRoutes.has(path))
        .sort(([left], [right]) => left.localeCompare(right));
      expect(accessibleRoutes.length, 'rotas autenticadas restantes para verificar').toBeGreaterThan(0);

      for (const [path, label] of accessibleRoutes) {
        await page.goto(path);
        const pageHeading = page.locator('main > header h1');
        await expect(pageHeading, `${width}px ${path}: rota aberta`).toBeVisible();
        await expect(pageHeading, `${width}px ${path}: título da tela`).not.toHaveText('');
        await expect(page.getByText('Acesso Restrito', { exact: true }), `${width}px ${path}: rota permitida`)
          .toHaveCount(0);
        await expect(page.locator('main .animate-pulse'), `${width}px ${path}: carregamento concluído`)
          .toHaveCount(0, { timeout: 20_000 });
        await expectNoHorizontalPageScroll(page, `${width}px ${path} (${label})`);
      }
    });
  }

  const restrictedRoleCases = [
    {
      role: 'recepção',
      account: () => accounts.reception,
      forbiddenRoutes: ['/profissionais', '/financeiro', '/configuracoes', '/comunicacao'],
    },
    {
      role: 'conta operacional',
      account: () => accounts.operational,
      forbiddenRoutes: ['/clientes', '/profissionais', '/produtos', '/planos', '/configuracoes', '/comunicacao'],
    },
  ];

  for (const roleCase of restrictedRoleCases) {
    for (const width of [320, 360]) {
      test(`${roleCase.role}: verifica somente as telas do menu em ${width}px`, async ({ page }) => {
        test.setTimeout(180_000);
        const account = roleCase.account();
        if (!account) {
          test.skip(true, `Requires the E2E ${roleCase.role} account or E2E provisioning.`);
          return;
        }

        await page.setViewportSize({ width, height: 640 });
        await loginAs(page, account);

        await page.getByRole('button', { name: 'Abrir mais opções', exact: true }).click();
        const mobileMenu = page.getByRole('dialog', { name: 'Menu de navegação' });
        await expectDialogStateWithinViewport(page, mobileMenu, `${width}px ${roleCase.role}: menu móvel`);
        const routes = new Map<string, string>(
          await mobileMenu.getByRole('link').evaluateAll(links =>
            links.map(link => {
              const anchor = link as { getAttribute: (name: string) => string | null; innerText: string };
              return [anchor.getAttribute('href') || '', anchor.innerText.trim()] as [string, string];
            }),
          ),
        );
        await page.getByRole('button', { name: 'Fechar menu', exact: true }).click();

        const profilePath = await page
          .getByRole('link', { name: 'Abrir meu perfil', exact: true })
          .getAttribute('href');
        if (profilePath) routes.set(profilePath, 'Meu Perfil');

        const accessibleRoutes = [...routes.entries()]
          .filter(([path]) => path && !excludedRoutes.has(path))
          .sort(([left], [right]) => left.localeCompare(right));
        expect(accessibleRoutes.length, `${roleCase.role}: rotas obtidas do menu`).toBeGreaterThan(0);
        for (const forbiddenPath of roleCase.forbiddenRoutes) {
          expect(routes.has(forbiddenPath), `${roleCase.role}: ${forbiddenPath} não consta como acessível`)
            .toBe(false);
        }

        for (const [path, label] of accessibleRoutes) {
          await page.goto(path);
          const pageHeading = page.locator('main > header h1');
          await expect(pageHeading, `${width}px ${roleCase.role} ${path}: rota aberta`).toBeVisible();
          await expect(pageHeading, `${width}px ${roleCase.role} ${path}: título da tela`).not.toHaveText('');
          await expect(
            page.getByText('Acesso Restrito', { exact: true }),
            `${width}px ${roleCase.role} ${path}: rota permitida`,
          ).toHaveCount(0);
          await expect(
            page.locator('main .animate-pulse'),
            `${width}px ${roleCase.role} ${path}: carregamento concluído`,
          ).toHaveCount(0, { timeout: 20_000 });
          await expectNoHorizontalPageScroll(page, `${width}px ${roleCase.role} ${path} (${label})`);
        }

        for (const forbiddenPath of roleCase.forbiddenRoutes) {
          await page.goto(forbiddenPath);
          await expect(
            page.getByText('Acesso Restrito', { exact: true }),
            `${width}px ${roleCase.role} ${forbiddenPath}: acesso negado`,
          ).toBeVisible();
        }
      });
    }
  }
});

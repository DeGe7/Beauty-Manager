import { accounts, expect, loginAs, openModule, test, uniqueName } from '../fixtures';

test.describe('vendas avulsas de produtos', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_PROVISION !== 'true' ||
        process.env.E2E_START_SERVER !== 'true' ||
        !accounts.manager,
      'Requires the isolated provisioned E2E server and manager account.',
    );
    await loginAs(page, accounts.manager!);
  });

  test('salva estoque e valores do momento da venda, e inclui o histórico no financeiro', async ({ page }) => {
    const productName = uniqueName('Produto venda avulsa E2E');
    await openModule(page, '/produtos', 'Produtos & Estoque');

    await page.getByRole('button', { name: 'Adicionar Produto', exact: true }).click();
    const addProductForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Salvar Produto', exact: true }),
    });
    const fields = addProductForm.locator('input');
    await fields.nth(0).fill(productName);
    await fields.nth(1).fill('Teste');
    await fields.nth(2).fill('30');
    await fields.nth(3).fill('10');
    await fields.nth(4).fill('8');
    await fields.nth(5).fill('1');
    const productCreated = page.waitForResponse(response =>
      response.url().includes('/rest/v1/products') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await addProductForm.getByRole('button', { name: 'Salvar Produto', exact: true }).click();
    await productCreated;

    const productSelect = page.getByTestId('product-sale-product-1');
    const option = productSelect.locator('option').filter({ hasText: productName });
    const productId = await option.getAttribute('value');
    expect(productId).toBeTruthy();
    await productSelect.selectOption(productId!);
    await page.getByTestId('product-sale-quantity-1').fill('2');
    await page.getByTestId('product-sale-discount-value-1').fill('5');
    await expect(page.getByTestId('product-sale-total')).toContainText('55,00');

    const saleResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/rpc/record_product_sale') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await page.getByTestId('product-sale-submit').click();
    const sale = await (await saleResponsePromise).json() as {
      id: string;
      date: string;
      total: number;
      payment_method: string;
      client_id: string | null;
      appointment_id: string | null;
      items: Array<{
        productId: string;
        productName: string;
        unitPrice: number;
        quantity: number;
        discountType: string;
        discountValue: number;
        discountAmount: number;
        total: number;
      }>;
    };
    expect(sale.total).toBe(55);
    expect(sale.payment_method).toBe('pix');
    expect(sale.client_id).toBeNull();
    expect(sale.appointment_id).toBeNull();
    expect(sale.items).toEqual([{
      productId,
      productName,
      unitPrice: 30,
      quantity: 2,
      discountType: 'amount',
      discountValue: 5,
      discountAmount: 5,
      total: 55,
    }]);

    const snapshot = page.getByTestId(`product-sale-snapshot-${sale.id}`);
    await expect(snapshot).toContainText(productName);
    await expect(snapshot).toContainText('30,00');
    await expect(snapshot).toContainText('55,00');

    const productRow = page.getByRole('row').filter({ hasText: productName });
    await productRow.getByRole('button', { name: `Editar ${productName}` }).click();
    const editingRow = page.getByRole('row').filter({
      has: page.getByRole('button', { name: 'Confirmar edição', exact: true }),
    });
    await editingRow.locator('input[type="number"]').nth(0).fill('99');
    const productUpdated = page.waitForResponse(response =>
      response.url().includes(`/rest/v1/products?id=eq.${encodeURIComponent(productId!)}`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
    );
    await editingRow.getByRole('button', { name: 'Confirmar edição', exact: true }).click();
    await productUpdated;
    await expect(page.getByTestId(`product-sale-snapshot-${sale.id}`)).toContainText('30,00');

    await page.reload();
    await expect(page.getByTestId(`product-sale-snapshot-${sale.id}`)).toContainText('30,00');
    await expect(page.getByRole('row').filter({ hasText: productName })).toContainText('6');

    await openModule(page, '/financeiro', 'Financeiro');
    const movement = page.getByTestId(`finance-movement-${sale.id}`);
    await expect(movement).toContainText(`${productName} × 2`);
    await expect(movement).toContainText('55,00');

    await openModule(page, '/produtos', 'Produtos & Estoque');
    const reverseButton = page.getByTestId(`product-sale-reverse-${sale.id}`);
    await reverseButton.click();
    await expect(page.getByRole('alertdialog')).toContainText('O registro original será preservado');
    const confirmReversal = page.getByTestId('product-sale-reversal-confirm');
    await expect(confirmReversal).toBeDisabled();
    await page.getByTestId('product-sale-reversal-reason').fill('Cliente desistiu da compra');
    const reversalResponsePromise = page.waitForResponse(response =>
      response.url().includes('/rest/v1/rpc/reverse_product_sale') &&
      response.request().method() === 'POST' &&
      response.ok(),
    );
    await confirmReversal.click();
    const reversalResponse = await reversalResponsePromise;
    const reversedSale = await reversalResponse.json() as {
      id: string;
      total: number;
      date: string;
      reversal_date: string;
      reversal_reason: string;
      items: Array<{ unitPrice: number; quantity: number; total: number }>;
    };
    expect(reversedSale.id).toBe(sale.id);
    expect(reversedSale.total).toBe(55);
    expect(reversedSale.date).toBe(sale.date);
    expect(reversedSale.reversal_date).toBeTruthy();
    expect(reversedSale.reversal_reason).toBe('Cliente desistiu da compra');
    expect(reversedSale.items[0]).toMatchObject({ unitPrice: 30, quantity: 2, total: 55 });

    const requestHeaders = await reversalResponse.request().allHeaders();
    const duplicateReversal = await page.request.post(reversalResponse.url(), {
      headers: {
        authorization: requestHeaders.authorization,
        apikey: requestHeaders.apikey,
        'content-type': 'application/json',
      },
      data: { p_sale_id: sale.id, p_reason: 'Reenvio após resposta perdida' },
    });
    expect(duplicateReversal.ok()).toBeTruthy();
    expect(await duplicateReversal.json()).toMatchObject({
      id: sale.id,
      total: 55,
      reversal_reason: 'Cliente desistiu da compra',
    });

    await page.reload();
    const reversedSnapshot = page.getByTestId(`product-sale-snapshot-${sale.id}`);
    await expect(reversedSnapshot.getByTestId(`product-sale-reversed-status-${sale.id}`)).toHaveText('Estornada');
    await expect(reversedSnapshot.getByTestId(`product-sale-snapshot-total-${sale.id}`)).toContainText('55,00');
    await expect(reversedSnapshot.getByTestId(`product-sale-reversal-${sale.id}`)).toContainText('Cliente desistiu da compra');
    await expect(page.getByRole('row').filter({ hasText: productName })).toContainText('8');

    await openModule(page, '/financeiro', 'Financeiro');
    const reversalMovement = page.getByTestId(`finance-movement-reversal:${sale.id}`);
    await expect(reversalMovement).toContainText('Estorno');
    await expect(reversalMovement).toContainText('Cliente desistiu da compra');
    await expect(reversalMovement).toContainText('-R$ 55,00');
    await expect(page.getByTestId(`finance-movement-${sale.id}`)).toContainText('R$ 55,00');
  });
});

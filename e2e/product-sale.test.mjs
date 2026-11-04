import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProductSaleLine } from '../artifacts/barber-manager/src/data/product-sale.ts';

test('calcula desconto fixo no total da linha e mantém centavos', () => {
  assert.deepEqual(calculateProductSaleLine(19.9, 3, 'amount', 10), {
    subtotal: 59.7,
    discountAmount: 10,
    total: 49.7,
  });
});

test('calcula desconto percentual sobre subtotal', () => {
  assert.deepEqual(calculateProductSaleLine(40, 2, 'percent', 12.5), {
    subtotal: 80,
    discountAmount: 10,
    total: 70,
  });
});

test('desconto igual ao subtotal resulta em zero, nunca valor negativo', () => {
  assert.deepEqual(calculateProductSaleLine(12.5, 2, 'amount', 25), {
    subtotal: 25,
    discountAmount: 25,
    total: 0,
  });
});

test('rejeita desconto em reais acima do subtotal', () => {
  assert.throws(() => calculateProductSaleLine(10, 1, 'amount', 10.01), /não pode exceder/);
});

test('rejeita percentual acima de cem', () => {
  assert.throws(() => calculateProductSaleLine(10, 1, 'percent', 100.01), /não pode exceder/);
});

test('rejeita preço ou quantidade inválidos', () => {
  assert.throws(() => calculateProductSaleLine(-1, 1, 'amount', 0), /Preço inválido/);
  assert.throws(() => calculateProductSaleLine(5, 0, 'amount', 0), /Quantidade inválida/);
});

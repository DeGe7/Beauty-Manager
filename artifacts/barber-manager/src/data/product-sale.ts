export type ProductSaleDiscountType = 'amount' | 'percent';

export interface ProductSaleLineCalculation {
  subtotal: number;
  discountAmount: number;
  total: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateProductSaleLine(
  unitPrice: number,
  quantity: number,
  discountType: ProductSaleDiscountType,
  discountValue: number,
): ProductSaleLineCalculation {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Preço inválido.');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantidade inválida.');
  if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error('Desconto inválido.');
  if (discountType === 'percent' && discountValue > 100) throw new Error('O desconto percentual não pode exceder 100%.');

  const subtotal = money(unitPrice * quantity);
  const discountAmount = money(
    discountType === 'percent' ? subtotal * discountValue / 100 : discountValue,
  );
  if (discountAmount > subtotal) throw new Error('O desconto não pode exceder o subtotal do item.');
  return {
    subtotal,
    discountAmount,
    total: money(Math.max(0, subtotal - discountAmount)),
  };
}


import type { SubscriptionPayment } from './store';

export function subscriptionReceiptDate(
  payment: Pick<SubscriptionPayment, 'status' | 'paidAt'>,
): string | null {
  if (payment.status !== 'pago' || !payment.paidAt) return null;

  const receiptDate = payment.paidAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(receiptDate) ? receiptDate : null;
}

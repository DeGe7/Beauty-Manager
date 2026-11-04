export interface AppointmentCommissionAttribution {
  professionalId: string;
  sellerProfessionalId?: string;
  sellerIsCompany?: boolean;
  service: string;
  serviceId?: string;
  value: number;
  planUsageValue?: number;
  serviceCommissionRateSnapshot?: number;
  prosthesisCostSnapshot?: number;
  prosthesisCommissionRuleSnapshot?: boolean;
  professionalCommissions?: Array<{ professionalId: string; amount: number }>;
}

export const PROFESSIONAL_SERVICE_COMMISSION_RATE = 0.5;
export const PROSTHESIS_FIXED_COMMISSION = 140;

export function automaticProsthesisProductId(
  products: Array<{
    id: string;
    name: string;
    isActive: boolean;
    isProsthesisCapillary: boolean;
  }>,
): string | null {
  const markedProducts = products.filter(product => product.isActive && product.isProsthesisCapillary);
  const normalizedName = (name: string) => name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const exactMatches = markedProducts.filter(product => normalizedName(product.name) === 'protese capilar');

  if (exactMatches.length === 1) return exactMatches[0].id;
  if (exactMatches.length > 1) return null;
  return markedProducts.length === 1 ? markedProducts[0].id : null;
}

export function appointmentProductsChargeTotal(
  consumedProducts: Array<{ productId: string; quantity: number }>,
  products: Array<{ id: string; price: number; isProsthesisCapillary: boolean }>,
  isProsthesisApplication: boolean,
): number {
  const total = consumedProducts.reduce((sum, item) => {
    const product = products.find(candidate => candidate.id === item.productId);
    if (!product || !Number.isFinite(item.quantity) || item.quantity <= 0) return sum;
    if (isProsthesisApplication && product.isProsthesisCapillary) return sum;
    return sum + Math.max(0, product.price) * item.quantity;
  }, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

export const PROFESSIONAL_SALES_COMMISSION_FIELDS = [
  { key: 'protese', label: 'Prótese capilar' },
  { key: 'mentoria', label: 'Mentoria' },
] as const;

export function professionalCommissionPool(serviceValue: number): number {
  const safeValue = Number.isFinite(serviceValue) ? Math.max(0, serviceValue) : 0;
  return Math.round((safeValue * PROFESSIONAL_SERVICE_COMMISSION_RATE + Number.EPSILON) * 100) / 100;
}

export function manualCommissionAmountLimit(
  professionalPool: number,
  otherAmounts: number[],
): number {
  const safePool = Number.isFinite(professionalPool) ? Math.max(0, professionalPool) : 0;
  const poolCents = Math.round((safePool + Number.EPSILON) * 100);
  const assignedCents = otherAmounts.reduce((total, amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return total;
    return total + Math.round((amount + Number.EPSILON) * 100);
  }, 0);
  return Math.max(0, poolCents - assignedCents) / 100;
}

export function clampManualCommissionAmount(
  professionalPool: number,
  otherAmounts: number[],
  proposedAmount: number,
): number {
  const requested = Number.isFinite(proposedAmount) ? Math.max(0, proposedAmount) : 0;
  const requestedCents = Math.round((requested + Number.EPSILON) * 100);
  const availableCents = Math.round((
    manualCommissionAmountLimit(professionalPool, otherAmounts) + Number.EPSILON
  ) * 100);
  return Math.min(requestedCents, availableCents) / 100;
}

export function manualCommissionAllocationMatches(
  serviceValue: number,
  assignments: Array<{ professionalId: string; amount: number }>,
): boolean {
  return manualCommissionAllocationMatchesTarget(professionalCommissionPool(serviceValue), assignments);
}

export function manualCommissionAllocationMatchesTarget(
  targetAmount: number,
  assignments: Array<{ professionalId: string; amount: number }>,
): boolean {
  const totalCents = assignments.reduce((sum, assignment) => {
    if (!Number.isFinite(assignment.amount) || assignment.amount < 0) return Number.NaN;
    return sum + Math.round((assignment.amount + Number.EPSILON) * 100);
  }, 0);
  return totalCents === Math.round((targetAmount + Number.EPSILON) * 100);
}

export function prosthesisCommissionForProfessional(
  serviceValue: number,
  productCost: number,
  professionalName: string,
): number {
  const normalizedName = professionalName.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalizedName === 'marcos macedo') {
    const profit = Math.max(0, (Number.isFinite(serviceValue) ? serviceValue : 0)
      - (Number.isFinite(productCost) ? productCost : 0));
    return Math.round((profit * 0.5 + Number.EPSILON) * 100) / 100;
  }
  return PROSTHESIS_FIXED_COMMISSION;
}

export function prosthesisProductCost(
  consumedProducts: Array<{ productId: string; quantity: number }>,
  products: Array<{ id: string; isProsthesisCapillary: boolean; cost: number }>,
): number {
  const prosthesisProducts = new Set(
    products
      .filter(product => product.isProsthesisCapillary)
      .map(product => product.id),
  );
  const total = consumedProducts.reduce((sum, item) => {
    if (!prosthesisProducts.has(item.productId)) return sum;
    const product = products.find(candidate => candidate.id === item.productId);
    if (!product || !Number.isFinite(item.quantity) || item.quantity <= 0) return sum;
    return sum + Math.max(0, product.cost) * item.quantity;
  }, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/**
 * A person assigned both to perform and sell a service earns both configured
 * role commissions. Company sales never add a seller commission.
 */
export function appointmentCommissionForProfessional(
  appointment: AppointmentCommissionAttribution,
  professionalId: string,
  rateForService: (serviceName: string, serviceId?: string) => number,
  professionalName = '',
): number {
  let commission = 0;
  const commissionBase = appointment.planUsageValue ?? appointment.value;
  const manualAssignments = appointment.professionalCommissions ?? [];
  if (manualAssignments.length > 1) {
    commission += manualAssignments
      .filter(assignment => assignment.professionalId === professionalId)
      .reduce((total, assignment) => total + assignment.amount, 0);
  } else if (
    appointment.professionalId === professionalId
    && appointment.prosthesisCommissionRuleSnapshot
  ) {
    commission += prosthesisCommissionForProfessional(
      appointment.value,
      appointment.prosthesisCostSnapshot ?? 0,
      professionalName,
    );
  } else if (appointment.professionalId === professionalId) {
    const rate = appointment.serviceCommissionRateSnapshot
      ?? rateForService(appointment.service, appointment.serviceId);
    commission += Math.round((commissionBase * rate + Number.EPSILON) * 100) / 100;
  }
  if (!appointment.sellerIsCompany && appointment.sellerProfessionalId === professionalId) {
    commission += Math.round((
      commissionBase * rateForService(appointment.service, appointment.serviceId) + Number.EPSILON
    ) * 100) / 100;
  }
  return commission;
}

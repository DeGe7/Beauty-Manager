import type {
  Appointment,
  PlanServiceBenefit,
  Subscriber,
  SubscriptionPayment,
  SubscriptionPlan,
} from '@/data/store';

export function planServiceBenefits(plan: SubscriptionPlan | undefined): PlanServiceBenefit[] {
  if (!plan) return [];

  return plan.services.flatMap(service => {
    if (typeof service === 'string') return [];
    const uses = Number(service.usesPerCycle);
    if (!service.serviceId || !service.serviceName || !Number.isInteger(uses) || uses < 1) return [];
    return [{
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      usesPerCycle: uses,
    }];
  });
}

export function totalPlanIncludedUses(plan: SubscriptionPlan | undefined): number {
  return planServiceBenefits(plan).reduce((total, service) => total + service.usesPerCycle, 0);
}

export function planValuePerUse(plan: SubscriptionPlan | undefined): number {
  const uses = totalPlanIncludedUses(plan);
  if (!plan || uses === 0) return 0;
  return plan.price / uses;
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function planSalonShareAmount(
  plan: SubscriptionPlan | undefined,
  grossAmount?: number,
): number | null {
  if (!plan || plan.salonSharePercent == null) return null;
  const grossCents = toCents(grossAmount ?? plan.price);
  const salonCents = Math.round(grossCents * plan.salonSharePercent / 100);
  return salonCents / 100;
}

export function planProfessionalPoolAmount(
  plan: SubscriptionPlan | undefined,
  grossAmount?: number,
): number | null {
  if (!plan || plan.salonSharePercent == null) return null;
  const grossCents = toCents(grossAmount ?? plan.price);
  const salonCents = Math.round(grossCents * plan.salonSharePercent / 100);
  return (grossCents - salonCents) / 100;
}

function amountForUse(totalAmount: number, uses: number, usageOrdinal: number): number | null {
  if (
    uses < 1
    || !Number.isInteger(usageOrdinal)
    || usageOrdinal < 1
    || usageOrdinal > uses
  ) return null;

  const totalCents = toCents(totalAmount);
  const baseCents = Math.floor(totalCents / uses);
  const remainderCents = totalCents % uses;
  return (baseCents + (usageOrdinal <= remainderCents ? 1 : 0)) / 100;
}

export function planSalonAmountForUse(
  plan: SubscriptionPlan | undefined,
  usageOrdinal: number,
): number | null {
  const uses = totalPlanIncludedUses(plan);
  const salonShare = planSalonShareAmount(plan);
  return salonShare == null ? null : amountForUse(salonShare, uses, usageOrdinal);
}

/**
 * Split the professional pool in cents. Any remainder cents go to the
 * earliest uses, so the total paid across all uses never exceeds the pool.
 */
export function planProfessionalAmountForUse(
  plan: SubscriptionPlan | undefined,
  usageOrdinal: number,
): number | null {
  const uses = totalPlanIncludedUses(plan);
  const pool = planProfessionalPoolAmount(plan);
  return pool == null ? null : amountForUse(pool, uses, usageOrdinal);
}

export function subscriberPlanUsageCount(
  appointments: Appointment[],
  subscriber: Subscriber,
): number {
  const cycleStart = subscriber.usageStartedAt
    ? Date.parse(subscriber.usageStartedAt)
    : Date.parse(`${subscriber.startDate}T00:00:00-03:00`);

  return appointments.filter(appointment => {
    if (
      appointment.planSubscriberId !== subscriber.id
      || !appointment.attendanceRecordedAt
      || (appointment.status !== 'confirmed' && appointment.status !== 'completed')
    ) return false;

    const recordedAt = Date.parse(appointment.attendanceRecordedAt);
    return Number.isFinite(recordedAt) && Number.isFinite(cycleStart) && recordedAt >= cycleStart;
  }).length;
}

export interface PlanFinanceSummary {
  receiptTotal: number;
  salonShareTotal: number;
  professionalPoolTotal: number;
  receiptsWithoutSplit: number;
  commissionsRecognizedOnUses: number;
}

export function summarizePlanFinance(
  paidPayments: SubscriptionPayment[],
  planAppointments: Appointment[],
): PlanFinanceSummary {
  let receiptCents = 0;
  let salonCents = 0;
  let professionalPoolCents = 0;
  let receiptsWithoutSplitCents = 0;

  for (const payment of paidPayments) {
    const amountCents = toCents(payment.amount);
    receiptCents += amountCents;
    const sharePercent = payment.salonSharePercentSnapshot;
    if (sharePercent == null || !Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100) {
      receiptsWithoutSplitCents += amountCents;
      continue;
    }
    const paymentSalonCents = Math.round(amountCents * sharePercent / 100);
    salonCents += paymentSalonCents;
    professionalPoolCents += amountCents - paymentSalonCents;
  }

  let commissionCents = 0;
  for (const appointment of planAppointments) {
    if (
      !appointment.planSubscriberId
      || !appointment.attendanceRecordedAt
      || (appointment.status !== 'confirmed' && appointment.status !== 'completed')
    ) continue;

    const assignments = appointment.professionalCommissions ?? [];
    if (assignments.length > 1) {
      commissionCents += assignments.reduce((sum, assignment) => sum + toCents(assignment.amount), 0);
    } else if (appointment.serviceCommissionRateSnapshot != null) {
      commissionCents += Math.round((
        (appointment.planUsageValue ?? 0) * appointment.serviceCommissionRateSnapshot
        + Number.EPSILON
      ) * 100);
    }
  }

  return {
    receiptTotal: receiptCents / 100,
    salonShareTotal: salonCents / 100,
    professionalPoolTotal: professionalPoolCents / 100,
    receiptsWithoutSplit: receiptsWithoutSplitCents / 100,
    commissionsRecognizedOnUses: commissionCents / 100,
  };
}

export function subscriberServiceUses(
  appointments: Appointment[],
  subscriber: Subscriber,
  serviceId: string,
): number {
  const cycleStart = subscriber.usageStartedAt
    ? Date.parse(subscriber.usageStartedAt)
    : Date.parse(`${subscriber.startDate}T00:00:00-03:00`);

  return appointments.filter(appointment => {
    if (
      appointment.planSubscriberId !== subscriber.id
      || appointment.serviceId !== serviceId
      || !appointment.attendanceRecordedAt
      || (appointment.status !== 'confirmed' && appointment.status !== 'completed')
    ) return false;

    const recordedAt = Date.parse(appointment.attendanceRecordedAt);
    return Number.isFinite(recordedAt) && Number.isFinite(cycleStart) && recordedAt >= cycleStart;
  }).length;
}

export function subscriberServiceUsesRemaining(
  appointments: Appointment[],
  subscriber: Subscriber,
  benefit: PlanServiceBenefit,
): number {
  return Math.max(0, benefit.usesPerCycle - subscriberServiceUses(appointments, subscriber, benefit.serviceId));
}

export function planServiceLabel(service: string | PlanServiceBenefit): string {
  return typeof service === 'string'
    ? service
    : `${service.serviceName} · ${service.usesPerCycle} ${service.usesPerCycle === 1 ? 'uso' : 'usos'} por ciclo`;
}

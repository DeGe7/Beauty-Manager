import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appointmentCommissionForProfessional,
  appointmentProductsChargeTotal,
  automaticProsthesisProductId,
  clampManualCommissionAmount,
  manualCommissionAmountLimit,
  manualCommissionAllocationMatches,
  manualCommissionAllocationMatchesTarget,
  professionalCommissionPool,
  prosthesisCommissionForProfessional,
  prosthesisProductCost,
} from '../artifacts/barber-manager/src/data/appointment-commissions.ts';
import {
  planProfessionalAmountForUse,
  planProfessionalPoolAmount,
  planSalonAmountForUse,
  planSalonShareAmount,
  planValuePerUse,
  subscriberServiceUsesRemaining,
  summarizePlanFinance,
} from '../artifacts/barber-manager/src/data/plan-usage.ts';

const rateFor = service => ({ 'Prótese Capilar': 0.2, Mentoria: 0.3, Barbearia: 0.4 })[service] ?? 0;
const appointment = (overrides = {}) => ({
  professionalId: 'executor',
  service: 'Prótese Capilar',
  value: 1000,
  ...overrides,
});

test('prosthesis used for an application is not charged twice to the client', () => {
  assert.equal(
    appointmentProductsChargeTotal(
      [
        { productId: 'prosthesis', quantity: 1 },
        { productId: 'styling-product', quantity: 2 },
      ],
      [
        { id: 'prosthesis', price: 900, isProsthesisCapillary: true },
        { id: 'styling-product', price: 25, isProsthesisCapillary: false },
      ],
      true,
    ),
    50,
  );
});

test('automatically selects the active marked product named Prótese Capilar', () => {
  assert.equal(
    automaticProsthesisProductId([
      { id: 'other', name: 'Cera', isActive: true, isProsthesisCapillary: false },
      { id: 'prosthesis', name: 'Prótese Capilar', isActive: true, isProsthesisCapillary: true },
    ]),
    'prosthesis',
  );
});

test('uses the sole active marked prosthesis product when its name differs', () => {
  assert.equal(
    automaticProsthesisProductId([
      { id: 'prosthesis', name: 'Modelo Premium', isActive: true, isProsthesisCapillary: true },
      { id: 'inactive', name: 'Prótese Capilar', isActive: false, isProsthesisCapillary: true },
    ]),
    'prosthesis',
  );
});

test('does not guess when multiple marked products could be consumed', () => {
  assert.equal(
    automaticProsthesisProductId([
      { id: 'one', name: 'Prótese Premium', isActive: true, isProsthesisCapillary: true },
      { id: 'two', name: 'Prótese Básica', isActive: true, isProsthesisCapillary: true },
    ]),
    null,
  );
});

test('new attended service gives the executor half of the gross service value', () => {
  assert.equal(
    appointmentCommissionForProfessional(
      appointment({ serviceCommissionRateSnapshot: 0.5 }),
      'executor',
      rateFor,
    ),
    500,
  );
});

test('commission lookup receives the stable service ID after a service is renamed', () => {
  const lookupCalls = [];
  const rateById = (serviceName, serviceId) => {
    lookupCalls.push({ serviceName, serviceId });
    return serviceId === 'service-corte' ? 0.25 : 0;
  };
  const soldService = appointment({
    service: 'Corte atualizado',
    serviceId: 'service-corte',
    sellerProfessionalId: 'seller',
    serviceCommissionRateSnapshot: 0.5,
  });

  assert.equal(
    appointmentCommissionForProfessional(soldService, 'executor', rateById),
    500,
  );
  assert.equal(
    appointmentCommissionForProfessional(soldService, 'seller', rateById),
    250,
  );
  assert.deepEqual(lookupCalls, [{ serviceName: 'Corte atualizado', serviceId: 'service-corte' }]);
});

test('different seller earns the same service-specific commission independently', () => {
  const sale = appointment({ sellerProfessionalId: 'seller', serviceCommissionRateSnapshot: 0.5 });
  assert.equal(appointmentCommissionForProfessional(sale, 'executor', rateFor), 500);
  assert.equal(appointmentCommissionForProfessional(sale, 'seller', rateFor), 200);
});

test('the same professional earns both role commissions without duplicating revenue', () => {
  const sale = appointment({
    sellerProfessionalId: 'executor',
    service: 'Mentoria',
    serviceCommissionRateSnapshot: 0.5,
  });
  assert.equal(appointmentCommissionForProfessional(sale, 'executor', rateFor), 800);
  assert.equal(sale.value, 1000);
});

test('company-attributed sales do not credit a seller commission', () => {
  const sale = appointment({ sellerIsCompany: true, serviceCommissionRateSnapshot: 0.5 });
  assert.equal(appointmentCommissionForProfessional(sale, 'executor', rateFor), 500);
  assert.equal(appointmentCommissionForProfessional(sale, 'seller', rateFor), 0);
});

test('legacy and ordinary appointments retain executor-only commissions', () => {
  assert.equal(appointmentCommissionForProfessional(appointment(), 'executor', rateFor), 200);
  assert.equal(
    appointmentCommissionForProfessional(
      appointment({ service: 'Barbearia', sellerProfessionalId: undefined }),
      'executor',
      rateFor,
    ),
    400,
  );
});

test('plan-use commission uses the prorated plan price instead of service revenue', () => {
  const planAttendance = appointment({
    value: 0,
    planUsageValue: 37.5,
    serviceCommissionRateSnapshot: 0.5,
  });
  assert.equal(appointmentCommissionForProfessional(planAttendance, 'executor', rateFor), 18.75);
});

test('historical appointments without a commission snapshot keep their configured rate', () => {
  const legacyAppointment = appointment({ value: 100, serviceCommissionRateSnapshot: undefined });
  assert.equal(appointmentCommissionForProfessional(legacyAppointment, 'executor', rateFor), 20);
  const legacyPlanAttendance = appointment({
    value: 0,
    planUsageValue: 37.5,
    serviceCommissionRateSnapshot: undefined,
  });
  assert.equal(appointmentCommissionForProfessional(legacyPlanAttendance, 'executor', rateFor), 7.5);
});

test('manual multi-professional amounts must total exactly half of the service base', () => {
  assert.equal(professionalCommissionPool(100), 50);
  assert.equal(
    manualCommissionAllocationMatches(100, [
      { professionalId: 'executor', amount: 18.5 },
      { professionalId: 'second', amount: 31.5 },
    ]),
    true,
  );
  assert.equal(
    manualCommissionAllocationMatches(100, [
      { professionalId: 'executor', amount: 18.5 },
      { professionalId: 'second', amount: 12 },
    ]),
    false,
  );
});

test('manual commission entry is capped at the remaining professional pool', () => {
  assert.equal(manualCommissionAmountLimit(50, [18.5]), 31.5);
  assert.equal(clampManualCommissionAmount(50, [18.5], 40), 31.5);
  assert.equal(clampManualCommissionAmount(50, [50], 8), 0);
  assert.equal(clampManualCommissionAmount(18.75, [3.25], 20), 15.5);
});

test('plan commission pool is half of the prorated plan value per use', () => {
  const planAttendance = appointment({ value: 0, planUsageValue: 37.5 });
  assert.equal(professionalCommissionPool(planAttendance.planUsageValue), 18.75);
});

test('legacy plan-use commission still uses the historic configured rate', () => {
  const planAttendance = appointment({ value: 0, planUsageValue: 37.5 });
  assert.equal(appointmentCommissionForProfessional(planAttendance, 'executor', rateFor), 7.5);
});

test('multiple professionals receive only their manually assigned commission amounts', () => {
  const sharedAppointment = appointment({
    value: 100,
    professionalCommissions: [
      { professionalId: 'executor', amount: 18.5 },
      { professionalId: 'second', amount: 31.5 },
    ],
  });

  assert.equal(appointmentCommissionForProfessional(sharedAppointment, 'executor', rateFor), 18.5);
  assert.equal(appointmentCommissionForProfessional(sharedAppointment, 'second', rateFor), 31.5);
  assert.equal(appointmentCommissionForProfessional(sharedAppointment, 'unassigned', rateFor), 0);
});

test('prosthesis application pays a fixed R$140 except Marcos, who receives half the net profit', () => {
  assert.equal(prosthesisCommissionForProfessional(800, 300, 'João Silva'), 140);
  assert.equal(prosthesisCommissionForProfessional(800, 300, 'Marcos Macedo'), 250);
  assert.equal(prosthesisCommissionForProfessional(200, 300, 'Marcos Macedo'), 0);

  const application = appointment({
    value: 800,
    prosthesisCostSnapshot: 300,
    prosthesisCommissionRuleSnapshot: true,
  });
  assert.equal(
    appointmentCommissionForProfessional(application, 'executor', rateFor, 'Marcos Macedo'),
    250,
  );
  assert.equal(
    appointmentCommissionForProfessional(application, 'executor', rateFor, 'João Silva'),
    140,
  );
});

test('Marcos profit uses only consumed inventory items explicitly marked as capillary prostheses', () => {
  assert.equal(
    prosthesisProductCost(
      [
        { productId: 'hair-piece', quantity: 1 },
        { productId: 'renamed-item', quantity: 2 },
        { productId: 'unmarked-prosthesis', quantity: 3 },
      ],
      [
        { id: 'hair-piece', isProsthesisCapillary: true, cost: 300 },
        { id: 'renamed-item', isProsthesisCapillary: true, cost: 20 },
        { id: 'unmarked-prosthesis', isProsthesisCapillary: false, cost: 45 },
      ],
    ),
    340,
  );
  assert.equal(
    prosthesisProductCost(
      [{ productId: 'renamed-item', quantity: 2 }],
      [{ id: 'renamed-item', name: 'Produto renomeado', category: 'Acessórios', isProsthesisCapillary: true, cost: 20 }],
    ),
    40,
  );
});

test('plan cost is divided across every included use and cancelled visits do not consume quota', () => {
  const plan = {
    id: 'plan',
    name: 'Plano mensal',
    price: 120,
    duration: 'Mensal',
    services: [
      { serviceId: 'cut', serviceName: 'Corte', usesPerCycle: 4 },
      { serviceId: 'beard', serviceName: 'Barba', usesPerCycle: 2 },
    ],
  };
  const subscriber = {
    id: 'subscriber',
    name: 'Cliente',
    phone: '',
    planId: 'plan',
    startDate: '2026-10-01',
    nextPayment: '2026-11-01',
    status: 'ativo',
    usageStartedAt: '2026-10-01T00:00:00.000Z',
  };
  const appointments = [
    { planSubscriberId: 'subscriber', serviceId: 'cut', attendanceRecordedAt: '2026-10-02T12:00:00.000Z', status: 'confirmed' },
    { planSubscriberId: 'subscriber', serviceId: 'cut', attendanceRecordedAt: '2026-10-03T12:00:00.000Z', status: 'cancelled' },
    { planSubscriberId: 'subscriber', serviceId: 'cut', attendanceRecordedAt: '2026-09-30T12:00:00.000Z', status: 'completed' },
  ];

  assert.equal(planValuePerUse(plan), 20);
  assert.equal(subscriberServiceUsesRemaining(appointments, subscriber, plan.services[0]), 3);
});

test('plan split allocates exact cents across all uses without exceeding the professional pool', () => {
  const plan = {
    id: 'plan-split',
    name: 'Plano com rateio configurável',
    price: 100.01,
    salonSharePercent: 40,
    duration: 'Mensal',
    services: [
      { serviceId: 'cut', serviceName: 'Corte', usesPerCycle: 3 },
    ],
  };
  const useValues = [1, 2, 3].map(ordinal => planProfessionalAmountForUse(plan, ordinal));
  const salonUseValues = [1, 2, 3].map(ordinal => planSalonAmountForUse(plan, ordinal));

  assert.equal(planSalonShareAmount(plan), 40);
  assert.equal(planProfessionalPoolAmount(plan), 60.01);
  assert.deepEqual(useValues, [20.01, 20, 20]);
  assert.deepEqual(salonUseValues, [13.34, 13.33, 13.33]);
  assert.equal(useValues.reduce((sum, value, index) => sum + (value ?? 0) + (salonUseValues[index] ?? 0), 0), 100.01);
  assert.equal(Math.round(useValues.reduce((sum, value) => sum + (value ?? 0), 0) * 100) / 100, 60.01);
  assert.equal(manualCommissionAllocationMatchesTarget(20.01, [
    { professionalId: 'one', amount: 12 },
    { professionalId: 'two', amount: 8.01 },
  ]), true);
  assert.equal(manualCommissionAllocationMatchesTarget(20.01, [
    { professionalId: 'one', amount: 12 },
    { professionalId: 'two', amount: 8 },
  ]), false);
});

test('plan finance summary separates known split, legacy receipts, and commissions earned on uses', () => {
  const summary = summarizePlanFinance(
    [
      { id: 'paid-configured', amount: 100.01, status: 'pago', salonSharePercentSnapshot: 40 },
      { id: 'paid-legacy', amount: 50, status: 'pago' },
    ],
    [
      {
        ...appointment({ planSubscriberId: 'subscriber', planUsageValue: 20.01, serviceCommissionRateSnapshot: 1 }),
        attendanceRecordedAt: '2026-11-03T12:00:00.000Z',
        status: 'completed',
      },
      {
        ...appointment({ planSubscriberId: 'subscriber', professionalCommissions: [
          { professionalId: 'one', amount: 12 },
          { professionalId: 'two', amount: 8.01 },
        ] }),
        attendanceRecordedAt: '2026-11-03T12:00:00.000Z',
        status: 'completed',
      },
    ],
  );

  assert.deepEqual(summary, {
    receiptTotal: 150.01,
    salonShareTotal: 40,
    professionalPoolTotal: 60.01,
    receiptsWithoutSplit: 50,
    commissionsRecognizedOnUses: 40.02,
  });
});

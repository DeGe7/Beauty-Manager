import { useEffect, useState } from 'react';
import { useStore, brl, productStatus, PAY_LABELS, PayMethod } from '@/data/store';
import { useAuth } from '@/auth/auth';
import { canAccess } from '@/auth/roles';
import { FeatureInfo } from '@/components/FeatureInfo';
import { 
  DollarSign, 
  CalendarCheck, 
  Clock, 
  Trophy, 
  AlertTriangle,
  Briefcase,
  LogIn,
  ArrowRight,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { StatsCard } from '@/components/StatsCard';
import { formatDateKey, parseDateKey } from '@/data/date';
import { subscriptionReceiptDate } from '@/data/subscription-payment';
import { api, type ReceptionDailyOperations } from '@/data/api';
import { summarizePlanFinance } from '@/data/plan-usage';

const PAYMENT_METHODS: PayMethod[] = ['debito', 'credito', 'pix', 'dinheiro'];
const RECEPTION_PAYMENT_LABELS: Record<PayMethod | 'planos', string> = {
  debito: 'Débito',
  credito: 'Crédito',
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  planos: 'Planos',
};
const PAYMENT_CARD_STYLES: Record<PayMethod, string> = {
  debito: 'border-sky-400 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/5',
  credito: 'border-violet-400 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/5',
  pix: 'border-emerald-400 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/5',
  dinheiro: 'border-amber-400 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/5',
};
const PAYMENT_VALUE_STYLES: Record<PayMethod, string> = {
  debito: 'text-sky-700 dark:text-sky-400',
  credito: 'text-violet-700 dark:text-violet-400',
  pix: 'text-emerald-700 dark:text-emerald-400',
  dinheiro: 'text-amber-700 dark:text-amber-400',
};

export default function Dashboard() {
  const {
    appointments, professionals, products, productSales, prothesisSales, mentoriaSessions, expenses,
    plans, subscribers, subscriptionPayments, isLoading,
  } = useStore();
  const { profile, viewAsProfile } = useAuth();
  const activeProfile = viewAsProfile ?? profile;
  const isReceptionist = activeProfile?.role === 'recepcao';
  const isPersonalFinanceRole = ['barbeiro', 'manicure', 'vendedor'].includes(activeProfile?.role ?? '');
  const ownProfile = Boolean(activeProfile?.professionalId && activeProfile.role !== 'gestor' && activeProfile.role !== 'dev-admin');
  const canViewFinancialSummary = !ownProfile && !isPersonalFinanceRole &&
    canAccess(activeProfile?.role ?? null, '/financeiro', activeProfile?.permissions);
  const canOpenControl = canAccess(activeProfile?.role ?? null, '/controle', activeProfile?.permissions);
  const canOpenAgenda = canAccess(activeProfile?.role ?? null, '/agenda', activeProfile?.permissions);
  const [revenuePeriod, setRevenuePeriod] = useState<'diaria' | 'semanal' | 'mensal'>('diaria');
  const [receptionOperations, setReceptionOperations] = useState<ReceptionDailyOperations | null>(null);
  const [receptionOperationsError, setReceptionOperationsError] = useState(false);

  const today = formatDateKey();
  useEffect(() => {
    if (!isReceptionist) {
      setReceptionOperations(null);
      setReceptionOperationsError(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const summary = await api.dashboard.getReceptionDailyOperations(today);
        if (!cancelled) {
          setReceptionOperations(summary);
          setReceptionOperationsError(false);
        }
      } catch (error) {
        console.error('Failed to load reception daily operations:', error);
        if (!cancelled) setReceptionOperationsError(true);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isReceptionist, today]);
  const todayAppointments = appointments.filter(a => {
    if (isPersonalFinanceRole && !activeProfile?.professionalId) return false;
    return a.date === today && (!ownProfile || a.professionalId === activeProfile?.professionalId);
  });
  const completed = todayAppointments.filter(a =>
    a.status === 'completed' ||
    (Boolean(a.attendanceRecordedAt) && a.status !== 'cancelled' && a.status !== 'no_show')
  ).length;
  const checkedIn = todayAppointments.filter(a => a.status === 'checked_in').length;
  const awaiting = todayAppointments.filter(a =>
    (a.status === 'pending' || a.status === 'confirmed') && !a.attendanceRecordedAt
  ).length;
  const paidSubscriptionReceipts = subscriptionPayments.flatMap(payment => {
    const receiptDate = subscriptionReceiptDate(payment);
    return receiptDate ? [{ ...payment, receiptDate }] : [];
  });
  const todaySubscriptionRevenue = ownProfile || isPersonalFinanceRole
    ? 0
    : paidSubscriptionReceipts
      .filter(payment => payment.receiptDate === today)
      .reduce((sum, payment) => sum + payment.amount, 0);
  const todayPlanFinance = summarizePlanFinance(
    paidSubscriptionReceipts.filter(payment => payment.receiptDate === today),
    appointments.filter(appointment => appointment.date === today),
  );
  const todayProductSalesRevenue = ownProfile || isPersonalFinanceRole
    ? 0
    : productSales.reduce((sum, sale) => {
      const saleAmount = sale.date === today ? sale.total : 0;
      const reversalAmount = sale.reversalDate === today ? sale.total : 0;
      return sum + saleAmount - reversalAmount;
    }, 0);
  const revenue = todayAppointments
    .filter(a => a.status === 'completed' || a.status === 'confirmed')
    .reduce((sum, a) => sum + a.value + (a.tip || 0), 0) +
    todaySubscriptionRevenue + todayProductSalesRevenue;

  const profRevenue: Record<string, number> = {};
  todayAppointments.filter(a => a.status === 'completed' || a.status === 'confirmed').forEach(a => {
    profRevenue[a.professionalId] = (profRevenue[a.professionalId] || 0) + a.value + (a.tip || 0);
  });
  
  let topProfId = '';
  let maxRev = -1;
  Object.entries(profRevenue).forEach(([id, rev]) => {
    if (rev > maxRev) { maxRev = rev; topProfId = id; }
  });
  
  const topProf = professionals.find(p => p.id === topProfId);

  const revenuePeriodStart = new Date();
  revenuePeriodStart.setHours(0, 0, 0, 0);
  revenuePeriodStart.setDate(revenuePeriodStart.getDate() - (
    revenuePeriod === 'diaria' ? 0 : revenuePeriod === 'semanal' ? 6 : 29
  ));
  const revenuePeriodEnd = parseDateKey(today);
  const paymentPeriodMatches = (date: string) => {
    const value = parseDateKey(date);
    return value >= revenuePeriodStart && value <= revenuePeriodEnd;
  };
  const subscriptionReceiptsInPeriod = paidSubscriptionReceipts
    .filter(payment => paymentPeriodMatches(payment.receiptDate))
    .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const subscriptionRevenueInPeriod = subscriptionReceiptsInPeriod
    .reduce((sum, payment) => sum + payment.amount, 0);
  const planFinanceInPeriod = summarizePlanFinance(
    subscriptionReceiptsInPeriod,
    appointments.filter(appointment => paymentPeriodMatches(appointment.date)),
  );
  const revenueAppointments = appointments.filter(a => {
    if (a.status !== 'completed' && a.status !== 'confirmed') return false;
    const date = parseDateKey(a.date);
    return date >= revenuePeriodStart && date <= revenuePeriodEnd &&
      (!ownProfile || a.professionalId === activeProfile?.professionalId);
  });
  const paymentTotals = PAYMENT_METHODS.reduce<Record<PayMethod, number>>((totals, method) => {
    totals[method] = 0;
    return totals;
  }, {} as Record<PayMethod, number>);
  const expenseTotals = PAYMENT_METHODS.reduce<Record<PayMethod, number>>((totals, method) => {
    totals[method] = 0;
    return totals;
  }, {} as Record<PayMethod, number>);
  let expensesWithoutPaymentMethod = 0;
  appointments
    .filter(appointment =>
      paymentPeriodMatches(appointment.date) &&
      (appointment.status === 'confirmed' || appointment.status === 'completed')
    )
    .forEach(appointment => {
      const payments = appointment.paymentSplits?.length
        ? appointment.paymentSplits
        : [{ method: appointment.payMethod, amount: appointment.value + (appointment.tip || 0) }];
      payments.forEach(payment => {
        if (payment.method in paymentTotals) {
          paymentTotals[payment.method] += Number(payment.amount) || 0;
        }
      });
    });
  prothesisSales.filter(sale => paymentPeriodMatches(sale.date)).forEach(sale => {
    const paidAmount = sale.installments > 0
      ? (sale.value / sale.installments) * sale.installmentsPaid
      : 0;
    if (sale.payMethod1 in paymentTotals) paymentTotals[sale.payMethod1] += paidAmount;
  });
  subscriptionReceiptsInPeriod.forEach(payment => {
    if (payment.paymentMethod && payment.paymentMethod in paymentTotals) {
      paymentTotals[payment.paymentMethod] += payment.amount;
    }
  });
  productSales.filter(sale => paymentPeriodMatches(sale.date)).forEach(sale => {
    paymentTotals[sale.paymentMethod] += sale.total;
  });
  productSales.filter(sale => sale.reversalDate && paymentPeriodMatches(sale.reversalDate)).forEach(sale => {
    paymentTotals[sale.paymentMethod] -= sale.total;
  });
  expenses.filter(expense => paymentPeriodMatches(expense.date)).forEach(expense => {
    if (expense.paymentMethod && expense.paymentMethod in expenseTotals) {
      expenseTotals[expense.paymentMethod] += expense.amount;
    } else {
      expensesWithoutPaymentMethod += expense.amount;
    }
  });
  const revenueByProfessional: Record<string, number> = {};
  revenueAppointments.forEach(a => {
    revenueByProfessional[a.professionalId] = (revenueByProfessional[a.professionalId] || 0) + a.value + (a.tip || 0);
  });

  const chartData = professionals.map(p => ({
    name: p.name,
    fullName: p.name,
    total: revenueByProfessional[p.id] || 0,
  })).filter(d => d.total > 0).sort((a, b) => b.total - a.total);
  const revenueTotal = chartData.reduce((sum, entry) => sum + entry.total, 0);
  const formatPercentage = (value: number) =>
    `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const chartColors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];
  const receptionPaymentData = receptionOperations
    ? [
        ...PAYMENT_METHODS.map(method => ({
          key: method,
          name: RECEPTION_PAYMENT_LABELS[method],
          value: receptionOperations.incomeByMethod[method],
        })),
        {
          key: 'planos' as const,
          name: RECEPTION_PAYMENT_LABELS.planos,
          value: receptionOperations.planReceiptTotal,
        },
      ].map((entry, index) => ({
        ...entry,
        color: chartColors[index % chartColors.length],
      }))
    : [];
  const receptionPaymentTotal = receptionPaymentData.reduce((sum, entry) => sum + entry.value, 0);
  const revenuePeriodLabels = {
    diaria: 'Diária',
    semanal: 'Semanal',
    mensal: 'Mensal',
  } as const;

  const lowStock = ownProfile ? 0 : products.filter(p => productStatus(p) === 'low').length;
  const critStock = ownProfile ? 0 : products.filter(p => productStatus(p) === 'critical').length;

  const todayDate = new Date();
  const prothesisAlerts = prothesisSales.filter(ps => {
    const lastM = ps.lastMaintenance ? parseDateKey(ps.lastMaintenance) : parseDateKey(ps.date);
    const diffDays = Math.ceil(Math.abs(todayDate.getTime() - lastM.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 10;
  });

  const mentoriaToday = mentoriaSessions.filter(m =>
    m.date === today &&
    m.status === 'scheduled' &&
    (!ownProfile || m.sellerId === activeProfile?.professionalId)
  );
  const visibleProthesisAlerts = ownProfile
    ? prothesisAlerts.filter(sale => sale.sellerId === activeProfile?.professionalId)
    : prothesisAlerts;
  const sortedAppointments = [...todayAppointments].sort((a, b) => a.time.localeCompare(b.time));

  const STATUS_LABEL: Record<string, string> = {
    confirmed: 'Confirmado',
    pending: 'Pendente',
    checked_in: 'Em atendimento',
    completed: 'Concluído',
    no_show: 'Faltou',
    cancelled: 'Cancelado',
  };
  const STATUS_CLASS: Record<string, string> = {
    confirmed: 'bg-success/10 text-success', pending: 'bg-warning/10 text-warning',
    checked_in: 'bg-warning/10 text-warning', completed: 'bg-success/10 text-success',
    no_show: 'bg-destructive/10 text-destructive', cancelled: 'bg-muted/50 text-muted-foreground',
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-5 md:space-y-8 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-xl font-bold text-foreground sm:text-2xl">Visão geral</h2>
            <FeatureInfo label="Visão geral">{ownProfile ? 'Acompanhe apenas os resultados atribuídos ao seu perfil.' : 'Acompanhe a operação do estabelecimento hoje.'}</FeatureInfo>
          </div>
        </div>
        {(canOpenControl || canOpenAgenda) && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {canOpenControl && (
              <Link
                href="/controle"
                data-testid="dashboard-quick-attendance"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-gold px-3 py-2 text-center text-xs font-bold text-brand-bg transition-colors hover:bg-brand-gold/90 sm:px-4 sm:text-sm"
              >
                Registrar atendimento <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
            )}
            {canOpenAgenda && (
              <Link
                href="/agenda"
                data-testid="dashboard-quick-agenda"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-surface px-3 py-2 text-center text-xs font-semibold text-foreground transition-colors hover:border-brand-gold/50 sm:px-4 sm:text-sm"
              >
                Abrir agenda <CalendarCheck className="h-4 w-4 shrink-0 text-brand-gold" />
              </Link>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {isReceptionist
            ? <StatsCard label="Agendados (Hoje)" value={todayAppointments.length} icon={<CalendarCheck className="w-5 h-5" />} colorClass="text-brand-gold" />
            : <StatsCard label="Faturamento (Hoje)" value={revenue} icon={<DollarSign className="w-5 h-5" />} colorClass="text-brand-gold" format={(v: number) => brl(v)} />}
          <StatsCard label="Concluídos (Hoje)" value={completed} icon={<CalendarCheck className="w-5 h-5" />} colorClass="text-success" />
          <StatsCard label="Aguardando (Hoje)" value={awaiting} icon={<Clock className="w-5 h-5" />} colorClass="text-warning" />
          {isReceptionist
            ? <StatsCard label="Em atendimento" value={checkedIn} icon={<LogIn className="w-5 h-5" />} colorClass="text-warning" />
            : <StatsCard label={ownProfile ? "Meu faturamento (Hoje)" : "Destaque (Hoje)"} value={maxRev > 0 ? maxRev : 0} icon={<Trophy className="w-5 h-5" />} colorClass="text-primary" format={(v: number) => v > 0 ? (ownProfile ? brl(v) : (topProf?.name || '-')) : brl(v)} />}
        </div>
      )}

      {canViewFinancialSummary && (isLoading ? (
        <Skeleton className="h-56 rounded-2xl" />
      ) : (
        <section data-testid="payment-method-summary-card" className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-lg font-bold text-foreground">Entradas e saídas por forma de pagamento</h3>
                <FeatureInfo label="Entradas e saídas">Consulte os valores recebidos e pagos em cada forma de pagamento no período selecionado.</FeatureInfo>
              </div>
            </div>
            <div className="flex w-fit items-center rounded-lg border border-brand-border bg-brand-bg p-1" role="group" aria-label="Período das movimentações financeiras">
              {(Object.keys(revenuePeriodLabels) as Array<keyof typeof revenuePeriodLabels>).map(period => (
                <button
                  key={period}
                  type="button"
                  aria-pressed={revenuePeriod === period}
                  onClick={() => setRevenuePeriod(period)}
                  className={`min-h-10 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    revenuePeriod === period
                      ? 'bg-brand-gold text-brand-bg'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {revenuePeriodLabels[period]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {PAYMENT_METHODS.map(method => (
              <div key={method} className={`min-w-0 rounded-xl border p-3 md:p-4 ${PAYMENT_CARD_STYLES[method]}`}>
                <p className="text-xs font-semibold uppercase text-muted-foreground">{PAY_LABELS[method]}</p>
                <div className="mt-3 space-y-1.5 text-sm">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Entrou</span>
                    <strong className={`shrink-0 ${PAYMENT_VALUE_STYLES[method]}`}>{brl(paymentTotals[method])}</strong>
                  </p>
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Saiu</span>
                    <strong className="shrink-0 text-destructive">{brl(expenseTotals[method])}</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
          <section data-testid="dashboard-plan-receipts" className="mt-4 rounded-xl border border-brand-border bg-brand-bg p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1">
                  <h4 className="text-sm font-semibold text-foreground">Mensalidades de planos recebidas</h4>
                  <FeatureInfo label="Mensalidades de planos">Mostra somente pagamentos confirmados no período selecionado.</FeatureInfo>
                </div>
              </div>
                    <strong className="text-sm text-success">{brl(subscriptionRevenueInPeriod)}</strong>
            </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 border-t border-brand-border pt-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Parte do salão registrada</p>
                      <strong className="text-sm text-foreground">{brl(planFinanceInPeriod.salonShareTotal)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Parte profissional reservada</p>
                      <strong className="text-sm text-foreground">{brl(planFinanceInPeriod.professionalPoolTotal)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Comissões reconhecidas nos usos</p>
                      <strong className="text-sm text-brand-gold">{brl(planFinanceInPeriod.commissionsRecognizedOnUses)}</strong>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Comissões dos usos não são novas entradas. Rateios antigos sem percentual salvo não entram nas parcelas do salão/profissionais.
                  </p>
                  {planFinanceInPeriod.receiptsWithoutSplit > 0 && (
                    <p className="mt-2 text-xs text-warning">
                      {brl(planFinanceInPeriod.receiptsWithoutSplit)} em recebimentos antigos sem rateio salvo.
                    </p>
                  )}
            {subscriptionReceiptsInPeriod.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">Nenhuma mensalidade paga neste período.</p>
            ) : (
              <div className="mt-3 divide-y divide-brand-border/70">
                {subscriptionReceiptsInPeriod.slice(0, 3).map(payment => {
                  const subscriber = subscribers.find(item => item.id === payment.subscriberId);
                  const plan = plans.find(item => item.id === subscriber?.planId);
                  return (
                    <div
                      key={payment.id}
                      data-testid="dashboard-plan-receipt"
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {subscriber?.name ?? 'Assinante removido'}
                          <span className="font-normal text-muted-foreground"> · {plan?.name ?? 'Plano'}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {parseDateKey(payment.receiptDate).toLocaleDateString('pt-BR')}
                          {payment.paymentMethod ? ` · ${PAY_LABELS[payment.paymentMethod]}` : ''}
                        </p>
                      </div>
                      <strong className="text-sm text-success">{brl(payment.amount)}</strong>
                    </div>
                  );
                })}
              </div>
            )}
            {subscriptionReceiptsInPeriod.length > 3 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Mostrando 3 de {subscriptionReceiptsInPeriod.length} recebimentos.
              </p>
            )}
          </section>
          {expensesWithoutPaymentMethod > 0 && (
            <p className="mt-3 text-xs text-warning">
              {brl(expensesWithoutPaymentMethod)} em despesas antigas sem forma de pagamento.
            </p>
          )}
        </section>
      ))}

      {isReceptionist && (
        receptionOperationsError ? (
          <section data-testid="reception-daily-operations-error" role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Não foi possível carregar o resumo operacional de hoje. Atualize a página ou tente novamente.
          </section>
        ) : (
          <section data-testid="reception-daily-operations" className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-5 md:p-6">
            <div className="mb-5 flex items-center gap-1">
              <h3 className="text-lg font-bold text-foreground">Movimento operacional de hoje</h3>
              <FeatureInfo label="Movimento operacional">Entradas e saídas são exibidas de forma agregada. Este resumo não libera o acesso à aba Financeiro.</FeatureInfo>
            </div>
            {!receptionOperations ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-xl border border-brand-border bg-brand-bg p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Atendimentos</p>
                    <strong data-testid="reception-attendance-count" className="mt-2 block text-2xl text-foreground">{receptionOperations.attendances}</strong>
                  </div>
                  <div className="rounded-xl border border-success/30 bg-success/5 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Entradas operacionais</p>
                   <strong data-testid="reception-income-total" className="mt-2 block text-xl text-success">
                     {brl(receptionOperations.incomeTotal + receptionOperations.planReceiptTotal)}
                   </strong>
                  </div>
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Saídas</p>
                    <strong data-testid="reception-expense-total" className="mt-2 block text-xl text-destructive">{brl(receptionOperations.expenseTotal)}</strong>
                  </div>
                  <div className="rounded-xl border border-brand-gold/30 bg-brand-gold/5 p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Usos de plano</p>
                    <strong data-testid="reception-plan-use-count" className="mt-2 block text-2xl text-brand-gold">{receptionOperations.planUses}</strong>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-brand-border bg-brand-bg p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1">
                        <h4 className="text-sm font-semibold text-foreground">Mensalidades de planos recebidas</h4>
                        <FeatureInfo label="Mensalidades no total">O total recebido já está incluído nas entradas operacionais acima.</FeatureInfo>
                      </div>
                    </div>
                    <strong data-testid="reception-plan-receipt-total" className="text-sm text-success">{brl(todayPlanFinance.receiptTotal)}</strong>
                  </div>
                  <div className="mb-3 grid grid-cols-1 gap-2 border-b border-brand-border pb-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Parte do salão</p>
                      <strong className="text-sm text-foreground">{brl(todayPlanFinance.salonShareTotal)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Parte profissional reservada</p>
                      <strong className="text-sm text-foreground">{brl(todayPlanFinance.professionalPoolTotal)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Comissões reconhecidas nos usos</p>
                      <strong className="text-sm text-brand-gold">{brl(todayPlanFinance.commissionsRecognizedOnUses)}</strong>
                    </div>
                  </div>
                  {todayPlanFinance.receiptsWithoutSplit > 0 && (
                    <p className="mb-3 text-xs text-warning">
                      {brl(todayPlanFinance.receiptsWithoutSplit)} em recebimentos antigos sem rateio salvo.
                    </p>
                  )}
                  <section
                    data-testid="reception-payment-breakdown"
                    aria-labelledby="reception-payment-breakdown-title"
                    className="mt-4 rounded-xl border border-brand-border bg-brand-bg p-3 sm:p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 id="reception-payment-breakdown-title" className="text-sm font-semibold text-foreground">Entradas por forma de pagamento</h4>
                      </div>
                      <strong data-testid="reception-payment-total" className="text-sm text-success">{brl(receptionPaymentTotal)}</strong>
                    </div>
                    {receptionPaymentTotal > 0 ? (
                      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.85fr)] sm:gap-5">
                        <div className="h-56 min-w-0" role="img" aria-label="Gráfico de pizza das entradas de hoje por forma de pagamento">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={receptionPaymentData.filter(entry => entry.value > 0)}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius="82%"
                                paddingAngle={2}
                                stroke="hsl(var(--brand-bg))"
                                strokeWidth={2}
                              >
                                {receptionPaymentData.filter(entry => entry.value > 0).map(entry => (
                                  <Cell key={`reception-payment-${entry.key}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ backgroundColor: 'hsl(var(--brand-surface))', borderColor: 'hsl(var(--brand-border))', color: 'hsl(var(--foreground))' }}
                                formatter={(value: number) => [brl(value), 'Entrada']}
                                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-3" role="list" aria-label="Valores por forma de pagamento">
                          {receptionPaymentData.map(entry => (
                            <div key={entry.key} data-testid={`reception-payment-legend-${entry.key}`} className="flex items-center justify-between gap-3 text-sm" role="listitem">
                              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="truncate">{entry.name}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                <strong className="font-semibold text-foreground">{brl(entry.value)}</strong>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {receptionPaymentTotal > 0 ? `${((entry.value / receptionPaymentTotal) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '0%'}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma entrada registrada hoje.</p>
                    )}
                  </section>
                  {receptionOperations.incomeWithoutMethod > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {brl(receptionOperations.incomeWithoutMethod)} em entradas antigas sem forma de pagamento.
                    </p>
                  )}
                  {receptionOperations.planReceiptsByMethod.sem_forma > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {brl(receptionOperations.planReceiptsByMethod.sem_forma)} em mensalidades antigas sem forma de pagamento.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        )
      )}

      {(lowStock > 0 || critStock > 0) && (
        <Link href="/produtos" className="bg-destructive/10 border border-destructive/20 rounded-2xl p-5 md:p-6 flex items-start gap-4 md:gap-5 transition-colors hover:bg-destructive/15">
          <div className="p-3 bg-destructive/20 text-destructive rounded-xl border border-destructive/30 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-lg font-bold text-destructive-foreground">Atenção ao Estoque</h4>
            <p className="text-destructive-foreground/90 text-sm mt-1.5 leading-relaxed">
              Você tem <strong>{critStock} produto(s)</strong> com estoque crítico e <strong>{lowStock} produto(s)</strong> com estoque baixo.
            </p>
          </div>
          <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-destructive" />
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-foreground">Atendimentos de Hoje</h3>
                <Link href="/agenda" className="text-xs font-semibold text-brand-gold md:hidden">Gerenciar</Link>
              </div>
            {isLoading ? (
              <div className="space-y-3">{Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : sortedAppointments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <CalendarCheck className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Nenhum atendimento para hoje</p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-brand-border text-muted-foreground">
                        <th className="pb-3 font-medium">Horário</th>
                        <th className="pb-3 font-medium">Cliente</th>
                        <th className="pb-3 font-medium">Profissional</th>
                        <th className="pb-3 font-medium">Serviço</th>
                        {!isReceptionist && <th className="pb-3 font-medium">Valor</th>}
                        <th className="pb-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAppointments.map(a => (
                        <tr key={a.id} className="border-b border-brand-border/50 hover:bg-brand-bg/50 transition-colors">
                          <td className="py-3 font-mono">{a.time}</td>
                          <td className="py-3 font-medium">{a.client}</td>
                          <td className="py-3 text-muted-foreground">{professionals.find(p => p.id === a.professionalId)?.name || 'Profissional removido'}</td>
                          <td className="py-3">{a.serviceDescription || a.service}</td>
                          {!isReceptionist && <td className="py-3">{brl(a.value + (a.tip || 0))}</td>}
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[a.attendanceRecordedAt && a.status === 'confirmed' ? 'completed' : a.status] || STATUS_CLASS.cancelled}`}>
                              {a.attendanceRecordedAt && a.status === 'confirmed' ? 'Concluído' : STATUS_LABEL[a.status] || a.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {sortedAppointments.map(a => (
                    <div key={a.id} className="rounded-xl border border-brand-border bg-brand-bg p-3 sm:p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-sm">{a.client}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{professionals.find(p => p.id === a.professionalId)?.name || 'Profissional removido'} • {a.serviceDescription || a.service}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ml-2 ${STATUS_CLASS[a.status] || STATUS_CLASS.cancelled}`}>
                          {STATUS_LABEL[a.status] || a.status}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="font-mono">{a.time}</span>
                        {!isReceptionist && <span className="font-bold text-foreground">{brl(a.value + (a.tip || 0))}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {!ownProfile && !isReceptionist && <div data-testid="professional-revenue-card" className="bg-brand-surface border border-brand-border rounded-2xl p-6">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-foreground">Faturamento por Profissional</h3>
              <p className="mt-1 text-xs text-muted-foreground">Período: {revenuePeriodLabels[revenuePeriod]}</p>
            </div>
            {chartData.length === 0 ? (
               <div className="text-center py-12 text-muted-foreground">
                <Trophy className="w-12 h-12 mx-auto mb-4 opacity-30" />
                 <p className="text-sm">Nenhum faturamento registrado no período selecionado</p>
              </div>
            ) : (
               <>
                 <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                       <Pie
                         data={chartData}
                         dataKey="total"
                         nameKey="name"
                         cx="50%"
                         cy="44%"
                         outerRadius="68%"
                         paddingAngle={2}
                         stroke="hsl(var(--brand-surface))"
                         strokeWidth={2}
                       >
                         {chartData.map((entry, index) => (
                           <Cell key={`revenue-cell-${entry.name}`} fill={chartColors[index % chartColors.length]} />
                         ))}
                       </Pie>
                       <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--brand-surface))', borderColor: 'hsl(var(--brand-border))', color: 'hsl(var(--foreground))' }}
                        formatter={(val: number) => [brl(val), 'Faturamento']}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      />
                       <Legend
                         verticalAlign="bottom"
                         iconType="circle"
                         wrapperStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                       />
                     </PieChart>
                  </ResponsiveContainer>
                </div>
                 <div
                   className="mt-4 grid gap-2 border-t border-brand-border pt-4"
                   aria-label="Detalhamento do faturamento por profissional"
                   role="list"
                 >
                   {chartData.map(entry => (
                     <div
                       key={`revenue-detail-${entry.name}`}
                       data-testid="revenue-professional-row"
                       className="flex items-center justify-between gap-4 text-sm"
                       role="listitem"
                     >
                       <span className="min-w-0 truncate text-muted-foreground">{entry.fullName}</span>
                       <span className="shrink-0 font-semibold text-foreground">
                         {brl(entry.total)} · {formatPercentage((entry.total / revenueTotal) * 100)}
                       </span>
                     </div>
                   ))}
                 </div>
               </>
            )}
          </div>}
        </div>

        <div className="space-y-6">
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Agenda de Prótese & Mentoria</h3>
            <div className="space-y-4">
              {mentoriaToday.length === 0 && visibleProthesisAlerts.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Nada agendado/pendente para hoje</p>
                </div>
              )}
              
              {mentoriaToday.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Mentorias (Hoje)</h4>
                  <div className="space-y-2">
                    {mentoriaToday.map(m => (
                      <div key={m.id} className="p-3 bg-brand-bg rounded-xl border border-brand-border/50">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm text-foreground">{m.client}</p>
                            <p className="text-xs text-muted-foreground mt-1">Com: {professionals.find(p => p.id === m.sellerId)?.name || 'Profissional removido'}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">Mentoria</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visibleProthesisAlerts.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Manutenções Prótese</h4>
                  <div className="space-y-2">
                    {visibleProthesisAlerts.map(p => (
                      <div key={p.id} className="p-3 bg-destructive/5 rounded-xl border border-destructive/20">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium text-sm text-destructive-foreground">{p.client}</p>
                            <p className="text-xs text-destructive-foreground/70 mt-1">Vendedor: {professionals.find(prof => prof.id === p.sellerId)?.name || 'Profissional removido'}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-destructive/10 text-destructive">Alerta</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore, brl, productStatus, EXPENSE_CATEGORIES, PAY_LABELS, ExpenseCategory, PayMethod, PaymentSplit, ProfessionalCommissions, SubscriptionPlan } from '@/data/store';
import { useAuth } from '@/auth/auth';
import { FeatureInfo } from '@/components/FeatureInfo';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react';
import { addSubscriptionCycle, formatDateKey } from '@/data/date';
import { subscriptionReceiptDate } from '@/data/subscription-payment';
import { canDeleteAttendance } from '@/data/attendance-deletion';
import { api } from '@/data/api';
import { normalizeClientPhone } from '@/data/client-phone';
import { useTemporaryFormState } from '@/data/form-drafts';
import { isAssignableProfessional } from '@/data/professional-selection';
import {
  planProfessionalAmountForUse,
  planProfessionalPoolAmount,
  planSalonAmountForUse,
  planSalonShareAmount,
  planServiceBenefits,
  planValuePerUse,
  subscriberPlanUsageCount,
  subscriberServiceUsesRemaining,
  totalPlanIncludedUses,
} from '@/data/plan-usage';
import {
  appointmentProductsChargeTotal,
  clampManualCommissionAmount,
  manualCommissionAmountLimit,
  manualCommissionAllocationMatches,
  manualCommissionAllocationMatchesTarget,
  automaticProsthesisProductId,
  professionalCommissionPool,
  prosthesisCommissionForProfessional,
  prosthesisProductCost,
  PROFESSIONAL_SERVICE_COMMISSION_RATE,
} from '@/data/appointment-commissions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function normalizeClientSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

export default function Controle() {
  const { 
    professionals, products, appointments, expenses, config, plans, subscribers, subscriptionPayments,
    clients, addClient, removeClient, addVisit, removeVisit,
    addPlan, addSubscriber, setSubscriptionPaymentStatus,
    addAppointment, addExpense, removeAppointment, removeExpense, sellProduct, restock, isLoading
  } = useStore();
  const { profile, viewAsProfile } = useAuth();
  const session = viewAsProfile ?? profile;
  const isReceptionist = session?.role === 'recepcao';

  const today = formatDateKey();
  const activeProfs = professionals.filter(p => p.isActive && isAssignableProfessional(p));

  // Form states
  const [clientLookupField, setClientLookupField] = useState<'name' | 'phone' | null>(null);
  const [activeClientIndex, setActiveClientIndex] = useState(-1);
  const [selectedClientId, setSelectedClientId, clearSelectedClientDraft] = useTemporaryFormState('attendance:selected-client', 'controle', '');
  const [client, setClient, clearClientDraft] = useTemporaryFormState('attendance:client-name', 'controle', '');
  const [clientPhone, setClientPhone, clearClientPhoneDraft] = useTemporaryFormState('attendance:client-phone', 'controle', '');
  const [anonymousAttendance, setAnonymousAttendance, clearAnonymousDraft] = useTemporaryFormState('attendance:anonymous', 'controle', false);
  const [service, setService, clearServiceDraft] = useTemporaryFormState('attendance:service', 'controle', 'Barbearia');
  const [serviceDescription, setServiceDescription, clearServiceDescriptionDraft] = useTemporaryFormState('attendance:service-description', 'controle', 'Barbearia');
  const [serviceId, setServiceId, clearServiceIdDraft] = useTemporaryFormState('attendance:service-id', 'controle', '');
  const [planSubscriberId, setPlanSubscriberId, clearPlanSubscriberDraft] = useTemporaryFormState('attendance:subscriber', 'controle', '');
  const [showAssignPlan, setShowAssignPlan, clearAssignPlanOpenDraft] = useTemporaryFormState('attendance:assign-plan-open', 'controle', false);
  const [showCreatePlan, setShowCreatePlan, clearCreatePlanOpenDraft] = useTemporaryFormState('attendance:create-plan-open', 'controle', false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [assignPlanId, setAssignPlanId, clearAssignPlanDraft] = useTemporaryFormState('attendance:assign-plan', 'controle', '');
  const [confirmPlanPayment, setConfirmPlanPayment, clearPlanPaymentConfirmationDraft] = useTemporaryFormState('attendance:assign-plan-confirm-payment', 'controle', false);
  const [assignPlanPaymentMethod, setAssignPlanPaymentMethod, clearPlanPaymentMethodDraft] = useTemporaryFormState('attendance:assign-plan-payment-method', 'controle', 'pix' as PayMethod);
  const [createPlanForm, setCreatePlanForm, clearCreatePlanFormDraft] = useTemporaryFormState(
    'attendance:create-plan-form',
    'controle',
    {
      name: '',
      price: '',
      duration: 'Mensal' as SubscriptionPlan['duration'],
      salonSharePercent: '',
      services: [{ serviceId: '', usesPerCycle: '1' }],
    },
  );
  const clearPlanAssignmentDraft = () => {
    clearAssignPlanOpenDraft();
    clearAssignPlanDraft();
    clearPlanPaymentConfirmationDraft();
    clearPlanPaymentMethodDraft();
  };
  const [isAssigningPlan, setIsAssigningPlan] = useState(false);
  const [profId, setProfId, clearProfessionalDraft] = useTemporaryFormState('attendance:professional', 'controle', '');
  const [additionalProfessionalIds, setAdditionalProfessionalIds, clearAdditionalProfessionalsDraft] = useTemporaryFormState('attendance:additional-professionals', 'controle', [] as string[]);
  const [manualCommissionAmounts, setManualCommissionAmounts, clearManualCommissionsDraft] = useTemporaryFormState('attendance:commissions', 'controle', {} as Record<string, string>);
  const [sellerProfessionalId, setSellerProfessionalId, clearSellerDraft] = useTemporaryFormState('attendance:seller', 'controle', '');
  const [value, setValue, clearValueDraft] = useTemporaryFormState('attendance:value', 'controle', '');
  const [tip, setTip, clearTipDraft] = useTemporaryFormState('attendance:tip', 'controle', '');
  const [payMethod, setPayMethod, clearPayMethodDraft] = useTemporaryFormState('attendance:payment-method', 'controle', 'pix' as PayMethod);
  const [notes, setNotes, clearNotesDraft] = useTemporaryFormState('attendance:notes', 'controle', '');
  const [apptProducts, setApptProducts, clearAppointmentProductsDraft] = useTemporaryFormState('attendance:products', 'controle', [] as Array<{
    productId: string;
    quantity: number;
    isAutoAssigned?: boolean;
  }>);
  const [paymentSplits, setPaymentSplits, clearPaymentSplitsDraft] = useTemporaryFormState('attendance:payments', 'controle', [] as PaymentSplit[]);
  const clearAttendanceDraft = () => {
    clearSelectedClientDraft();
    clearClientDraft();
    clearClientPhoneDraft();
    clearAnonymousDraft();
    clearServiceDraft();
    clearServiceDescriptionDraft();
    clearServiceIdDraft();
    clearPlanSubscriberDraft();
    clearCreatePlanFormDraft();
    clearCreatePlanOpenDraft();
    clearAssignPlanDraft();
    clearProfessionalDraft();
    clearAdditionalProfessionalsDraft();
    clearManualCommissionsDraft();
    clearSellerDraft();
    clearValueDraft();
    clearTipDraft();
    clearPayMethodDraft();
    clearNotesDraft();
    clearAppointmentProductsDraft();
    clearPaymentSplitsDraft();
  };
  const pendingAttendanceFocus = useRef<{
    kind: 'product' | 'additional-professional' | 'payment';
    index: number;
  } | null>(null);
  const productSelectRefs = useRef<(HTMLSelectElement | null)[]>([]);
  const additionalProfessionalSelectRefs = useRef<(HTMLSelectElement | null)[]>([]);
  const paymentMethodSelectRefs = useRef<(HTMLSelectElement | null)[]>([]);

  useEffect(() => {
    const pendingFocus = pendingAttendanceFocus.current;
    if (!pendingFocus) return;

    const target = pendingFocus.kind === 'product'
      ? productSelectRefs.current[pendingFocus.index]
      : pendingFocus.kind === 'additional-professional'
        ? additionalProfessionalSelectRefs.current[pendingFocus.index]
        : paymentMethodSelectRefs.current[pendingFocus.index];
    pendingAttendanceFocus.current = null;
    target?.focus();
  }, [apptProducts.length, additionalProfessionalIds.length, paymentSplits.length]);

  // Expense form
  const [expDate, setExpDate, clearExpenseDateDraft] = useTemporaryFormState('daily-expense:date', 'controle', today);
  const [expDesc, setExpDesc, clearExpenseDescriptionDraft] = useTemporaryFormState('daily-expense:description', 'controle', '');
  const [expAmount, setExpAmount, clearExpenseAmountDraft] = useTemporaryFormState('daily-expense:amount', 'controle', '');
  const [expCategory, setExpCategory, clearExpenseCategoryDraft] = useTemporaryFormState('daily-expense:category', 'controle', 'Outros' as ExpenseCategory);

  const ownProfile = Boolean(
    session?.professionalId
    && session.role !== 'gestor'
    && session.role !== 'dev-admin'
    && session.role !== 'recepcao',
  );
  const resolvedProfId = ownProfile ? session?.professionalId : profId;
  const assignedProfessionalIds = [...new Set([resolvedProfId, ...additionalProfessionalIds].filter(
    (id): id is string => Boolean(id),
  ))];
  const assignedProfessionalNames = assignedProfessionalIds
    .map(id => professionals.find(professional => professional.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const appointmentProfessionalLabel = (appointment: typeof appointments[number]) => {
    const professionalIds = appointment.professionalCommissions && appointment.professionalCommissions.length > 1
      ? appointment.professionalCommissions.map(assignment => assignment.professionalId)
      : [appointment.professionalId];
    return [...new Set(professionalIds)]
      .map(id => professionals.find(professional => professional.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ') || 'Profissional não disponível';
  };
  const isManualCommissionMode = assignedProfessionalIds.length > 1;
  const selectedProf = professionals.find(p => p.id === resolvedProfId);
  const selectedSellerId = sellerProfessionalId || resolvedProfId || '';
  const selectedSeller = professionals.find(p => p.id === selectedSellerId);
  const normalizedClientPhone = normalizeClientPhone(clientPhone);
  const selectedClient = clients.find(item => item.id === selectedClientId);
  const selectedPlanSubscriber = subscribers.find(item => item.id === planSubscriberId);
  const selectedPlan = plans.find(item => item.id === selectedPlanSubscriber?.planId);
  const planSalonSharePercentForUsage = selectedPlanSubscriber?.salonSharePercentSnapshot ?? null;
  const selectedPlanForUsage = selectedPlan
    ? { ...selectedPlan, salonSharePercent: planSalonSharePercentForUsage }
    : undefined;
  const planBenefits = planServiceBenefits(selectedPlan);
  const serviceItem = config.services.find(s => s.id === serviceId && (s.isActive || Boolean(selectedPlanSubscriber)))
    ?? config.services.find(s => s.name === service && s.isActive)
    ?? config.services.find(s => s.isActive);
  const isProsthesisApplication = serviceItem?.commissionKey === 'protese';
  const autoProsthesisProductId = automaticProsthesisProductId(products);
  const hasProsthesisProductSelected = apptProducts.some(item =>
    item.quantity > 0
    && products.some(product => product.id === item.productId && product.isProsthesisCapillary),
  );
  const markedProsthesisProducts = products.filter(product => product.isActive && product.isProsthesisCapillary);
  const selectedPlanBenefit = planBenefits.find(benefit => benefit.serviceId === serviceId);
  const isPlanMode = Boolean(selectedPlanSubscriber);
  const isPlanAttendance = Boolean(isPlanMode && selectedPlanBenefit);
  const usesConfiguredPlanSplit = Boolean(isPlanAttendance && planSalonSharePercentForUsage != null);
  const planUseOrdinal = isPlanAttendance && selectedPlanSubscriber
    ? subscriberPlanUsageCount(appointments, selectedPlanSubscriber) + 1
    : 1;
  const planTotalUses = totalPlanIncludedUses(selectedPlan);
  const configuredPlanSalonValue = isPlanAttendance
    ? planSalonAmountForUse(selectedPlanForUsage, planUseOrdinal)
    : null;
  const configuredPlanProfessionalValue = isPlanAttendance
    ? planProfessionalAmountForUse(selectedPlanForUsage, planUseOrdinal)
    : null;
  const planSalonValueForUse = usesConfiguredPlanSplit ? configuredPlanSalonValue ?? 0 : 0;
  const planGrossValueForUse = isPlanAttendance
    ? usesConfiguredPlanSplit
      ? planSalonValueForUse + (configuredPlanProfessionalValue ?? 0)
      : planValuePerUse(selectedPlan)
    : 0;
  const planValueForUse = isPlanAttendance
    ? configuredPlanProfessionalValue ?? planGrossValueForUse
    : 0;
  const serviceKey = (serviceItem?.commissionKey ?? 'barbearia') as keyof ProfessionalCommissions;
  const isSalesAttributedService = serviceItem?.commissionKey === 'protese' || serviceItem?.commissionKey === 'mentoria';
  const sellerCommRate = selectedSeller?.commissions[serviceKey] || 0;
  const serviceValue = isPlanMode ? 0 : parseFloat(value) || 0;
  const commissionBaseValue = isPlanAttendance
    ? usesConfiguredPlanSplit ? planValueForUse : planGrossValueForUse
    : serviceValue;
  const commissionBasisDescription = isPlanAttendance
    ? usesConfiguredPlanSplit
      ? 'da parte profissional deste uso do plano'
      : 'do valor rateado deste uso do plano'
    : 'do valor bruto do serviço';
  const prosthesisCost = prosthesisProductCost(apptProducts, products);
  useEffect(() => {
    if (!isProsthesisApplication) {
      setApptProducts(current => {
        const manualProducts = current
          .filter(item => !item.isAutoAssigned)
          .map(({ isAutoAssigned: _isAutoAssigned, ...item }) => item);
        return manualProducts.length === current.length
          && manualProducts.every((item, index) => item === current[index])
          ? current
          : manualProducts;
      });
      return;
    }

    if (!autoProsthesisProductId) return;
    setApptProducts(current => {
      if (current.some(item => item.productId === autoProsthesisProductId)) return current;
      const emptyRowIndex = current.findIndex(item => !item.productId);
      if (emptyRowIndex >= 0) {
        return current.map((item, index) => index === emptyRowIndex
          ? { ...item, productId: autoProsthesisProductId, quantity: 1, isAutoAssigned: true }
          : item);
      }
      return [...current, {
        productId: autoProsthesisProductId,
        quantity: 1,
        isAutoAssigned: true,
      }];
    });
  }, [autoProsthesisProductId, isProsthesisApplication, serviceId]);
  const commissionForAssignedProfessional = (professionalId: string) => {
    const professional = professionals.find(item => item.id === professionalId);
    return isProsthesisApplication
      ? prosthesisCommissionForProfessional(serviceValue, prosthesisCost, professional?.name ?? '')
      : Number(manualCommissionAmounts[professionalId]) || 0;
  };
  const manualAssignments = assignedProfessionalIds.map(id => ({
    professionalId: id,
    amount: commissionForAssignedProfessional(id),
  }));
  const manualCommissionTotal = Math.round((
    manualAssignments.reduce((total, assignment) => total + assignment.amount, 0)
    + Number.EPSILON
  ) * 100) / 100;
  const manualCommissionTarget = isProsthesisApplication
    ? manualCommissionTotal
    : usesConfiguredPlanSplit
      ? planValueForUse
      : professionalCommissionPool(commissionBaseValue);
  const calculatedComm = isManualCommissionMode
    ? manualCommissionTotal
    : isProsthesisApplication && selectedProf
      ? prosthesisCommissionForProfessional(serviceValue, prosthesisCost, selectedProf.name)
      : usesConfiguredPlanSplit
        ? planValueForUse
      : manualCommissionTarget;
  const manualCommissionIsBalanced = isProsthesisApplication
    || (usesConfiguredPlanSplit
      ? manualCommissionAllocationMatchesTarget(manualCommissionTarget, manualAssignments)
      : manualCommissionAllocationMatches(commissionBaseValue, manualAssignments));
  const manualCommissionLimitFor = (professionalId: string) => manualCommissionAmountLimit(
    manualCommissionTarget,
    assignedProfessionalIds
      .filter(id => id !== professionalId)
      .map(id => Number(manualCommissionAmounts[id]) || 0),
  );
  const handleManualCommissionChange = (professionalId: string, rawValue: string) => {
    const parsedAmount = rawValue.trim() === '' ? null : Number(rawValue);
    const limit = manualCommissionLimitFor(professionalId);
    const nextValue = parsedAmount !== null && Number.isFinite(parsedAmount)
      && (parsedAmount < 0 || parsedAmount > limit)
      ? clampManualCommissionAmount(
        manualCommissionTarget,
        assignedProfessionalIds
          .filter(id => id !== professionalId)
          .map(id => Number(manualCommissionAmounts[id]) || 0),
        parsedAmount,
      ).toFixed(2)
      : rawValue;
    setManualCommissionAmounts(current => ({
      ...current,
      [professionalId]: nextValue,
    }));
  };
  const calculatedSellerComm = commissionBaseValue * sellerCommRate;
  const matchedPlanSubscribers = selectedClient
    ? subscribers.filter(subscriber => {
        const subscriberPhone = normalizeClientPhone(subscriber.phone);
        const clientDigits = normalizeClientPhone(selectedClient.whatsapp);
        if (subscriberPhone) return Boolean(clientDigits && subscriberPhone === clientDigits);
        return subscriber.name.trim().toLocaleLowerCase('pt-BR') === selectedClient.name.trim().toLocaleLowerCase('pt-BR');
      })
    : [];
  const usablePlanSubscribers = matchedPlanSubscribers.filter(subscriber =>
    subscriber.status === 'ativo' && subscriber.nextPayment >= today,
  );
  const availablePlanBenefits = (subscriber: typeof subscribers[number]) => {
    const plan = plans.find(item => item.id === subscriber.planId);
    return planServiceBenefits(plan).filter(benefit =>
      subscriberServiceUsesRemaining(appointments, subscriber, benefit) > 0
      && config.services.some(option => option.id === benefit.serviceId),
    );
  };
  const isDuplicateClientPhone = !selectedClientId && normalizedClientPhone.length > 0 && clients.some(
    item => normalizeClientPhone(item.whatsapp) === normalizedClientPhone,
  );
  const clientNameQuery = normalizeClientSearchText(client.trim());
  const clientPhoneQuery = normalizeClientPhone(clientPhone);
  const canSearchClients = clientLookupField === 'name'
    ? clientNameQuery.length >= 2
    : clientLookupField === 'phone'
      ? clientPhoneQuery.length >= 4
      : false;
  const allMatchingClients = canSearchClients
    ? clients
        .filter(item =>
          clientLookupField === 'name'
            ? normalizeClientSearchText(item.name).includes(clientNameQuery)
            : normalizeClientPhone(item.whatsapp).includes(clientPhoneQuery),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    : [];
  const matchingClients = allMatchingClients.slice(0, 8);
  const clientLookupAnnouncement = !selectedClientId && canSearchClients
    ? allMatchingClients.length === 0
      ? 'Nenhum cliente encontrado.'
      : allMatchingClients.length > 8
        ? `Mais de 8 clientes encontrados. Exibindo os 8 primeiros.`
        : `${allMatchingClients.length} ${allMatchingClients.length === 1 ? 'cliente encontrado' : 'clientes encontrados'}.`
    : '';

  const selectClient = (selected: (typeof clients)[number]) => {
    setSelectedClientId(selected.id);
    setClient(selected.name);
    setClientPhone(selected.whatsapp);
    setPlanSubscriberId('');
    setShowAssignPlan(false);
    setConfirmPlanPayment(false);
    setClientLookupField(null);
    setActiveClientIndex(-1);
  };

  const handleClientLookupKeyDown = (
    field: 'name' | 'phone',
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    const isLookupOpen = clientLookupField === field && canSearchClients && !selectedClientId;
    if (event.key === 'Escape' && clientLookupField === field) {
      event.preventDefault();
      setClientLookupField(null);
      setActiveClientIndex(-1);
      return;
    }

    if (!isLookupOpen || matchingClients.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveClientIndex(current => {
        if (event.key === 'ArrowDown') {
          return current < 0 ? 0 : (current + 1) % matchingClients.length;
        }
        return current < 0
          ? matchingClients.length - 1
          : (current - 1 + matchingClients.length) % matchingClients.length;
      });
      return;
    }

    if (event.key === 'Enter' && activeClientIndex >= 0) {
      event.preventDefault();
      const activeClient = matchingClients[activeClientIndex];
      if (activeClient) selectClient(activeClient);
    }
  };

  const clearSelectedClient = () => {
    setSelectedClientId('');
    setPlanSubscriberId('');
    setShowAssignPlan(false);
    setConfirmPlanPayment(false);
    setClient('');
    setClientPhone('');
    setClientLookupField(null);
    setActiveClientIndex(-1);
  };

  const renderClientLookupResults = (field: 'name' | 'phone') => {
    if (
      clientLookupField !== field
      || !canSearchClients
      || selectedClientId
    ) return null;

    return (
      <div
        id={`attendance-client-results-${field}`}
        data-testid={`attendance-client-results-${field}`}
        role="listbox"
        className="mt-1 overflow-hidden rounded-lg border border-brand-border bg-brand-bg"
      >
        {matchingClients.length > 0 ? matchingClients.map(item => (
          <button
            key={item.id}
            id={`attendance-client-option-${field}-${item.id}`}
            type="button"
            role="option"
            aria-selected={matchingClients[activeClientIndex]?.id === item.id}
            tabIndex={-1}
            data-testid={`button-select-attendance-client-${item.id}`}
            onClick={() => selectClient(item)}
            className={`flex w-full items-center justify-between gap-3 border-b border-brand-border px-4 py-2 text-left last:border-b-0 hover:bg-brand-surface ${
              matchingClients[activeClientIndex]?.id === item.id
                ? 'bg-brand-surface ring-2 ring-inset ring-brand-gold'
                : ''
            }`}
          >
            <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{item.whatsapp || 'Sem telefone'}</span>
          </button>
        )) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Nenhum cliente encontrado. Continue com os dados informados para cadastrar.
          </p>
        )}
      </div>
    );
  };

  const handleAddProduct = () => {
    pendingAttendanceFocus.current = { kind: 'product', index: apptProducts.length };
    setApptProducts(current => [...current, { productId: '', quantity: 1 }]);
  };
  const updateApptProduct = (index: number, field: 'productId' | 'quantity', val: any) => {
    const newP = [...apptProducts];
    newP[index] = {
      ...newP[index],
      [field]: val,
      ...(field === 'productId' ? { isAutoAssigned: false } : {}),
    };
    setApptProducts(newP);
  };
  const removeApptProduct = (index: number) => setApptProducts(apptProducts.filter((_, i) => i !== index));

  const totalProducts = appointmentProductsChargeTotal(apptProducts, products, isProsthesisApplication);

  const handleAssignPlan = async () => {
    if (isAssigningPlan) return;
    if (anonymousAttendance) {
      toast.error('Informe o cliente para atribuir um plano.');
      return;
    }
    const plan = plans.find(item => item.id === assignPlanId);
    if (!plan) {
      toast.error('Selecione um plano.');
      return;
    }
    const benefits = planServiceBenefits(plan);
    if (benefits.length === 0) {
      toast.error('Este plano ainda não tem serviços e usos configurados.');
      return;
    }
    const nextPayment = addSubscriptionCycle(today, plan.duration);
    if (!nextPayment) {
      toast.error('Não foi possível calcular o próximo vencimento deste plano.');
      return;
    }

    setIsAssigningPlan(true);
    try {
      let clientRecord = selectedClient;
      if (!clientRecord) {
        if (!client.trim() || normalizedClientPhone.length < 10 || isDuplicateClientPhone) {
          toast.error(isDuplicateClientPhone
            ? 'Selecione o cliente existente pela busca para evitar duplicidade.'
            : 'Informe o nome e o telefone com DDD do cliente.');
          return;
        }
        const savedClient = await addClient({
          name: client.trim(),
          email: '',
          whatsapp: normalizedClientPhone,
          interest: 'barbearia',
        }, undefined, { notifyOnError: false });
        if (!savedClient) return;
        clientRecord = savedClient;
        setSelectedClientId(savedClient.id);
        setClient(savedClient.name);
        setClientPhone(savedClient.whatsapp);
        setClientLookupField(null);
      }

      const existingSubscriber = matchedPlanSubscribers.find(item =>
        item.planId === plan.id && item.status !== 'vencido' && item.nextPayment >= today
      );
      if (existingSubscriber?.status === 'ativo') {
        setPlanSubscriberId(existingSubscriber.id);
        setPaymentSplits([]);
        const benefit = benefits.find(item => item.serviceId === serviceId) ?? benefits[0];
        const includedService = config.services.find(item => item.id === benefit.serviceId);
        if (includedService) {
          setServiceId(includedService.id);
          setService(includedService.name);
          setServiceDescription(includedService.name);
        }
        setValue('0');
        toast.success('Este cliente já tem esse plano ativo; selecionado para o atendimento.');
      clearPlanAssignmentDraft();
        return;
      }
      const subscriber = existingSubscriber ?? await addSubscriber({
        name: clientRecord.name,
        phone: clientRecord.whatsapp,
        planId: plan.id,
        startDate: today,
        nextPayment,
        status: 'pendente',
      });
      if (!subscriber) return;

      if (!confirmPlanPayment) {
        toast.success(existingSubscriber
          ? 'A assinatura já está pendente. Confirme o pagamento para liberar os usos.'
          : 'Plano atribuído como pendente. Confirme o pagamento para liberar os usos.');
        clearPlanAssignmentDraft();
        return;
      }

      const paymentSaved = await setSubscriptionPaymentStatus({
        subscriberId: subscriber.id,
        dueDate: subscriber.nextPayment,
        status: 'pago',
        paidAt: today,
        amount: plan.price,
        paymentMethod: assignPlanPaymentMethod,
        note: 'Mensalidade inicial recebida no Controle Diário',
      });
      if (!paymentSaved) {
        toast.warning('Plano atribuído, mas o pagamento não foi confirmado. Confirme a mensalidade antes de usar o plano.');
        clearPlanAssignmentDraft();
        return;
      }

      setPlanSubscriberId(subscriber.id);
      setPaymentSplits([]);
      const benefit = benefits.find(item => item.serviceId === serviceId) ?? benefits[0];
      const includedService = config.services.find(item => item.id === benefit.serviceId);
      if (includedService) {
        setServiceId(includedService.id);
        setService(includedService.name);
        setServiceDescription(includedService.name);
      }
      setValue('0');
      toast.success('Plano atribuído e mensalidade confirmada. O uso será descontado ao salvar o atendimento.');
      clearPlanAssignmentDraft();
    } finally {
      setIsAssigningPlan(false);
    }
  };

  const handleCreatePlanForAttendance = async () => {
    if (isCreatingPlan) return;
    const price = Number(createPlanForm.price);
    const salonSharePercent = Number(createPlanForm.salonSharePercent);
    const validServices = createPlanForm.services.map(item => {
      const configuredService = config.services.find(serviceOption => serviceOption.id === item.serviceId);
      return {
        serviceId: item.serviceId,
        serviceName: configuredService?.name ?? '',
        usesPerCycle: Number(item.usesPerCycle),
      };
    });
    if (
      !createPlanForm.name.trim()
      || !createPlanForm.price.trim()
      || !Number.isFinite(price)
      || price < 0
      || !createPlanForm.salonSharePercent.trim()
      || !Number.isFinite(salonSharePercent)
      || salonSharePercent < 0
      || salonSharePercent > 100
      || validServices.length === 0
      || validServices.some(item => !item.serviceId || !item.serviceName || !Number.isInteger(item.usesPerCycle) || item.usesPerCycle < 1)
    ) {
      toast.error('Preencha o nome, valor, divisão e serviços com usos válidos.');
      return;
    }
    if (new Set(validServices.map(item => item.serviceId)).size !== validServices.length) {
      toast.error('Cada serviço pode ser incluído apenas uma vez no plano.');
      return;
    }

    setIsCreatingPlan(true);
    try {
      const savedPlan = await addPlan({
        name: createPlanForm.name.trim(),
        price,
        duration: createPlanForm.duration,
        salonSharePercent: Math.round(salonSharePercent * 100) / 100,
        services: validServices,
      });
      if (!savedPlan) return;
      setAssignPlanId(savedPlan.id);
      setConfirmPlanPayment(false);
      setAssignPlanPaymentMethod(payMethod);
      setShowCreatePlan(false);
      setShowAssignPlan(true);
      clearCreatePlanFormDraft();
      toast.success('Plano criado. Agora atribua ao cliente.');
    } finally {
      setIsCreatingPlan(false);
    }
  };

  const handleRegisterAppt = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!anonymousAttendance && !client.trim()) || !resolvedProfId || !serviceItem) { toast.error('Preencha os campos obrigatórios'); return; }
    if (isProsthesisApplication && !hasProsthesisProductSelected) {
      toast.error('Selecione um produto marcado como prótese capilar para registrar o custo e o consumo.');
      return;
    }
    if (additionalProfessionalIds.some(id => !id)) {
      toast.error('Selecione todos os profissionais adicionados ou remova os campos vazios.');
      return;
    }
    if (
      isManualCommissionMode
      && assignedProfessionalIds.some(id =>
        manualCommissionAmounts[id] === undefined
        || manualCommissionAmounts[id].trim() === ''
        || !Number.isFinite(Number(manualCommissionAmounts[id]))
        || Number(manualCommissionAmounts[id]) < 0,
      )
    ) {
      toast.error('Informe a comissão em reais para cada profissional.');
      return;
    }
    if (
      isSalesAttributedService &&
      sellerProfessionalId !== 'company' &&
      (!selectedSellerId || !activeProfs.some(professional => professional.id === selectedSellerId))
    ) {
      toast.error('Selecione um vendedor ativo ou Própria Empresa.');
      return;
    }

    if (selectedClientId && !selectedClient) {
      toast.error('O cliente selecionado não está mais disponível. Pesquise e escolha outro cadastro.');
      return;
    }

    if (
      !anonymousAttendance
      && selectedClient
      && !selectedClient.whatsapp.trim()
      && !selectedClient.email.trim()
    ) {
      toast.error('Este cadastro não tem telefone ou e-mail. Atualize-o em Clientes antes de lançar o atendimento.');
      return;
    }

    if (anonymousAttendance && planSubscriberId) {
      toast.error('Atendimentos sem identificação não podem usar plano.');
      return;
    }

    if (planSubscriberId) {
      const planSubscriber = usablePlanSubscribers.find(item => item.id === planSubscriberId);
      const plan = plans.find(item => item.id === planSubscriber?.planId);
      const benefit = planServiceBenefits(plan).find(item => item.serviceId === serviceId);
      if (!selectedClient || !planSubscriber || !benefit) {
        toast.error('Selecione um cliente com plano ativo e um serviço incluso.');
        return;
      }
      if (subscriberServiceUsesRemaining(appointments, planSubscriber, benefit) < 1) {
        toast.error('Os usos deste serviço acabaram. Renove manualmente o plano ou lance o serviço como atendimento normal.');
        return;
      }
    }

    if (!anonymousAttendance && !selectedClient && !normalizedClientPhone) {
      toast.error('Informe o telefone para criar o cadastro. Se tiver apenas e-mail, cadastre o cliente em Clientes e selecione-o aqui.');
      return;
    }

    if (!anonymousAttendance && !selectedClient && normalizedClientPhone.length < 10 && !isDuplicateClientPhone) {
      toast.error('Informe o telefone com DDD para cadastrar o cliente.');
      return;
    }

    if (isManualCommissionMode && !isProsthesisApplication && !manualCommissionIsBalanced) {
      const difference = Math.round((manualCommissionTarget - manualCommissionTotal + Number.EPSILON) * 100) / 100;
      toast.error(
        difference > 0
          ? `As comissões devem somar ${brl(manualCommissionTarget)} ${commissionBasisDescription}; ainda faltam ${brl(difference)}.`
          : `As comissões devem somar ${brl(manualCommissionTarget)} ${commissionBasisDescription}; reduza ${brl(Math.abs(difference))}.`,
      );
      return;
    }
    
    const valNum = serviceValue;
    const tipNum = parseFloat(tip) || 0;
    const duration = serviceItem.duration;
    const currentTime = new Date().toTimeString().slice(0, 5);
    
    const validProducts = apptProducts
      .filter(product => product.productId && product.quantity > 0)
      .map(({ productId, quantity }) => ({ productId, quantity }));

    // Aggregate quantities by productId so duplicate rows are combined
    const aggregated: Record<string, number> = {};
    for (const p of validProducts) {
      aggregated[p.productId] = (aggregated[p.productId] || 0) + p.quantity;
    }

    const total = valNum + tipNum + totalProducts;
    const normalizedPayments = paymentSplits.length > 0
      ? paymentSplits
      : [{ method: payMethod, amount: total }];
    const hasInvalidPayment = normalizedPayments.some(payment =>
      !Number.isFinite(Number(payment.amount)) || Number(payment.amount) < 0
    );
    if (hasInvalidPayment || Math.abs(normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount), 0) - total) > 0.01) {
      toast.error(`As formas de pagamento devem totalizar ${brl(total)}`);
      return;
    }

    // Pre-validate ALL quantities before mutating any stock
    for (const [productId, qty] of Object.entries(aggregated)) {
      const prod = products.find(pr => pr.id === productId);
      if (!prod || prod.stock < qty) {
        toast.error(`Estoque insuficiente: ${prod?.name ?? 'produto'} (disponível: ${prod?.stock ?? 0})`);
        return;
      }
    }

    // Persist stock deductions before creating the appointment. If any deduction
    // fails, no appointment is created and the user can retry safely.
    const deducted: Array<[string, number]> = [];
    for (const [productId, qty] of Object.entries(aggregated)) {
      if (!await sellProduct(productId, qty)) {
        for (const [deductedId, deductedQty] of deducted) await restock(deductedId, deductedQty);
        return;
      }
      deducted.push([productId, qty]);
    }

    const restoreDeductedStock = async () => {
      let restored = true;
      for (const [deductedId, deductedQty] of deducted) {
        if (!await restock(deductedId, deductedQty)) restored = false;
      }
      return restored;
    };

    let clientRecord: Awaited<ReturnType<typeof addClient>> = null;
    let selectedVisitId: string | null = null;
    let linkedClientId = anonymousAttendance ? undefined : selectedClient?.id;
    if (!anonymousAttendance && selectedClient) {
      const savedVisit = await addVisit(selectedClient.id, {
        date: today,
        type: 'servico',
        description: isPlanAttendance
          ? `${serviceDescription.trim() || service} · Plano ${selectedPlan?.name}`
          : serviceDescription.trim() || service,
        professional: assignedProfessionalNames.join(', '),
        amount: valNum,
      });
      if (!savedVisit) {
        const restored = await restoreDeductedStock();
        toast.error('Atendimento não registrado: não foi possível salvar a visita no cadastro do cliente.');
        if (!restored) toast.warning('Confira o estoque: nem todos os produtos puderam ser repostos.');
        return;
      }
      selectedVisitId = savedVisit.id;
    } else if (!anonymousAttendance && normalizedClientPhone) {
      clientRecord = await addClient({
        name: client.trim(),
        email: '',
        whatsapp: normalizedClientPhone,
        interest: 'barbearia',
      }, {
        date: today,
        type: 'servico',
        description: isPlanAttendance
          ? `${serviceDescription.trim() || service} · Plano ${selectedPlan?.name}`
          : serviceDescription.trim() || service,
        professional: assignedProfessionalNames.join(', '),
        amount: valNum,
      }, { notifyOnError: false });
      if (!clientRecord) {
        const restored = await restoreDeductedStock();
        toast.error('Atendimento não registrado: não foi possível salvar o cliente em Clientes.');
        if (!restored) toast.warning('Confira o estoque: nem todos os produtos puderam ser repostos.');
        return;
      }
      selectedVisitId = clientRecord.initialVisitId ?? null;
      linkedClientId = clientRecord.id;
    }

    const createdAppointment = await addAppointment({
      date: today,
      time: currentTime,
      client: anonymousAttendance ? 'Atendimento sem identificação' : client.trim(),
      clientPhone: anonymousAttendance ? undefined : normalizedClientPhone || undefined,
      clientId: linkedClientId,
      professionalId: resolvedProfId,
      serviceId: serviceItem?.id,
       planSubscriberId: !anonymousAttendance && isPlanAttendance ? selectedPlanSubscriber?.id : undefined,
       planUsageValue: !anonymousAttendance && isPlanAttendance ? planValueForUse : 0,
      professionalCommissions: isManualCommissionMode
        ? manualAssignments
        : undefined,
      ...(isSalesAttributedService
        ? {
            sellerProfessionalId: sellerProfessionalId === 'company' ? undefined : selectedSellerId,
            sellerIsCompany: sellerProfessionalId === 'company',
          }
        : {}),
      service,
       serviceDescription: serviceDescription.trim() || service,
      duration,
      status: 'completed',
      completedAt: currentTime,
      value: valNum,
      tip: tipNum,
      products: validProducts,
      payMethod,
      paymentSplits: normalizedPayments,
      attendanceRecordedAt: new Date().toISOString(),
      notes
    });
    if (!createdAppointment) {
      const clientCleanupSucceeded = selectedVisitId && selectedClient
        ? await removeVisit(selectedClient.id, selectedVisitId)
        : clientRecord?.wasCreated
          ? await removeClient(clientRecord.id)
          : clientRecord && selectedVisitId
            ? await removeVisit(clientRecord.id, selectedVisitId)
            : true;
      const stockRestored = await restoreDeductedStock();
      if (!clientCleanupSucceeded) {
        toast.warning('O atendimento não foi salvo, mas não foi possível desfazer a alteração do cliente. Confira Clientes.');
      }
      if (!stockRestored) toast.warning('Confira o estoque: nem todos os produtos puderam ser repostos.');
      return;
    }

    if (anonymousAttendance) {
      toast.success('Atendimento sem cliente identificado registrado.');
    } else {
      toast.success(clientRecord && !clientRecord.wasCreated
        ? 'Atendimento registrado e vinculado ao cliente existente.'
        : normalizedClientPhone
          ? 'Atendimento registrado e incluído no histórico do cliente!'
          : 'Atendimento registrado!');
    }
    void api.googleCalendar.syncAppointment(createdAppointment.id).catch((error: unknown) => {
      toast.warning('Atendimento salvo, mas não sincronizado com o Google Agenda.', {
        description: error instanceof Error ? error.message : 'Tente sincronizar novamente pela agenda.',
      });
    });
    setSelectedClientId('');
    setClientLookupField(null);
    setClient('');
    setClientPhone('');
    setAnonymousAttendance(false);
    setPlanSubscriberId(''); setServiceId('');
    setServiceDescription(serviceItem.name);
    setValue(''); setTip(''); setNotes(''); setApptProducts([]); setPaymentSplits([]); setSellerProfessionalId('');
    setAdditionalProfessionalIds([]); setManualCommissionAmounts({});
    clearAttendanceDraft();
    setService(serviceItem.name);
    setServiceDescription(serviceItem.name);
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expDate || !expDesc || !expAmount) { toast.error('Preencha os campos obrigatórios'); return; }
    
    if (!await addExpense({
      date: expDate,
      description: expDesc,
      amount: parseFloat(expAmount),
      category: expCategory
    })) return;
    
    toast.success('Despesa registrada!');
    setExpDesc(''); setExpAmount(''); setExpDate(today); setExpCategory('Outros');
    clearExpenseDateDraft();
    clearExpenseDescriptionDraft();
    clearExpenseAmountDraft();
    clearExpenseCategoryDraft();
  };

  // Revenue derived from confirmed appointments (no stale income records)
  const todayAppts = appointments.filter(a => a.date === today && (a.status === 'confirmed' || a.status === 'completed'));
  const todayExpenses = expenses.filter(e => e.date === today);
  const todaySubscriptionReceipts = subscriptionPayments.flatMap(payment => {
    const receiptDate = subscriptionReceiptDate(payment);
    return receiptDate === today ? [{ ...payment, receiptDate }] : [];
  });
  const formatMovementTime = (value?: string) => {
    if (!value) return '—';
    if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const movs = [
    ...todayAppts.map(a => {
      const performer = appointmentProfessionalLabel(a);
      const seller = a.sellerIsCompany
        ? 'Própria Empresa'
        : professionals.find(professional => professional.id === a.sellerProfessionalId)?.name;
      const sellerAttribution = seller ? ` · Vendedor: ${seller}` : '';
      return {
        id: a.id,
        source: 'appointment' as const,
        date: a.date,
        time: formatMovementTime(a.time),
        clientName: a.client,
        description: `${a.client} — ${a.service} (${performer})${sellerAttribution}`,
        amount: a.value + (a.tip || 0),
        type: 'in' as const
      };
    }),
    ...todaySubscriptionReceipts.map(payment => {
      const subscriber = subscribers.find(item => item.id === payment.subscriberId);
      const plan = plans.find(item => item.id === subscriber?.planId);
      const paymentMethod = payment.paymentMethod ? ` · ${PAY_LABELS[payment.paymentMethod]}` : '';
      return {
        id: `subscription-payment-${payment.id}`,
        source: 'subscription_payment' as const,
        date: payment.receiptDate,
        time: '—',
        clientName: subscriber?.name ?? 'Assinante removido',
        description: `Mensalidade · ${subscriber?.name ?? 'Assinante removido'} — ${plan?.name ?? 'Plano'}${paymentMethod}`,
        amount: payment.amount,
        type: 'in' as const,
      };
    }),
    ...todayExpenses.map(e => ({ ...e, source: 'expense' as const, time: formatMovementTime(e.createdAt), type: 'out' as const }))
  ].sort((a, b) => b.time.localeCompare(a.time));

  const totalIn = todayAppts.reduce((s, a) => s + a.value + (a.tip || 0), 0) +
    todaySubscriptionReceipts.reduce((sum, payment) => sum + payment.amount, 0);
  const totalOut = todayExpenses.reduce((s, e) => s + e.amount, 0);
  const alertProducts = products.filter(p => productStatus(p) !== 'ok');

  const handleDeleteAttendance = async (appointmentId: string) => {
    const appointment = appointments.find(item => item.id === appointmentId);
    if (!appointment) return;
    if (!canDeleteAttendance(appointment.attendanceRecordedAt, session?.role)) {
      toast.error('O prazo de 24 horas para excluir este atendimento terminou.');
      return;
    }

    if (!await removeAppointment(appointmentId)) return;

    let stockRestoreFailed = false;
    for (const item of appointment.products ?? []) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
      if (!await restock(item.productId, item.quantity)) {
        stockRestoreFailed = true;
      }
    }

    toast.success('Atendimento excluído.');
    if (stockRestoreFailed) {
      toast.warning('Não foi possível restaurar todo o estoque. Confira os produtos usados neste atendimento.');
    }
    try {
      await api.googleCalendar.deleteAppointment(appointmentId);
    } catch (error) {
      toast.warning('Atendimento excluído, mas pode continuar no Google Agenda.', {
        description: error instanceof Error ? error.message : 'Não foi possível remover o evento.',
      });
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!await removeExpense(expenseId)) return;
    toast.success('Saída excluída.');
  };

  const deleteExpenseAction = (expenseId: string, description: string) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Excluir saída: ${description}`}
          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir saída?</AlertDialogTitle>
          <AlertDialogDescription>
            A despesa “{description}” será removida das movimentações e do financeiro. Essa ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void handleDeleteExpense(expenseId)}
          >
            Excluir saída
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const deleteAttendanceAction = (appointmentId: string, clientName: string) => {
    const appointment = appointments.find(item => item.id === appointmentId);
    if (!appointment) return null;

    if (!canDeleteAttendance(appointment.attendanceRecordedAt, session?.role)) {
      return (
        <button
          type="button"
          disabled
          aria-label={`Excluir atendimento de ${clientName} (prazo de 24 horas encerrado)`}
          title="Atendimento só pode ser excluído nas primeiras 24 horas após o lançamento."
          className="p-2 text-destructive/50 cursor-not-allowed rounded-lg"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      );
    }

    return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Excluir atendimento de ${clientName}`}
          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir atendimento?</AlertDialogTitle>
          <AlertDialogDescription>
            O lançamento de {clientName} será removido do controle diário e do financeiro. Produtos consumidos neste atendimento voltarão ao estoque. Essa ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void handleDeleteAttendance(appointmentId)}
          >
            Excluir atendimento
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-5 md:space-y-6 md:p-8">
      <div className="mb-4 hidden items-center justify-between md:flex">
        <h2 className="text-2xl font-bold text-foreground">Controle Diário</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lançar Atendimento */}
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3 border-b border-brand-border/70 pb-4">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-lg font-bold text-foreground">Registrar Atendimento</h3>
                <FeatureInfo label="Registrar atendimento">Registre um serviço identificado ou sem nome, com profissionais, produtos e pagamento em um único lançamento.</FeatureInfo>
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-brand-gold/30 bg-brand-gold/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-gold">Novo</span>
          </div>
          <form onSubmit={handleRegisterAppt} className="space-y-4 [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_select]:min-h-11">
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="attendance-client-search-status">
              {clientLookupAnnouncement}
            </div>
            <div className="border-b border-brand-border/70 pb-2">
              <div className="flex items-center gap-1">
                <h4 className="text-xs font-bold uppercase tracking-wide text-brand-gold">Cliente</h4>
                <FeatureInfo label="Identificar cliente">Digite nome ou telefone para localizar e vincular um cadastro. Para registrar sem dados do cliente, marque “Registrar sem nome do cliente”; planos não ficam disponíveis nesse modo.</FeatureInfo>
              </div>
            </div>
            <label htmlFor="attendance-anonymous" className="flex cursor-pointer items-start gap-3 rounded-xl border border-brand-border bg-brand-bg p-3">
              <input
                id="attendance-anonymous"
                data-testid="checkbox-anonymous-attendance"
                type="checkbox"
                checked={anonymousAttendance}
                onChange={event => {
                  const enabled = event.target.checked;
                  setAnonymousAttendance(enabled);
                  if (enabled) {
                    setSelectedClientId('');
                    setPlanSubscriberId('');
                    setShowAssignPlan(false);
                    setConfirmPlanPayment(false);
                    setClientLookupField(null);
                    setClient('');
                    setClientPhone('');
                  }
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-gold"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">Registrar sem nome do cliente</span>
              </span>
            </label>
            {anonymousAttendance ? (
              <div role="status" data-testid="status-anonymous-attendance" className="rounded-lg border border-brand-gold/30 bg-brand-gold/10 px-3 py-2 text-sm text-foreground">
                Este atendimento será salvo como “Sem identificação”.
              </div>
            ) : (
              <>
            {selectedClient || selectedClientId ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-gold/50 bg-brand-bg px-4 py-2">
                <div className="min-w-0">
                  {selectedClient ? (
                    <>
                      <p className="truncate text-sm font-semibold text-foreground">{selectedClient.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {selectedClient.whatsapp || selectedClient.email || 'Sem telefone ou e-mail cadastrado'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-destructive">Este cadastro não está mais disponível. Escolha outro cliente.</p>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="button-clear-attendance-client"
                  onClick={clearSelectedClient}
                  className="shrink-0 text-xs font-semibold text-brand-gold hover:underline"
                >
                  Trocar cliente
                </button>
              </div>
            ) : null}
            <div>
              <label htmlFor="attendance-client-name" className="block text-xs font-semibold text-foreground uppercase tracking-wide">Nome do cliente *</label>
              <input
                id="attendance-client-name"
                data-testid="input-attendance-client-name"
                type="text"
                required
                readOnly={Boolean(selectedClient)}
                value={client}
                onChange={e => {
                  setSelectedClientId('');
                  setPlanSubscriberId('');
                  setClient(e.target.value);
                  setClientLookupField('name');
                  setActiveClientIndex(-1);
                }}
                onKeyDown={event => handleClientLookupKeyDown('name', event)}
                className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold focus:border-brand-gold outline-none transition-all read-only:opacity-70"
                placeholder="Digite o nome para localizar ou cadastrar"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={clientLookupField === 'name' && canSearchClients && !selectedClientId}
                aria-controls="attendance-client-results-name"
                aria-activedescendant={clientLookupField === 'name' && matchingClients[activeClientIndex]
                  ? `attendance-client-option-name-${matchingClients[activeClientIndex].id}`
                  : undefined}
              />
              {renderClientLookupResults('name')}
            </div>
            <div>
              <label htmlFor="attendance-client-phone" className="text-xs font-semibold text-foreground uppercase tracking-wide">Telefone ou E-mail do cliente</label>
              <input
                id="attendance-client-phone"
                data-testid="input-attendance-client-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                readOnly={Boolean(selectedClient)}
                value={clientPhone}
                onChange={e => {
                  setSelectedClientId('');
                  setPlanSubscriberId('');
                  setClientPhone(e.target.value);
                  setClientLookupField('phone');
                  setActiveClientIndex(-1);
                }}
                onKeyDown={event => handleClientLookupKeyDown('phone', event)}
                className={`w-full bg-brand-bg border rounded-lg px-4 py-2 mt-1 text-sm outline-none transition-all ${
                  isDuplicateClientPhone
                    ? 'border-amber-500 text-foreground focus:ring-1 focus:ring-amber-500'
                    : 'border-brand-border text-foreground focus:ring-1 focus:ring-brand-gold focus:border-brand-gold'
                }`}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={clientLookupField === 'phone' && canSearchClients && !selectedClientId}
                aria-controls="attendance-client-results-phone"
                aria-activedescendant={clientLookupField === 'phone' && matchingClients[activeClientIndex]
                  ? `attendance-client-option-phone-${matchingClients[activeClientIndex].id}`
                  : undefined}
                aria-describedby={isDuplicateClientPhone
                  ? 'attendance-client-phone-help attendance-client-phone-duplicate'
                  : 'attendance-client-phone-help'}
              />
              {renderClientLookupResults('phone')}
              <p id="attendance-client-phone-help" className="sr-only">
                {isDuplicateClientPhone
                  ? 'O atendimento e a visita serão vinculados ao cadastro existente.'
                  : selectedClient
                    ? 'O atendimento e a visita serão vinculados a este cadastro.'
                    : 'Informe telefone para criar o cadastro. Se tiver apenas e-mail, cadastre-o em Clientes e selecione-o aqui.'}
              </p>
              {isDuplicateClientPhone && (
                <p
                  id="attendance-client-phone-duplicate"
                  data-testid="status-attendance-client-phone-duplicate"
                  role="status"
                  className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400"
                >
                  Cliente existente será reutilizado
                </p>
              )}
            </div>

              </>
            )}

            <div className="border-b border-brand-border/70 pb-2 pt-1">
              <div className="flex items-center gap-1">
                <h4 className="text-xs font-bold uppercase tracking-wide text-brand-gold">Plano, serviço e profissional</h4>
                <FeatureInfo label="Plano, serviço e profissional">Selecione o plano do cliente quando houver, informe a categoria e descrição do serviço e escolha quem realizou o atendimento.</FeatureInfo>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1">
                <label htmlFor="attendance-plan" className="text-xs font-semibold text-foreground uppercase tracking-wide">Plano do cliente</label>
                <FeatureInfo label="Plano do cliente">O uso será descontado ao salvar. Se o cliente não tiver assinatura, use “Atribuir plano neste registro”. A mensalidade só entra no caixa quando o pagamento for confirmado. O cadastro do plano deve estar configurado em Planos e Mensalidades.</FeatureInfo>
              </div>
              <select
                id="attendance-plan"
                data-testid="select-attendance-plan"
                value={planSubscriberId}
                disabled={!selectedClient}
                onChange={event => {
                  const nextSubscriberId = event.target.value;
                  setPlanSubscriberId(nextSubscriberId);
                  setPaymentSplits([]);
                  if (!nextSubscriberId) {
                    setServiceId('');
                    setValue('');
                    return;
                  }
                  const nextSubscriber = usablePlanSubscribers.find(item => item.id === nextSubscriberId);
                  const firstBenefit = nextSubscriber ? availablePlanBenefits(nextSubscriber)[0] : undefined;
                   const firstService = config.services.find(item => item.id === firstBenefit?.serviceId);
                  setServiceId(firstService?.id ?? '');
                  if (firstService) {
                    setService(firstService.name);
                    setServiceDescription(firstService.name);
                  }
                  setValue('0');
                }}
                className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none disabled:opacity-60"
              >
                <option value="">Atendimento normal (sem plano)</option>
                {usablePlanSubscribers.map(subscriber => {
                  const plan = plans.find(item => item.id === subscriber.planId);
                  const remainingServices = availablePlanBenefits(subscriber).length;
                  return <option key={subscriber.id} value={subscriber.id}>
                    {plan?.name ?? 'Plano'} · {subscriber.name} · {remainingServices} serviço(s) disponível(is)
                  </option>;
                })}
              </select>
              {selectedClient && matchedPlanSubscribers.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Nenhum assinante correspondente foi encontrado. Confira o telefone ou o nome cadastrado no plano.</p>
              )}
              {selectedClient && matchedPlanSubscribers.length > 0 && usablePlanSubscribers.length === 0 && (
                <p className="mt-1 text-xs text-warning">O plano encontrado está pendente ou vencido; não pode ser usado neste atendimento.</p>
              )}
              {selectedPlanSubscriber && planBenefits.length > 0 && availablePlanBenefits(selectedPlanSubscriber).length === 0 && (
                <p className="mt-1 text-xs text-destructive">Todos os usos incluídos acabaram. Renove manualmente o plano ou lance um atendimento normal.</p>
              )}
              {selectedPlanSubscriber && planBenefits.length === 0 && (
                <p className="mt-1 text-xs text-warning">Este plano ainda precisa de serviços e quantidades configurados para controlar os usos.</p>
              )}
              {!selectedPlanSubscriber && !anonymousAttendance && (
                <div className="mt-3 space-y-3">
                  {!showAssignPlan && !showCreatePlan && (
                    <div className="flex flex-wrap gap-2">
                      {plans.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignPlanId(plans[0]?.id ?? '');
                            setConfirmPlanPayment(false);
                            setAssignPlanPaymentMethod(payMethod);
                            setShowAssignPlan(true);
                          }}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-gold/40 px-3 py-2 text-sm font-semibold text-brand-gold hover:bg-brand-gold/10"
                        >
                          <Plus className="h-4 w-4" />
                          Atribuir plano neste registro
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="button-create-plan-in-daily-control"
                        onClick={() => {
                          setCreatePlanForm({
                            name: '',
                            price: '',
                            duration: 'Mensal',
                            salonSharePercent: '',
                            services: [{ serviceId: '', usesPerCycle: '1' }],
                          });
                          setShowCreatePlan(true);
                        }}
                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-brand-surface"
                      >
                        <Plus className="h-4 w-4" />
                        Criar plano e atribuir
                      </button>
                    </div>
                  )}

                  {showCreatePlan && (
                    <div className="space-y-3 rounded-xl border border-brand-gold/30 bg-brand-bg p-3 sm:p-4">
                      <div>
                        <h5 className="text-sm font-semibold text-foreground">Criar plano para este cliente</h5>
                        <p className="mt-1 text-xs text-muted-foreground">Depois de salvar, você poderá atribuí-lo e confirmar o pagamento.</p>
                      </div>
                      <div>
                        <label htmlFor="daily-plan-name" className="text-xs font-semibold uppercase tracking-wide text-foreground">Nome do plano</label>
                        <input
                          id="daily-plan-name"
                          data-testid="input-daily-plan-name"
                          value={createPlanForm.name}
                          onChange={event => setCreatePlanForm(current => ({ ...current, name: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                          placeholder="Ex.: Plano mensal"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="daily-plan-price" className="text-xs font-semibold uppercase tracking-wide text-foreground">Valor (R$)</label>
                          <input
                            id="daily-plan-price"
                            data-testid="input-daily-plan-price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={createPlanForm.price}
                            onChange={event => setCreatePlanForm(current => ({ ...current, price: event.target.value }))}
                            className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                          />
                        </div>
                        <div>
                          <label htmlFor="daily-plan-duration" className="text-xs font-semibold uppercase tracking-wide text-foreground">Ciclo</label>
                          <select
                            id="daily-plan-duration"
                            value={createPlanForm.duration}
                            onChange={event => setCreatePlanForm(current => ({ ...current, duration: event.target.value as SubscriptionPlan['duration'] }))}
                            className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                          >
                            <option>Mensal</option>
                            <option>Trimestral</option>
                            <option>Semestral</option>
                            <option>Anual</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="daily-plan-salon-share" className="text-xs font-semibold uppercase tracking-wide text-foreground">Parte do salão (%)</label>
                        <input
                          id="daily-plan-salon-share"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={createPlanForm.salonSharePercent}
                          onChange={event => setCreatePlanForm(current => ({ ...current, salonSharePercent: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                        />
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">Serviços e usos incluídos</p>
                        {createPlanForm.services.map((includedService, index) => (
                          <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] gap-2">
                            <select
                              aria-label={`Serviço incluso ${index + 1}`}
                              data-testid={`select-daily-plan-service-${index}`}
                              value={includedService.serviceId}
                              onChange={event => setCreatePlanForm(current => ({
                                ...current,
                                services: current.services.map((item, itemIndex) => itemIndex === index
                                  ? { ...item, serviceId: event.target.value }
                                  : item),
                              }))}
                              className="mt-1 min-w-0 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                            >
                              <option value="">Selecione o serviço</option>
                              {config.services.map(option => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                              ))}
                            </select>
                            <input
                              aria-label={`Usos por ciclo do serviço ${index + 1}`}
                              data-testid={`input-daily-plan-uses-${index}`}
                              type="number"
                              min="1"
                              step="1"
                              value={includedService.usesPerCycle}
                              onChange={event => setCreatePlanForm(current => ({
                                ...current,
                                services: current.services.map((item, itemIndex) => itemIndex === index
                                  ? { ...item, usesPerCycle: event.target.value }
                                  : item),
                              }))}
                              className="mt-1 min-w-0 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                            />
                            <button
                              type="button"
                              aria-label={`Remover serviço incluso ${index + 1}`}
                              disabled={createPlanForm.services.length === 1}
                              onClick={() => setCreatePlanForm(current => ({
                                ...current,
                                services: current.services.filter((_, itemIndex) => itemIndex !== index),
                              }))}
                              className="mt-1 flex min-h-10 min-w-10 items-center justify-center rounded-lg text-destructive disabled:opacity-40"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setCreatePlanForm(current => ({
                            ...current,
                            services: [...current.services, { serviceId: '', usesPerCycle: '1' }],
                          }))}
                          className="min-h-10 text-sm font-semibold text-brand-gold"
                        >
                          + Adicionar serviço
                        </button>
                      </div>
                      <FeatureInfo label="Divisão do plano">O restante do valor será reservado aos profissionais e dividido pelos usos incluídos.</FeatureInfo>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            clearCreatePlanFormDraft();
                            setShowCreatePlan(false);
                          }}
                          className="min-h-10 rounded-lg border border-brand-border px-3 py-2 text-sm"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          data-testid="button-save-daily-plan"
                          onClick={() => void handleCreatePlanForAttendance()}
                          disabled={isCreatingPlan}
                          className="min-h-10 rounded-lg bg-brand-gold px-3 py-2 text-sm font-bold text-brand-bg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isCreatingPlan ? 'Salvando...' : 'Salvar plano'}
                        </button>
                      </div>
                    </div>
                  )}

                  {showAssignPlan && plans.length > 0 && (
                    <div className="space-y-3 rounded-xl border border-brand-gold/30 bg-brand-bg p-3 sm:p-4">
                      <div>
                        <label htmlFor="attendance-assign-plan" className="text-xs font-semibold uppercase tracking-wide text-foreground">Plano</label>
                        <select
                          id="attendance-assign-plan"
                          data-testid="select-assign-plan"
                          value={assignPlanId}
                          onChange={event => setAssignPlanId(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                        >
                          {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {brl(plan.price)}</option>)}
                        </select>
                      </div>
                      <label className="flex min-h-11 items-start gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={confirmPlanPayment}
                          onChange={event => setConfirmPlanPayment(event.target.checked)}
                          className="mt-1 accent-brand-gold"
                        />
                        <span>O cliente já pagou a mensalidade</span>
                      </label>
                      {confirmPlanPayment && (
                        <div>
                          <label htmlFor="attendance-plan-payment-method" className="text-xs font-semibold uppercase tracking-wide text-foreground">Forma de pagamento</label>
                          <select
                            id="attendance-plan-payment-method"
                            value={assignPlanPaymentMethod}
                            onChange={event => setAssignPlanPaymentMethod(event.target.value as PayMethod)}
                            className="mt-1 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground"
                          >
                            {(['dinheiro', 'pix', 'debito', 'credito'] as PayMethod[]).map(method => (
                              <option key={method} value={method}>{PAY_LABELS[method]}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <FeatureInfo label="Confirmação do plano">
                        {confirmPlanPayment
                          ? 'A mensalidade será registrada no caixa e os usos liberados.'
                          : 'Sem confirmação, a assinatura ficará pendente e não entrará no caixa.'}
                      </FeatureInfo>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => clearPlanAssignmentDraft()}
                          className="min-h-10 rounded-lg border border-brand-border px-3 py-2 text-sm"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          data-testid="button-assign-plan"
                          onClick={() => void handleAssignPlan()}
                          disabled={isAssigningPlan || (!selectedClient && (!client.trim() || normalizedClientPhone.length < 10 || isDuplicateClientPhone))}
                          className="min-h-10 rounded-lg bg-brand-gold px-3 py-2 text-sm font-bold text-brand-bg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isAssigningPlan ? 'Salvando...' : confirmPlanPayment ? 'Atribuir e confirmar pagamento' : 'Atribuir plano'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Categoria do serviço *</label>
                <select
                  data-testid="select-attendance-service"
                  value={selectedPlanSubscriber ? serviceId : (serviceItem?.id ?? '')}
                  onChange={event => {
                    const nextId = event.target.value;
                    const nextService = config.services.find(item => item.id === nextId);
                    setServiceId(nextId);
                    if (nextService) {
                      setService(nextService.name);
                      setServiceDescription(nextService.name);
                    }
                    if (selectedPlanSubscriber) setValue('0');
                  }}
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none"
                >
                  {!selectedPlanSubscriber && config.services.filter(s => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {selectedPlanSubscriber && planBenefits.map(benefit => {
                    const serviceOption = config.services.find(item => item.id === benefit.serviceId);
                    if (!serviceOption) return null;
                    const remaining = subscriberServiceUsesRemaining(appointments, selectedPlanSubscriber, benefit);
                    return <option key={benefit.serviceId} value={benefit.serviceId} disabled={remaining < 1}>
                      {serviceOption.name}{serviceOption.isActive ? '' : ' (inativo)'} · {remaining} de {benefit.usesPerCycle} usos restantes
                    </option>;
                  })}
                </select>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <label htmlFor="attendance-service-description" className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    Descrição do atendimento *
                  </label>
                  <FeatureInfo label="Descrição do atendimento">O texto aparece no histórico. A categoria selecionada continua sendo usada nos cálculos de comissão e relatórios.</FeatureInfo>
                </div>
                <input
                  id="attendance-service-description"
                  data-testid="input-attendance-service-description"
                  type="text"
                  required
                  maxLength={160}
                  value={serviceDescription}
                  onChange={event => setServiceDescription(event.target.value)}
                  className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-2 text-sm text-foreground outline-none transition-all focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                  placeholder="Ex.: corte degradê e barba"
                />
              </div>
              <div>
                <label htmlFor="attendance-professional" className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  {isSalesAttributedService
                    ? 'Quem realizou/aplicou *'
                    : assignedProfessionalIds.length > 1 ? 'Profissional principal *' : 'Profissional *'}
                </label>
                <select
                  id="attendance-professional"
                  data-testid="select-attendance-professional"
                  required
                  disabled={ownProfile}
                  value={resolvedProfId || ''}
                  onChange={event => {
                    const nextProfessionalId = event.target.value;
                    setProfId(nextProfessionalId);
                    setAdditionalProfessionalIds(current => current.filter(id => id !== nextProfessionalId));
                    setManualCommissionAmounts({});
                  }}
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none disabled:opacity-60"
                >
                  <option value="">Selecione...</option>
                  {activeProfs.map(professional => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
                </select>
                {!ownProfile && (
                  <div className="mt-3 space-y-2">
                    {additionalProfessionalIds.map((additionalId, index) => (
                      <div key={`additional-professional-${index}`} className="flex items-center gap-2">
                        <select
                          aria-label={`Profissional adicional ${index + 1}`}
                          data-testid={`select-attendance-additional-professional-${index}`}
                          ref={element => { additionalProfessionalSelectRefs.current[index] = element; }}
                          required
                          value={additionalId}
                          onChange={event => {
                            const nextId = event.target.value;
                            setAdditionalProfessionalIds(current => current.map((id, currentIndex) =>
                              currentIndex === index ? nextId : id,
                            ));
                            setManualCommissionAmounts({});
                          }}
                          className="w-full min-w-0 bg-brand-bg border border-brand-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none"
                        >
                          <option value="">Selecione outro profissional...</option>
                          {activeProfs
                            .filter(professional =>
                              professional.id !== resolvedProfId
                              && (
                                professional.id === additionalId
                                || !additionalProfessionalIds.includes(professional.id)
                              ),
                            )
                            .map(professional => (
                              <option key={professional.id} value={professional.id}>{professional.name}</option>
                            ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Remover profissional adicional ${index + 1}`}
                          onClick={() => {
                            setAdditionalProfessionalIds(current => current.filter((_, currentIndex) => currentIndex !== index));
                            setManualCommissionAmounts({});
                          }}
                          className="shrink-0 rounded-lg border border-brand-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        pendingAttendanceFocus.current = {
                          kind: 'additional-professional',
                          index: additionalProfessionalIds.length,
                        };
                        setAdditionalProfessionalIds(current => [...current, '']);
                      }}
                      disabled={!resolvedProfId || additionalProfessionalIds.length >= Math.max(activeProfs.length - 1, 0)}
                      className="text-sm font-semibold text-brand-gold hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + Adicionar outro profissional
                    </button>
                    <FeatureInfo label="Comissão para vários profissionais">Quando houver mais de um profissional, informe em reais a comissão de cada pessoa neste lançamento.</FeatureInfo>
                  </div>
                )}
              </div>
            </div>

            {isManualCommissionMode && (
              <section
                data-testid="attendance-manual-commissions"
                className="rounded-xl border border-brand-gold/30 bg-brand-gold/5 p-4 space-y-3"
                aria-labelledby="attendance-manual-commissions-title"
              >
                <div>
                  <h4 id="attendance-manual-commissions-title" className="text-sm font-bold text-brand-gold">
                    {isProsthesisApplication ? 'Comissão por aplicação' : 'Comissão manual por profissional'}
                  </h4>
                  <div className="mt-1">
                    <FeatureInfo label={isProsthesisApplication ? 'Comissão por aplicação' : 'Divisão das comissões'}>
                      {isProsthesisApplication
                        ? 'Cada profissional recebe R$ 140,00 por aplicação. Marcos Macedo recebe 50% do lucro: valor do serviço menos o custo dos produtos consumidos.'
                        : usesConfiguredPlanSplit
                          ? `Informe o valor em reais para cada profissional. A soma deve fechar ${brl(manualCommissionTarget)}, a parte profissional deste uso.`
                          : `O salão fica com 50% ${commissionBasisDescription}. Informe quanto cada profissional recebe; a soma precisa fechar os outros 50%.`}
                    </FeatureInfo>
                  </div>
                  {isSalesAttributedService && (
                    <FeatureInfo label="Comissão por venda">A comissão do vendedor é calculada separadamente da comissão de quem realizou o serviço.</FeatureInfo>
                  )}
                </div>
                {assignedProfessionalIds.map(id => {
                  const professional = professionals.find(item => item.id === id);
                  const maxCommission = manualCommissionLimitFor(id);
                  return (
                    isProsthesisApplication ? (
                      <div key={id} className="flex items-center justify-between gap-3 rounded-lg bg-brand-bg/70 px-3 py-2 text-sm">
                        <span>{professional?.name ?? 'Profissional'}</span>
                        <strong className="text-brand-gold">{brl(commissionForAssignedProfessional(id))}</strong>
                      </div>
                    ) : (
                      <label key={id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_10rem]">
                        <span className="text-sm font-medium">
                          {professional?.name ?? 'Profissional'}
                          <span className="ml-2 text-xs text-muted-foreground">Máx. {brl(maxCommission)}</span>
                        </span>
                        <span className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                          <input
                            type="number"
                            min="0"
                            max={maxCommission}
                            step="0.01"
                            required
                            aria-label={`Comissão de ${professional?.name ?? 'profissional'}`}
                            data-testid={`input-attendance-manual-commission-${id}`}
                            value={manualCommissionAmounts[id] ?? ''}
                            onChange={event => handleManualCommissionChange(id, event.target.value)}
                            className="w-full rounded-lg border border-brand-border bg-brand-bg py-2 pl-10 pr-3 text-sm text-foreground outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                          />
                        </span>
                      </label>
                    )
                  );
                })}
                <div className="flex justify-between border-t border-brand-gold/20 pt-2 text-sm font-semibold">
                  <span>{isProsthesisApplication ? 'Total das comissões' : 'Total informado'}</span>
                  <span className="text-brand-gold">{brl(manualCommissionTotal)}</span>
                </div>
                {isProsthesisApplication ? (
                  <p className="text-xs text-muted-foreground">
                    Custo dos produtos consumidos usado no cálculo do lucro: {brl(prosthesisCost)}.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <div className="flex justify-between rounded-lg bg-brand-bg/70 px-3 py-2">
                        <span>
                          {usesConfiguredPlanSplit
                            ? `Parte profissional deste uso (${100 - (planSalonSharePercentForUsage ?? 0)}%)`
                            : `Parte dos profissionais (${Math.round(PROFESSIONAL_SERVICE_COMMISSION_RATE * 100)}%)`}
                        </span>
                        <strong>{brl(manualCommissionTarget)}</strong>
                      </div>
                      <div className="flex justify-between rounded-lg bg-brand-bg/70 px-3 py-2">
                        <span>
                          {usesConfiguredPlanSplit
                            ? `Parte do salão neste uso (${planSalonSharePercentForUsage ?? 0}%)`
                            : 'Parte do salão (50%)'}
                        </span>
                        <strong>{brl(usesConfiguredPlanSplit ? planSalonValueForUse : manualCommissionTarget)}</strong>
                      </div>
                    </div>
                    <p
                      aria-live="polite"
                      className={`text-xs ${manualCommissionIsBalanced ? 'text-emerald-400' : 'text-muted-foreground'}`}
                      data-testid="attendance-manual-commission-balance"
                    >
                      {manualCommissionIsBalanced
                        ? 'Divisão completa. A soma das comissões corresponde à parte dos profissionais.'
                        : manualCommissionTotal < manualCommissionTarget
                          ? `Faltam ${brl(manualCommissionTarget - manualCommissionTotal)} para completar a parte dos profissionais.`
                          : `Reduza ${brl(manualCommissionTotal - manualCommissionTarget)} para respeitar a parte dos profissionais.`}
                    </p>
                  </>
                )}
              </section>
            )}

            {isSalesAttributedService && (
              <section
                data-testid="attendance-sales-attribution"
                className="rounded-xl border border-brand-gold/30 bg-brand-gold/5 p-4 space-y-2"
                aria-labelledby="attendance-sales-attribution-title"
              >
                <div className="flex items-center gap-1">
                  <h4 id="attendance-sales-attribution-title" className="text-sm font-bold text-brand-gold">Atribuição da venda</h4>
                  <FeatureInfo label="Atribuição da venda">A pessoa que vendeu pode ser diferente do profissional que realizou o serviço. A comissão da venda é separada.</FeatureInfo>
                </div>
                <label htmlFor="attendance-seller" className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Vendedor *
                </label>
                <select
                  id="attendance-seller"
                  data-testid="select-attendance-seller"
                  required
                  value={sellerProfessionalId === 'company' ? 'company' : selectedSellerId}
                  onChange={e => setSellerProfessionalId(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none"
                >
                  <option value="">Selecione...</option>
                  {activeProfs.map(professional => (
                    <option key={professional.id} value={professional.id}>{professional.name}</option>
                  ))}
                  <option value="company">Própria Empresa</option>
                </select>
              </section>
            )}

            {selectedProf && !isReceptionist && (!isManualCommissionMode || isSalesAttributedService) && (
              <div className="p-3 bg-brand-gold/10 border border-brand-gold/20 rounded-lg text-sm">
                {isSalesAttributedService ? (
                  <div className="space-y-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-brand-gold font-medium">
                        {isProsthesisApplication
                          ? isManualCommissionMode ? 'Comissões de aplicação' : `Comissão do aplicador${selectedProf?.name.trim().toLowerCase() === 'marcos macedo' ? ' (50% do lucro)' : ' (fixa)'}`
                          : isManualCommissionMode
                          ? 'Comissão dos profissionais (50%)'
                          : `Comissão do profissional (${Math.round(PROFESSIONAL_SERVICE_COMMISSION_RATE * 100)}%)`}
                      </span>
                      <span className="font-bold text-brand-gold">
                        {brl(isProsthesisApplication && isManualCommissionMode ? manualCommissionTotal : calculatedComm)}
                      </span>
                    </div>
                    {isProsthesisApplication ? (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between gap-3">
                          <span>Custo dos produtos consumidos</span>
                          <span>{brl(prosthesisCost)}</span>
                        </div>
                        {selectedProf?.name.trim().toLowerCase() === 'marcos macedo' && (
                          <div className="flex justify-between gap-3">
                            <span>Lucro considerado</span>
                            <span>{brl(Math.max(0, serviceValue - prosthesisCost))}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          {usesConfiguredPlanSplit
                            ? `Parte do salão neste uso (${planSalonSharePercentForUsage}%)`
                            : 'Parte do salão (50%)'}
                        </span>
                        <span>{brl(usesConfiguredPlanSplit ? planSalonValueForUse : manualCommissionTarget)}</span>
                      </div>
                    )}
                    {sellerProfessionalId !== 'company' && selectedSeller && (
                      <div className="flex justify-between gap-3">
                        <span className="text-brand-gold font-medium">
                          Comissão por venda · {selectedSeller.name} ({Math.round(sellerCommRate * 100)}%)
                        </span>
                        <span className="font-bold text-brand-gold">{brl(calculatedSellerComm)}</span>
                      </div>
                    )}
                    {sellerProfessionalId === 'company' && (
                      <p className="text-xs text-muted-foreground">Venda da empresa: sem comissão de vendedor.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-brand-gold font-medium">
                        {usesConfiguredPlanSplit
                          ? `Comissão do profissional (plano · uso ${planUseOrdinal}/${planTotalUses}):`
                          : `Comissão do profissional (50%${isPlanAttendance ? ` sobre ${brl(planValueForUse)} rateados` : ''}):`}
                      </span>
                      <span className="font-bold text-brand-gold">{brl(calculatedComm)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>
                        {usesConfiguredPlanSplit
                          ? `Parte do salão neste uso (${planSalonSharePercentForUsage}%)`
                          : 'Parte do salão (50%)'}
                      </span>
                      <span>{brl(usesConfiguredPlanSplit ? planSalonValueForUse : manualCommissionTarget)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border-b border-brand-border/70 pb-2 pt-1">
              <div className="flex items-center gap-1">
                <h4 className="text-xs font-bold uppercase tracking-wide text-brand-gold">Valores, produtos e pagamento</h4>
                <FeatureInfo label="Valores, produtos e pagamento">Revise o valor do serviço, informe gorjeta, produtos consumidos e forma de pagamento antes de salvar.</FeatureInfo>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                 <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Valor do Serviço</label>
                  <input data-testid="input-attendance-service-value" type="number" min="0" step="0.01" required readOnly={isPlanMode} value={isPlanMode ? '0' : value} onChange={e => setValue(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none read-only:opacity-70" placeholder={isPlanMode ? 'Incluído na mensalidade do plano' : 'Digite o valor'} />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Gorjeta (R$)</label>
                <input type="number" step="0.01" min="0" value={tip} onChange={e => setTip(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none" />
              </div>
            </div>

            <div>
                  <div className="mb-1 flex items-center gap-1">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-foreground">
                      Produtos Consumidos{isProsthesisApplication ? ' · custos descontados do lucro' : ''}
                    </label>
                    {isProsthesisApplication && (
                      <FeatureInfo label="Produto de prótese capilar">O produto marcado como prótese capilar é adicionado automaticamente e descontado do estoque e do lucro do Marcos, sem cobrança extra ao cliente.</FeatureInfo>
                    )}
                  </div>
              {isProsthesisApplication && !hasProsthesisProductSelected && (
                <p role="alert" className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {markedProsthesisProducts.length === 0
                    ? 'Marque o produto como prótese capilar em Produtos & Estoque para adicioná-lo automaticamente.'
                    : 'Escolha um produto marcado como prótese capilar para registrar o custo corretamente.'}
                </p>
              )}
              <div className="space-y-2">
                {apptProducts.map((ap, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <select
                      ref={element => { productSelectRefs.current[i] = element; }}
                      data-testid={`select-attendance-product-${i}`}
                      value={ap.productId}
                      onChange={e => updateApptProduct(i, 'productId', e.target.value)}
                      className="min-h-11 min-w-0 flex-1 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none"
                    >
                      <option value="">Selecione o produto...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.isProsthesisCapillary ? ' · prótese capilar' : ''} ({p.stock} em estoque)</option>)}
                    </select>
                    <input type="number" min="1" value={ap.quantity} aria-label={`Quantidade do produto ${i + 1}`} onChange={e => updateApptProduct(i, 'quantity', parseInt(e.target.value) || 1)} className="min-h-11 w-20 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none" />
                    <button type="button" aria-label="Remover produto" onClick={() => removeApptProduct(i)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-destructive transition-all hover:bg-destructive/10 hover:scale-105"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={handleAddProduct} className="flex min-h-11 items-center gap-1 text-sm font-medium text-brand-gold hover:underline"><Plus className="w-4 h-4" /> Adicionar Produto</button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Forma de Pagamento *</label>
              <select data-testid="select-attendance-payment-method" value={payMethod} onChange={e => setPayMethod(e.target.value as PayMethod)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none">
                {config.paymentMethods.filter(p => p.isActive).map(payment => <option key={payment.key} value={payment.key}>{payment.label}</option>)}
              </select>
              <div className="mt-2 space-y-2">
                {paymentSplits.map((payment, index) => (
                  <div key={index} className="flex gap-2">
                    <select
                      data-testid={`select-attendance-payment-split-${index}`}
                      ref={element => { paymentMethodSelectRefs.current[index] = element; }}
                      value={payment.method}
                      onChange={e => setPaymentSplits(items => items.map((item, i) => i === index ? { ...item, method: e.target.value as PayMethod } : item))}
                      className="min-h-11 min-w-0 flex-1 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-brand-gold"
                    >
                      {config.paymentMethods.filter(p => p.isActive).map(paymentOption => <option key={paymentOption.key} value={paymentOption.key}>{paymentOption.label}</option>)}
                    </select>
                    <input type="number" min="0" step="0.01" value={payment.amount || ''} onChange={e => setPaymentSplits(items => items.map((item, i) => i === index ? { ...item, amount: Number(e.target.value) } : item))} className="min-h-11 w-28 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm" aria-label={`Valor da forma ${index + 1}`} />
                    <button type="button" onClick={() => setPaymentSplits(items => items.filter((_, i) => i !== index))} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-destructive" aria-label="Remover forma de pagamento"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    pendingAttendanceFocus.current = { kind: 'payment', index: paymentSplits.length };
                    setPaymentSplits(items => [...items, { method: 'pix', amount: 0 }]);
                  }}
                  className="min-h-11 text-sm font-medium text-brand-gold hover:underline"
                >
                  + Adicionar Forma de Pagamento
                </button>
              </div>
            </div>
            
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Observações</label>
              <textarea data-testid="input-attendance-notes" aria-label="Observações" value={notes} onChange={e => setNotes(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none h-20 resize-none"></textarea>
            </div>

            <div data-testid="attendance-submit-bar" className="mt-2 border-t border-brand-border/70 pt-4">
              <button type="submit" data-testid="button-save-attendance" className="min-h-12 w-full rounded-xl bg-brand-gold py-3 font-bold text-brand-bg transition-all hover:bg-brand-gold/90">
                Salvar atendimento · {brl(serviceValue + (parseFloat(tip)||0) + totalProducts)}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          {/* Lançar Despesa */}
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Lançar Despesa</h3>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Data *</label>
                  <input type="date" required value={expDate} onChange={e => setExpDate(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Categoria *</label>
                  <select required value={expCategory} onChange={e => setExpCategory(e.target.value as ExpenseCategory)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none">
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Descrição *</label>
                <input type="text" required value={expDesc} onChange={e => setExpDesc(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none" />
              </div>
              
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Valor (R$) *</label>
                <input type="number" step="0.01" min="0.01" required value={expAmount} onChange={e => setExpAmount(e.target.value)} className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2 mt-1 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none" />
              </div>
              
              <button type="submit" className="w-full bg-brand-surface border border-destructive text-destructive font-bold py-3 rounded-lg hover:bg-destructive/10 transition-all">
                Registrar Despesa
              </button>
            </form>
          </div>

          {/* Estoque em Alerta */}
          {!isReceptionist && <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
            <h3 className="text-lg font-bold text-foreground mb-4">Estoque em Alerta</h3>
            {alertProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todos os produtos estão com estoque regular.</p>
            ) : (
              <div className="space-y-2">
                {alertProducts.map(p => (
                  <div key={p.id} className="flex justify-between items-center p-3 rounded-lg bg-brand-bg border border-brand-border">
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${productStatus(p) === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                      {p.stock} / min {p.minStock}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>}
          {isReceptionist && (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
              <h3 className="text-lg font-bold text-foreground mb-2">Fluxo da recepção</h3>
              <p className="text-sm text-muted-foreground">
                Escolha o cliente, serviço, profissional e pagamento. O atendimento ficará registrado no histórico do cliente e na agenda da equipe.
              </p>
            </div>
          )}
        </div>
      </div>

      {isReceptionist ? (
        <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6" aria-labelledby="reception-today-title">
          <div className="mb-4">
            <h3 id="reception-today-title" className="text-lg font-bold text-foreground">Atendimentos de hoje</h3>
            <p className="text-xs text-muted-foreground">{todayAppts.length} atendimento(s) registrados</p>
          </div>
          {todayAppts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum atendimento registrado hoje.</p>
          ) : (
            <div className="space-y-2">
              {[...todayAppts].sort((a, b) => a.time.localeCompare(b.time)).map(appointment => (
                <article key={appointment.id} className="flex flex-col gap-1 rounded-xl border border-brand-border bg-brand-bg p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {appointment.client} <span className="font-normal text-muted-foreground">· {appointment.service}</span>
                      {appointment.planSubscriberId && <span className="ml-2 rounded-full bg-brand-gold/10 px-2 py-0.5 text-[10px] font-semibold text-brand-gold">Plano</span>}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {appointment.time} · {appointmentProfessionalLabel(appointment)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-fit rounded-full bg-brand-gold/10 px-2 py-1 text-[10px] font-semibold text-brand-gold">
                      {appointment.status === 'completed' ? 'Concluído' : appointment.status === 'checked_in' ? 'Em atendimento' : appointment.status === 'cancelled' ? 'Cancelado' : appointment.status === 'no_show' ? 'Falta' : 'Registrado'}
                    </span>
                    {deleteAttendanceAction(appointment.id, appointment.client)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Movimentações do Dia</h3>
        {isLoading ? (
          <div className="space-y-3">{Array.from({length: 3}).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : movs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhuma movimentação registrada hoje.</p>
          </div>
        ) : (
          <div>
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-brand-border text-muted-foreground">
                      <th className="pb-3 font-medium">Tipo</th>
                      <th className="pb-3 font-medium">Horário</th>
                      <th className="pb-3 font-medium">Descrição</th>
                      <th className="pb-3 font-medium text-right">Valor</th>
                      <th className="pb-3 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movs.map(m => (
                      <tr
                        key={m.id}
                        data-testid={m.source === 'subscription_payment' ? 'daily-subscription-movement' : undefined}
                        className="border-b border-brand-border/50 hover:bg-brand-bg/50 transition-colors"
                      >
                        <td className="py-3">
                          {m.type === 'in' ? (
                            <span className="flex items-center gap-1 text-success text-xs font-medium"><ArrowUpRight className="w-4 h-4"/> Entrada</span>
                          ) : (
                            <span className="flex items-center gap-1 text-destructive text-xs font-medium"><ArrowDownRight className="w-4 h-4"/> Saída</span>
                          )}
                        </td>
                        <td className="py-3 text-muted-foreground tabular-nums">{m.time}</td>
                        <td className="py-3 text-muted-foreground">{m.description}</td>
                        <td className={`py-3 text-right font-medium ${m.type === 'in' ? 'text-success' : 'text-destructive'}`}>
                          {m.type === 'in' ? '+' : '-'}{brl(m.amount)}
                        </td>
                        <td className="py-2 text-right">
                          {m.source === 'appointment'
                            ? deleteAttendanceAction(m.id, m.clientName)
                            : m.source === 'expense'
                              ? deleteExpenseAction(m.id, m.description)
                              : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {movs.map(m => (
                  <div
                    key={m.id}
                    data-testid={m.source === 'subscription_payment' ? 'daily-subscription-movement' : undefined}
                    className="p-3 bg-brand-bg border border-brand-border rounded-xl flex justify-between items-center gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{m.description}</p>
                      <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{m.time}</p>
                      {m.type === 'in' ? (
                        <span className="flex items-center gap-1 text-success text-xs font-medium mt-0.5"><ArrowUpRight className="w-3 h-3"/> Entrada</span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive text-xs font-medium mt-0.5"><ArrowDownRight className="w-3 h-3"/> Saída</span>
                      )}
                    </div>
                    <span className={`font-bold text-sm ml-2 shrink-0 ${m.type === 'in' ? 'text-success' : 'text-destructive'}`}>
                      {m.type === 'in' ? '+' : '-'}{brl(m.amount)}
                    </span>
                    {m.source === 'appointment'
                      ? deleteAttendanceAction(m.id, m.clientName)
                      : m.source === 'expense'
                        ? deleteExpenseAction(m.id, m.description)
                        : null}
                  </div>
                ))}
              </div>
            </>
            <div className="mt-4 grid grid-cols-1 gap-1 border-t border-brand-border pt-4 text-sm sm:flex sm:justify-end sm:gap-6">
              <div><span className="text-muted-foreground">Entradas:</span> <span className="text-success font-bold">{brl(totalIn)}</span></div>
              <div><span className="text-muted-foreground">Saídas:</span> <span className="text-destructive font-bold">{brl(totalOut)}</span></div>
              <div><span className="text-muted-foreground">Saldo:</span> <span className={`font-bold ${totalIn >= totalOut ? 'text-success' : 'text-destructive'}`}>{brl(totalIn - totalOut)}</span></div>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
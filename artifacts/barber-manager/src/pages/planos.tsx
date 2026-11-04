import { useMemo, useState } from 'react';
import { useStore, brl, SubscriptionPaymentStatus, SubscriptionPlan, Subscriber, PayMethod, PAY_LABELS } from '@/data/store';
import { FeatureInfo } from '@/components/FeatureInfo';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogFooter, AlertDialogDescription } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CalendarClock, Check, Clock3, CreditCard, Edit2, History, MessageSquare, Plus, Receipt, RefreshCw, Trash2, Users } from 'lucide-react';
import { addSubscriptionCycle, differenceInCalendarDays, formatDateKey, parseDateKey } from '@/data/date';
import { useAuth } from '@/auth/auth';
import {
  planProfessionalAmountForUse,
  planProfessionalPoolAmount,
  planSalonShareAmount,
  planServiceBenefits,
  planServiceLabel,
  subscriberServiceUsesRemaining,
  totalPlanIncludedUses,
} from '@/data/plan-usage';
import { normalizeClientPhone } from '@/data/client-phone';
import { useRecentlyAddedIds } from '@/hooks/useRecentlyAddedIds';

const paymentMethods: PayMethod[] = ['dinheiro', 'pix', 'debito', 'credito'];
const paymentStatusLabels: Record<SubscriptionPaymentStatus, string> = {
  pago: 'Paga',
  pendente: 'Pendente',
  vencido: 'Vencida',
};

function displayDate(value: string) {
  return value ? value.split('-').reverse().join('/') : '—';
}

function statusClasses(status: SubscriptionPaymentStatus) {
  return status === 'pago'
    ? 'bg-success/10 text-success'
    : status === 'vencido'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-warning/10 text-warning';
}

function subscriberStatus(subscriber: Subscriber, today: string): SubscriptionPaymentStatus {
  if (subscriber.status === 'vencido' || subscriber.nextPayment < today) return 'vencido';
  if (subscriber.status === 'pendente') return 'pendente';
  return 'pago';
}

type NoticePeriod = '7' | '30' | 'month' | 'all';

function isSubscriberOverdue(subscriber: Subscriber, today: string) {
  return subscriber.status === 'vencido' || subscriber.nextPayment < today;
}

function editorServiceFromPlan(
  service: SubscriptionPlan['services'][number],
  configuredServices: ReturnType<typeof useStore>['config']['services'],
) {
  if (typeof service !== 'string') {
    return { serviceId: service.serviceId, usesPerCycle: String(service.usesPerCycle) };
  }
  const normalized = service.toLocaleLowerCase('pt-BR');
  const match = configuredServices.find(item => normalized.includes(item.name.toLocaleLowerCase('pt-BR')));
  const uses = Number(service.match(/\d+/)?.[0] ?? 0);
  return { serviceId: match?.id ?? '', usesPerCycle: Number.isInteger(uses) && uses > 0 ? String(uses) : '' };
}

function noticeDueLabel(subscriber: Subscriber, today: string) {
  if (isSubscriberOverdue(subscriber, today)) {
    const daysOverdue = Math.max(1, differenceInCalendarDays(subscriber.nextPayment, today));
    return `Atrasada há ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'}`;
  }
  const daysUntilDue = differenceInCalendarDays(today, subscriber.nextPayment);
  if (daysUntilDue === 0) return 'Vence hoje';
  return `Vence em ${daysUntilDue} ${daysUntilDue === 1 ? 'dia' : 'dias'}`;
}

function openSubscriberWhatsapp(subscriber: Subscriber, planName?: string) {
  const digits = subscriber.phone.replace(/\D/g, '');
  if (!digits) return;
  const phone = digits.startsWith('55') ? digits : `55${digits}`;
  const message = `Olá ${subscriber.name}, sua mensalidade${planName ? ` do plano ${planName}` : ''} vence dia ${displayDate(subscriber.nextPayment)}.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

export default function Planos() {
  const {
    plans, subscribers, subscriptionPayments, appointments, config,
    clients, addClient, addPlan, updatePlan, removePlan, addSubscriber, updateSubscriber, removeSubscriber,
    renewSubscriberPlanUsages, setSubscriptionPaymentStatus, removeSubscriptionPayment, isLoading,
  } = useStore();
  const recentlyAddedPlanIds = useRecentlyAddedIds(plans, isLoading);
  const recentlyAddedSubscriberIds = useRecentlyAddedIds(subscribers, isLoading);
  const { profile, viewAsProfile } = useAuth();
  const isManager = (viewAsProfile ?? profile)?.role === 'gestor' || (viewAsProfile ?? profile)?.role === 'dev-admin';
  const today = formatDateKey();
  const activeSubs = subscribers.filter(s => subscriberStatus(s, today) === 'pago');
  const mrr = activeSubs.reduce((total, sub) => total + (plans.find(plan => plan.id === sub.planId)?.price ?? 0), 0);

  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [planEditingId, setPlanEditingId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({
    name: '',
    price: '',
    duration: 'Mensal' as SubscriptionPlan['duration'],
    salonSharePercent: '',
    services: [{ serviceId: '', usesPerCycle: '1' }],
  });
  const planFormUses = planForm.services.reduce((total, service) => {
    const uses = Number(service.usesPerCycle);
    return total + (Number.isInteger(uses) && uses > 0 ? uses : 0);
  }, 0);
  const planFormPrice = Number(planForm.price);
  const planFormSalonPercent = Number(planForm.salonSharePercent);
  const planFormGrossCents = Math.round((planFormPrice + Number.EPSILON) * 100);
  const planFormSalonCents = Math.round(planFormGrossCents * planFormSalonPercent / 100);
  const planFormProfessionalCents = planFormGrossCents - planFormSalonCents;

  const handlePlanOpen = (plan?: SubscriptionPlan) => {
    if (plan) {
      setPlanEditingId(plan.id);
      setPlanForm({
        name: plan.name,
        price: plan.price.toString(),
        duration: plan.duration,
        salonSharePercent: plan.salonSharePercent == null ? '' : String(plan.salonSharePercent),
        services: plan.services.length
          ? plan.services.map(service => editorServiceFromPlan(service, config.services))
          : [{ serviceId: '', usesPerCycle: '1' }],
      });
    } else {
      setPlanEditingId(null);
      setPlanForm({
        name: '',
        price: '',
        duration: 'Mensal',
        salonSharePercent: '',
        services: [{ serviceId: '', usesPerCycle: '1' }],
      });
    }
    setIsPlanOpen(true);
  };

  const handlePlanSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validServices = planForm.services.map(service => {
      const configuredService = config.services.find(item => item.id === service.serviceId);
      return {
        serviceId: service.serviceId,
        serviceName: configuredService?.name ?? '',
        usesPerCycle: Number(service.usesPerCycle),
      };
    });
    const salonSharePercent = Number(planForm.salonSharePercent);
    if (
      !planForm.name
      || !planForm.price
      || !Number.isFinite(planFormPrice)
      || planFormPrice < 0
      || !planForm.salonSharePercent.trim()
      || !Number.isFinite(salonSharePercent)
      || salonSharePercent < 0
      || salonSharePercent > 100
      || validServices.length === 0
      || validServices.some(service => !service.serviceId || !service.serviceName || !Number.isInteger(service.usesPerCycle) || service.usesPerCycle < 1)
    ) {
      toast.error('Escolha cada serviço e informe ao menos 1 uso por ciclo');
      return;
    }
    if (new Set(validServices.map(service => service.serviceId)).size !== validServices.length) {
      toast.error('Cada serviço pode ser adicionado apenas uma vez ao plano');
      return;
    }
    const saved = planEditingId
      ? await updatePlan(planEditingId, {
          ...planForm,
          price: planFormPrice,
          salonSharePercent: Math.round(salonSharePercent * 100) / 100,
          services: validServices,
        })
      : await addPlan({
          ...planForm,
          price: planFormPrice,
          salonSharePercent: Math.round(salonSharePercent * 100) / 100,
          services: validServices,
        });
    if (!saved) return;
    toast.success(planEditingId ? 'Plano atualizado' : 'Plano criado');
    setIsPlanOpen(false);
  };

  const handlePlanDelete = async (id: string) => {
    if (subscribers.some(subscriber => subscriber.planId === id)) {
      toast.error('Em uso. Remova os assinantes primeiro.');
      return;
    }
    if (await removePlan(id)) toast.success('Plano removido');
  };

  const [isSubOpen, setIsSubOpen] = useState(false);
  const [subEditingId, setSubEditingId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({
    name: '', phone: '', planId: '', startDate: today,
    nextPayment: '', status: 'pendente' as 'ativo' | 'vencido' | 'pendente',
  });
  const [subClientSearch, setSubClientSearch] = useState('');
  const [selectedSubClientId, setSelectedSubClientId] = useState('');
  const [isSubSaving, setIsSubSaving] = useState(false);
  const selectedSubClient = clients.find(client => client.id === selectedSubClientId);
  const normalizedSubPhone = normalizeClientPhone(subForm.phone);
  const duplicateSubClient = !selectedSubClientId
    ? clients.find(client => normalizedSubPhone
      ? normalizeClientPhone(client.whatsapp) === normalizedSubPhone
      : Boolean(subForm.name.trim()) &&
        client.name.trim().toLocaleLowerCase('pt-BR') === subForm.name.trim().toLocaleLowerCase('pt-BR'))
    : undefined;
  const subClientSearchText = subClientSearch.trim().toLocaleLowerCase('pt-BR');
  const subClientSearchPhone = normalizeClientPhone(subClientSearch);
  const matchingSubClients = subClientSearchText
    ? clients
        .filter(client =>
          client.name.toLocaleLowerCase('pt-BR').includes(subClientSearchText)
          || (subClientSearchPhone.length > 0 && normalizeClientPhone(client.whatsapp).includes(subClientSearchPhone)),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .slice(0, 8)
    : [];

  const calculatedNextPayment = (planId: string, startDate: string) => {
    const plan = plans.find(item => item.id === planId);
    return plan && startDate ? addSubscriptionCycle(startDate, plan.duration) : '';
  };

  const handleSubOpen = (subscriber?: Subscriber) => {
    if (subscriber) {
      setSubEditingId(subscriber.id);
      const normalizedPhone = normalizeClientPhone(subscriber.phone);
      const matches = clients.filter(client => normalizedPhone
        ? normalizeClientPhone(client.whatsapp) === normalizedPhone
        : client.name.trim().toLocaleLowerCase('pt-BR') === subscriber.name.trim().toLocaleLowerCase('pt-BR'));
      const linkedClient = matches.length === 1 ? matches[0] : undefined;
      setSelectedSubClientId(linkedClient?.id ?? '');
      setSubClientSearch('');
      setSubForm({
        name: linkedClient?.name ?? subscriber.name,
        phone: linkedClient?.whatsapp ?? subscriber.phone,
        planId: subscriber.planId,
        startDate: subscriber.startDate,
        nextPayment: subscriber.nextPayment,
        status: subscriber.status,
      });
    } else {
      setSubEditingId(null);
      setSelectedSubClientId('');
      setSubClientSearch('');
      setSubForm({ name: '', phone: '', planId: '', startDate: today, nextPayment: '', status: 'pendente' });
    }
    setIsSubOpen(true);
  };

  const selectSubscriberClient = (client: (typeof clients)[number]) => {
    setSelectedSubClientId(client.id);
    setSubClientSearch('');
    setSubForm(current => ({ ...current, name: client.name, phone: client.whatsapp }));
  };

  const clearSubscriberClient = () => {
    setSelectedSubClientId('');
    setSubClientSearch('');
    setSubForm(current => ({ ...current, name: '', phone: '' }));
  };

  const handleSubSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubSaving) return;
    if (!subForm.name || !subForm.planId) {
      toast.error('Preencha os obrigatórios');
      return;
    }
    if (selectedSubClientId && !selectedSubClient) {
      toast.error('Este cliente não está mais disponível. Selecione outro cadastro.');
      return;
    }
    if (!selectedSubClient && duplicateSubClient) {
      toast.error('Este cliente já está cadastrado. Selecione-o pela busca para evitar duplicidade.');
      return;
    }
    if (!selectedSubClient && !subForm.phone.trim()) {
      toast.error('Informe o WhatsApp para cadastrar o cliente no módulo Clientes.');
      return;
    }
    const nextPayment = subEditingId && subForm.nextPayment
      ? subForm.nextPayment
      : calculatedNextPayment(subForm.planId, subForm.startDate);
    if (!nextPayment) {
      toast.error('Selecione um plano e uma data de início válidos');
      return;
    }
    setIsSubSaving(true);
    try {
      let clientRecord = selectedSubClient;
      let clientWasCreated = false;
      if (!clientRecord) {
        const savedClient = await addClient({
          name: subForm.name.trim(),
          email: '',
          whatsapp: subForm.phone.trim(),
          source: 'Outro',
          sourceOther: 'Assinante de plano',
          interest: 'barbearia',
        });
        if (!savedClient) return;
        clientRecord = savedClient;
        clientWasCreated = savedClient.wasCreated;
        setSelectedSubClientId(savedClient.id);
        setSubClientSearch('');
        setSubForm(current => ({ ...current, name: savedClient.name, phone: savedClient.whatsapp }));
      }

      const payload = {
        ...subForm,
        name: clientRecord.name,
        phone: clientRecord.whatsapp,
        nextPayment,
      };
      const saved = subEditingId
        ? await updateSubscriber(subEditingId, payload)
        : await addSubscriber(payload);
      if (!saved) {
        if (clientWasCreated) {
          toast.warning('O cliente foi salvo em Clientes, mas não foi possível concluir a assinatura. Tente novamente; o cadastro do cliente será reutilizado.');
        }
        return;
      }
      toast.success(subEditingId
        ? 'Assinante atualizado e vinculado ao cliente.'
        : clientWasCreated
          ? 'Assinante cadastrado e cliente incluído em Clientes.'
          : 'Assinante cadastrado e vinculado ao cliente existente.');
      setIsSubOpen(false);
    } finally {
      setIsSubSaving(false);
    }
  };

  const [paymentSubscriber, setPaymentSubscriber] = useState<Subscriber | null>(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isPaymentSaving, setIsPaymentSaving] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    status: 'pago' as SubscriptionPaymentStatus,
    dueDate: today,
    paidAt: today,
    amount: '',
    paymentMethod: 'dinheiro' as PayMethod,
    note: '',
  });

  const openPaymentDialog = (subscriber: Subscriber) => {
    const plan = plans.find(item => item.id === subscriber.planId);
    setPaymentSubscriber(subscriber);
    setPaymentForm({
      status: subscriberStatus(subscriber, today) === 'pago' ? 'pago' : subscriberStatus(subscriber, today),
      dueDate: subscriber.nextPayment,
      paidAt: today,
      amount: plan?.price.toFixed(2) ?? '',
      paymentMethod: 'dinheiro',
      note: '',
    });
    setIsPaymentOpen(true);
  };

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPaymentSaving) return;
    if (!paymentSubscriber || !paymentForm.dueDate || Number(paymentForm.amount) < 0) {
      toast.error('Informe um valor válido para a mensalidade');
      return;
    }
    if (paymentForm.status === 'pago' && !paymentForm.paidAt) {
      toast.error('Informe a data do recebimento');
      return;
    }
    setIsPaymentSaving(true);
    try {
      const saved = await setSubscriptionPaymentStatus({
        subscriberId: paymentSubscriber.id,
        dueDate: paymentForm.dueDate,
        status: paymentForm.status,
        paidAt: paymentForm.status === 'pago' ? paymentForm.paidAt : undefined,
        amount: Number(paymentForm.amount),
        paymentMethod: paymentForm.status === 'pago' ? paymentForm.paymentMethod : undefined,
        note: paymentForm.note.trim() || undefined,
      });
      if (!saved) return;
      toast.success(paymentForm.status === 'pago' ? 'Mensalidade confirmada presencialmente' : `Mensalidade marcada como ${paymentStatusLabels[paymentForm.status].toLowerCase()}`);
      setIsPaymentOpen(false);
    } finally {
      setIsPaymentSaving(false);
    }
  };

  const history = useMemo(
    () => [...subscriptionPayments].sort((a, b) => (b.paidAt ?? b.dueDate).localeCompare(a.paidAt ?? a.dueDate)),
    [subscriptionPayments],
  );

  const [noticePeriod, setNoticePeriod] = useState<NoticePeriod>('30');
  const noticeEndDate = useMemo(() => {
    if (noticePeriod === 'all') return '';
    const end = parseDateKey(today);
    if (noticePeriod === 'month') {
      return formatDateKey(new Date(end.getFullYear(), end.getMonth() + 1, 0, 12, 0, 0, 0));
    }
    end.setDate(end.getDate() + Number(noticePeriod));
    return formatDateKey(end);
  }, [noticePeriod, today]);
  const noticeSubscribers = useMemo(
    () => subscribers
      .filter(subscriber => {
        const overdue = isSubscriberOverdue(subscriber, today);
        const upcoming = subscriber.nextPayment >= today &&
          (noticePeriod === 'all' || subscriber.nextPayment <= noticeEndDate);
        return overdue || upcoming;
      })
      .sort((a, b) => {
        const aOverdue = isSubscriberOverdue(a, today);
        const bOverdue = isSubscriberOverdue(b, today);
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        return a.nextPayment.localeCompare(b.nextPayment);
      }),
    [noticeEndDate, noticePeriod, subscribers, today],
  );
  const overdueNoticeCount = noticeSubscribers.filter(subscriber => isSubscriberOverdue(subscriber, today)).length;
  const renewUsages = async (subscriber: Subscriber) => {
    const plan = plans.find(item => item.id === subscriber.planId);
    if (!plan || planServiceBenefits(plan).length === 0) {
      toast.error('Configure serviços e quantidades no plano antes de renovar os usos.');
      return;
    }
    if (!window.confirm(`Renovar agora os usos de ${subscriber.name}? Isso reinicia as cotas, sem alterar vencimento ou pagamento.`)) return;
    if (await renewSubscriberPlanUsages(subscriber.id)) toast.success('Usos do plano renovados.');
  };

  return (
    <div className="min-w-0 p-4 sm:p-5 md:p-8 space-y-7 sm:space-y-10 max-w-7xl mx-auto">
      <div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4 mb-5 md:mb-6">
          <div>
            <div className="flex items-center gap-1">
              <h2 className="min-w-0 text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><CreditCard className="shrink-0 text-brand-gold" /> Planos Disponíveis</h2>
              <FeatureInfo label="Planos disponíveis">Crie planos, vincule assinantes e acompanhe usos, renovações e pagamentos.</FeatureInfo>
            </div>
          </div>
          <Dialog open={isPlanOpen} onOpenChange={setIsPlanOpen}>
            <DialogTrigger asChild><button onClick={() => handlePlanOpen()} className="min-h-11 w-full md:w-auto justify-center bg-brand-surface border border-brand-border text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-bg transition-colors flex items-center gap-2"><Plus className="w-4 h-4" /> Novo Plano</button></DialogTrigger>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] overflow-y-auto bg-brand-surface border-brand-border text-foreground sm:max-w-lg">
              <DialogHeader><DialogTitle>{planEditingId ? 'Editar Plano' : 'Novo Plano'}</DialogTitle></DialogHeader>
              <form onSubmit={handlePlanSubmit} className="space-y-4 pt-4 [&_input]:min-h-11 [&_select]:min-h-11">
                <div><label className="text-xs uppercase text-muted-foreground">Nome do Plano</label><input required type="text" value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="text-xs uppercase text-muted-foreground">Valor (R$)</label><input required type="number" min="0" step="0.01" value={planForm.price} onChange={e => setPlanForm({ ...planForm, price: e.target.value })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none" /></div>
                  <div><label className="text-xs uppercase text-muted-foreground">Frequência</label><select value={planForm.duration} onChange={e => setPlanForm({ ...planForm, duration: e.target.value as SubscriptionPlan['duration'] })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none"><option>Mensal</option><option>Trimestral</option><option>Semestral</option><option>Anual</option></select></div>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1">
                    <label className="text-xs uppercase text-muted-foreground">Serviços Inclusos</label>
                    <FeatureInfo label="Serviços inclusos">
                      {Number(planForm.price) > 0 && planForm.services.every(service => Number(service.usesPerCycle) > 0)
                        ? `Valor de referência por uso: ${brl(Number(planForm.price) / planForm.services.reduce((total, service) => total + Number(service.usesPerCycle), 0))}. A comissão do profissional será aplicada sobre essa parcela.`
                        : 'Informe quantos usos de cada serviço fazem parte do ciclo do plano.'}
                    </FeatureInfo>
                  </div>
                  {planForm.services.map((service, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_2.75rem] gap-2 mb-2">
                    <select
                      required
                      data-testid={`plan-service-select-${index}`}
                      value={service.serviceId}
                      onChange={event => {
                        const services = [...planForm.services];
                        services[index] = { ...service, serviceId: event.target.value };
                        setPlanForm({ ...planForm, services });
                      }}
                      className="min-w-0 bg-brand-bg border border-brand-border rounded px-3 py-2 outline-none text-sm"
                      aria-label={`Serviço incluso ${index + 1}`}
                    >
                      <option value="">Selecione o serviço</option>
                      {config.services.filter(item => item.isActive || item.id === service.serviceId).sort((a, b) => a.sortOrder - b.sortOrder).map(item => (
                        <option key={item.id} value={item.id}>{item.name}{item.isActive ? '' : ' (inativo)'}</option>
                      ))}
                    </select>
                    <label className="min-w-0 text-[10px] uppercase text-muted-foreground">
                      Usos
                      <input
                        type="number"
                      data-testid={`plan-service-uses-${index}`}
                        min="1"
                        step="1"
                        required
                        value={service.usesPerCycle}
                        onChange={event => {
                          const services = [...planForm.services];
                          services[index] = { ...service, usesPerCycle: event.target.value };
                          setPlanForm({ ...planForm, services });
                        }}
                        className="mt-0.5 min-h-9 w-full bg-brand-bg border border-brand-border rounded px-2 py-1 text-sm text-foreground"
                        aria-label={`Quantidade de usos do serviço ${index + 1}`}
                      />
                    </label>
                    <button type="button" aria-label="Remover serviço" onClick={() => setPlanForm({ ...planForm, services: planForm.services.filter((_, itemIndex) => itemIndex !== index) })} className="mt-4 flex min-h-11 min-w-11 items-center justify-center text-destructive"><Trash2 className="w-4 h-4" /></button>
                  </div>)}
                  <button type="button" onClick={() => setPlanForm({ ...planForm, services: [...planForm.services, { serviceId: '', usesPerCycle: '1' }] })} className="min-h-11 text-xs text-brand-gold font-bold flex items-center gap-1"><Plus className="w-3 h-3" /> Adicionar serviço incluso</button>
                </div>
                <div className="rounded-xl border border-brand-border bg-brand-bg/60 p-3">
                  <div className="flex items-center gap-1">
                    <label htmlFor="plan-salon-share-percent" className="text-xs uppercase text-muted-foreground">Parte do salão (%)</label>
                    <FeatureInfo label="Divisão do valor do plano">O percentual restante é reservado aos profissionais e dividido pelos usos incluídos.</FeatureInfo>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="plan-salon-share-percent"
                      data-testid="plan-salon-share-percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      required
                      value={planForm.salonSharePercent}
                      onChange={event => setPlanForm({ ...planForm, salonSharePercent: event.target.value })}
                      className="min-h-11 w-full bg-brand-surface border border-brand-border rounded px-3 py-2 outline-none"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  {planForm.salonSharePercent.trim()
                    && Number.isFinite(planFormSalonPercent)
                    && planFormSalonPercent >= 0
                    && planFormSalonPercent <= 100
                    && planFormPrice >= 0
                    && planFormUses > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <p>Salão: <strong>{brl(planFormSalonCents / 100)}</strong></p>
                      <p>Profissionais: <strong>{brl(planFormProfessionalCents / 100)}</strong></p>
                      <p>Referência por uso: <strong>{brl(planFormProfessionalCents / 100 / planFormUses)}</strong></p>
                    </div>
                  )}
                </div>
                <button type="submit" className="min-h-11 w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg">Salvar Plano</button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6 mb-5 md:mb-6">
          <div className="bg-brand-surface border border-brand-border p-4 sm:p-5 rounded-2xl"><p className="text-xs text-muted-foreground uppercase font-semibold">Total Planos</p><p className="text-3xl font-bold mt-1">{plans.length}</p></div>
          <div className="bg-brand-surface border border-brand-border p-4 sm:p-5 rounded-2xl"><p className="text-xs text-muted-foreground uppercase font-semibold">Mensalidades em dia</p><p className="text-3xl font-bold mt-1 text-success">{activeSubs.length}</p></div>
          <div className="bg-brand-surface border border-brand-border p-4 sm:p-5 rounded-2xl"><p className="text-xs text-muted-foreground uppercase font-semibold">Receita recorrente prevista</p><p className="break-words text-2xl sm:text-3xl font-bold mt-1 text-brand-gold">{brl(mrr)}</p></div>
        </div>

        {isLoading ? <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div> :
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(plan => <div data-testid={`mobile-plan-card-${plan.id}`} key={plan.id} className={`min-w-0 bg-brand-bg border border-brand-border rounded-xl p-4 sm:p-5 flex flex-col relative group hover:border-brand-gold/30 transition-colors ${recentlyAddedPlanIds.has(plan.id) ? 'bm-list-item-enter' : ''}`}>
              <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:top-4 md:right-4 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><button aria-label={`Editar plano ${plan.name}`} onClick={() => handlePlanOpen(plan)} className="flex min-h-11 min-w-11 items-center justify-center bg-brand-surface border border-brand-border rounded text-muted-foreground hover:text-foreground"><Edit2 className="w-4 h-4" /></button><button aria-label={`Excluir plano ${plan.name}`} onClick={() => handlePlanDelete(plan.id)} className="flex min-h-11 min-w-11 items-center justify-center bg-brand-surface border border-brand-border rounded text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></button></div>
              <h4 data-testid={`mobile-plan-name-${plan.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] pr-24 font-bold text-lg">{plan.name}</h4><p className="text-brand-gold font-bold text-2xl mt-1 break-words">{brl(plan.price)}<span className="text-sm text-muted-foreground font-normal"> / {plan.duration.toLowerCase()}</span></p>
              <div className="mt-4 flex-1"><ul className="space-y-2 text-sm text-muted-foreground">{plan.services.map((service, index) => <li key={index} className="flex min-w-0 items-start gap-2"><Check className="w-4 h-4 text-brand-gold shrink-0 mt-0.5" /><span data-testid={`mobile-plan-service-${plan.id}-${index}`} className="min-w-0 break-words [overflow-wrap:anywhere]">{planServiceLabel(service)}</span></li>)}</ul></div>
              <div className="mt-4 rounded-lg border border-brand-border bg-brand-surface p-3 text-xs">
                {plan.salonSharePercent == null ? (
                  <>
                    <p className="font-semibold text-warning">Rateio novo não configurado</p>
                    <FeatureInfo label="Rateio do plano">Este plano mantém a regra de comissão atual até configurar a parte do salão.</FeatureInfo>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-foreground">
                      Salão {plan.salonSharePercent}% · Profissionais {100 - plan.salonSharePercent}%
                    </p>
                    <div className="mt-1">
                      <FeatureInfo label={`Rateio de ${plan.name}`}>
                        {totalPlanIncludedUses(plan)} usos · {brl(planProfessionalPoolAmount(plan) ?? 0)} reservados aos profissionais · primeiro uso: {brl(planProfessionalAmountForUse(plan, 1) ?? 0)} · parte do salão no valor atual: {brl(planSalonShareAmount(plan) ?? 0)}.
                      </FeatureInfo>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-5 pt-4 border-t border-brand-border flex justify-between items-center text-sm"><span className="text-muted-foreground">Assinantes:</span><span className="font-bold">{subscribers.filter(subscriber => subscriber.planId === plan.id).length}</span></div>
            </div>)}
          </div>}
      </div>

      <section className="pt-8 border-t border-brand-border">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <div className="flex items-center gap-1">
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><CalendarClock className="text-brand-gold" /> Avisos de vencimento</h2>
              <FeatureInfo label="Avisos de vencimento">Consulte mensalidades atrasadas e próximos vencimentos no período selecionado.</FeatureInfo>
            </div>
          </div>
          <div className="flex min-w-0 flex-col sm:flex-row items-stretch sm:items-center gap-3 text-sm text-muted-foreground">
            <label className="flex items-center gap-2">
              <span className="whitespace-nowrap">Período</span>
              <select value={noticePeriod} onChange={event => setNoticePeriod(event.target.value as NoticePeriod)} className="min-h-11 w-full min-w-0 bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-sm text-foreground" aria-label="Período dos avisos de vencimento">
                <option value="7">Próximos 7 dias</option>
                <option value="30">Próximos 30 dias</option>
                <option value="month">Até o fim do mês</option>
                <option value="all">Todos os vencimentos</option>
              </select>
            </label>
          </div>
        </div>

        <div className="min-w-0 bg-brand-surface border border-brand-border rounded-2xl p-3 sm:p-6">
          {isLoading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div> :
            noticeSubscribers.length === 0 ? <div className="text-center py-8 text-muted-foreground"><CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>Nenhum vencimento no período selecionado.</p></div> :
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-4">
                  <span>{noticeSubscribers.length} {noticeSubscribers.length === 1 ? 'aviso' : 'avisos'} no período</span>
                  {overdueNoticeCount > 0 && <span className="px-2 py-1 rounded-full bg-destructive/10 text-destructive font-semibold">{overdueNoticeCount} atrasada{overdueNoticeCount === 1 ? '' : 's'}</span>}
                </div>
                {noticeSubscribers.map(subscriber => {
                  const plan = plans.find(item => item.id === subscriber.planId);
                  const overdue = isSubscriberOverdue(subscriber, today);
                  return <div data-testid={`card-subscription-notice-${subscriber.id}`} key={subscriber.id} className={`grid min-w-0 grid-cols-1 gap-3 p-3 sm:p-4 rounded-xl border md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4 ${overdue ? 'bg-destructive/5 border-destructive/20' : 'bg-brand-bg border-brand-border/70'} ${recentlyAddedSubscriberIds.has(subscriber.id) ? 'bm-list-item-enter' : ''}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p data-testid={`text-subscription-notice-name-${subscriber.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] font-semibold">{subscriber.name}</p>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${overdue ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>{overdue ? 'Atrasada' : 'Próxima'}</span>
                      </div>
                      <p data-testid={`text-subscription-notice-plan-${subscriber.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-muted-foreground mt-1">{plan?.name || 'Plano não encontrado'} · Vencimento: {displayDate(subscriber.nextPayment)}</p>
                      <p className={`min-w-0 break-words [overflow-wrap:anywhere] text-xs font-medium mt-1 ${overdue ? 'text-destructive' : 'text-warning'}`}>{noticeDueLabel(subscriber, today)}</p>
                    </div>
                    {subscriber.phone && <button type="button" data-testid={`button-subscription-notice-whatsapp-${subscriber.id}`} aria-label={`Abrir WhatsApp de ${subscriber.name}`} onClick={() => openSubscriberWhatsapp(subscriber, plan?.name)} className="min-h-11 justify-self-start shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-2 text-xs font-semibold text-[#25D366] hover:bg-[#25D366]/20 transition-colors md:justify-self-end"><MessageSquare className="w-4 h-4" /> WhatsApp</button>}
                  </div>;
                })}
              </div>}
        </div>
      </section>

      <div className="pt-8 border-t border-brand-border">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-1"><h2 className="text-2xl font-bold text-foreground flex items-center gap-2"><Users className="text-brand-gold" /> Assinantes</h2><FeatureInfo label="Assinantes">Controle os ciclos e confirme mensalidades presencialmente. Não há cobrança online.</FeatureInfo></div>
          <Dialog open={isSubOpen} onOpenChange={setIsSubOpen}>
            <DialogTrigger asChild><button onClick={() => handleSubOpen()} className="min-h-11 w-full md:w-auto justify-center bg-brand-gold text-brand-bg px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-gold/90 flex items-center gap-2"><Plus className="w-4 h-4" /> Adicionar Assinante</button></DialogTrigger>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] overflow-y-auto bg-brand-surface border-brand-border text-foreground sm:max-w-lg">
              <DialogHeader><DialogTitle>{subEditingId ? 'Editar Assinante' : 'Novo Assinante'}</DialogTitle></DialogHeader>
              <form onSubmit={handleSubSubmit} className="space-y-4 pt-4 [&_input]:min-h-11 [&_select]:min-h-11">
                 <div>
                   <div className="flex items-center gap-1"><p id="subscriber-client-search-label" className="text-xs uppercase text-muted-foreground">Buscar cliente cadastrado</p><FeatureInfo label="Vincular assinante">Pesquise pelo nome ou telefone para reutilizar um cliente existente. Se não encontrar, o cadastro do cliente será criado junto com a assinatura.</FeatureInfo></div>
                   {selectedSubClient ? (
                     <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-brand-gold/50 bg-brand-bg px-4 py-2">
                       <div className="min-w-0">
                         <p className="truncate text-sm font-semibold text-foreground">{selectedSubClient.name}</p>
                         <p className="truncate text-xs text-muted-foreground">{selectedSubClient.whatsapp || 'Sem telefone cadastrado'}</p>
                       </div>
                       <button
                         type="button"
                         data-testid="button-clear-subscriber-client"
                         onClick={clearSubscriberClient}
                         className="shrink-0 text-xs font-semibold text-brand-gold hover:underline"
                       >
                         Trocar cliente
                       </button>
                     </div>
                   ) : (
                     <>
                       <input
                         id="subscriber-client-search"
                         data-testid="input-subscriber-client-search"
                         type="search"
                         autoComplete="off"
                         value={subClientSearch}
                         onChange={event => setSubClientSearch(event.target.value)}
                         className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-2 text-sm text-foreground outline-none transition-all focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                         placeholder="Pesquise por nome ou telefone"
                         aria-labelledby="subscriber-client-search-label"
                         aria-controls="subscriber-client-results"
                       />
                       {subClientSearchText && (
                         <div id="subscriber-client-results" className="mt-1 overflow-hidden rounded-lg border border-brand-border bg-brand-bg">
                           {matchingSubClients.length > 0 ? matchingSubClients.map(client => (
                             <button
                               key={client.id}
                               type="button"
                               data-testid={`button-select-subscriber-client-${client.id}`}
                               onClick={() => selectSubscriberClient(client)}
                               className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-brand-border px-4 py-2 text-left last:border-b-0 hover:bg-brand-surface"
                             >
                               <span className="truncate text-sm font-medium text-foreground">{client.name}</span>
                               <span className="shrink-0 text-xs text-muted-foreground">{client.whatsapp || 'Sem telefone'}</span>
                             </button>
                           )) : (
                             <p className="px-4 py-3 text-sm text-muted-foreground">
                               Nenhum cliente encontrado. Preencha os dados abaixo; o novo cliente será cadastrado em Clientes junto com a assinatura.
                             </p>
                           )}
                         </div>
                       )}
                     </>
                   )}
                 </div>
                 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                   <div>
                     <label htmlFor="subscriber-client-name" className="text-xs uppercase text-muted-foreground">Nome do cliente *</label>
                     <input
                       id="subscriber-client-name"
                       data-testid="input-subscriber-client-name"
                       required
                       type="text"
                       readOnly={Boolean(selectedSubClient)}
                       value={subForm.name}
                       onChange={event => {
                         setSelectedSubClientId('');
                         setSubClientSearch('');
                         setSubForm(current => ({ ...current, name: event.target.value }));
                       }}
                       className="mt-1 w-full rounded border border-brand-border bg-brand-bg px-3 py-2 outline-none read-only:opacity-70"
                     />
                   </div>
                   <div>
                     <label htmlFor="subscriber-client-phone" className="text-xs uppercase text-muted-foreground">
                       WhatsApp{selectedSubClient ? '' : ' *'}
                     </label>
                     <input
                       id="subscriber-client-phone"
                       data-testid="input-subscriber-client-phone"
                       required={!selectedSubClient}
                       type="tel"
                       inputMode="tel"
                       autoComplete="tel"
                       readOnly={Boolean(selectedSubClient)}
                       value={subForm.phone}
                       onChange={event => {
                         setSelectedSubClientId('');
                         setSubClientSearch('');
                         setSubForm(current => ({ ...current, phone: event.target.value }));
                       }}
                       className="mt-1 w-full rounded border border-brand-border bg-brand-bg px-3 py-2 outline-none read-only:opacity-70"
                       placeholder="(11) 99999-9999"
                     />
                   </div>
                 </div>
                 {duplicateSubClient ? (
                   <p data-testid="status-subscriber-client-duplicate" role="status" className="text-sm font-medium text-amber-700 dark:text-amber-400">
                     Esse cliente já está cadastrado. Selecione-o na busca para reutilizar o cadastro.
                   </p>
                 ) : selectedSubClient ? (
                   <p role="status" className="text-xs text-muted-foreground">O assinante será vinculado a este cadastro de cliente.</p>
                 ) : null}
                 <div><label className="text-xs uppercase text-muted-foreground">Plano *</label><select required value={subForm.planId} onChange={e => { const planId = e.target.value; setSubForm({ ...subForm, planId, nextPayment: calculatedNextPayment(planId, subForm.startDate) }); }} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none"><option value="">Selecione...</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="text-xs uppercase text-muted-foreground">Início</label><input type="date" required value={subForm.startDate} onChange={e => setSubForm({ ...subForm, startDate: e.target.value, nextPayment: calculatedNextPayment(subForm.planId, e.target.value) })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none text-sm" /></div><div><div className="flex items-center gap-1"><label className="text-xs uppercase text-muted-foreground">Próximo vencimento</label><FeatureInfo label="Ciclo e usos do plano">O vencimento é calculado pelo ciclo do plano. Confirme o recebimento no Controle Diário. Renovar usos não altera o vencimento; trocar o assinante para outro plano reinicia as cotas.</FeatureInfo></div><div className="min-h-11 w-full bg-brand-bg/60 border border-brand-border rounded px-3 py-3 mt-1 text-sm text-muted-foreground">{subForm.nextPayment ? displayDate(subForm.nextPayment) : 'Selecione o plano'}</div></div></div>
                 <button type="submit" disabled={isSubSaving} className="min-h-11 w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg disabled:cursor-not-allowed disabled:opacity-60">{isSubSaving ? 'Salvando...' : 'Salvar Assinante'}</button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="min-w-0 bg-brand-surface border border-brand-border rounded-2xl p-3 sm:p-6">
          {isLoading ? <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-12" />)}</div> : subscribers.length === 0 ? <p className="text-center py-10 text-muted-foreground">Nenhum assinante</p> : <>
                  <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left"><thead><tr className="border-b border-brand-border text-muted-foreground"><th className="pb-3">Nome</th><th className="pb-3">Plano</th><th className="pb-3">Próx. Venc.</th><th className="pb-3 text-center">Status</th><th className="pb-3 text-right">Ações</th></tr></thead>
                <tbody>{subscribers.map(subscriber => {
                  const plan = plans.find(item => item.id === subscriber.planId);
                  const status = subscriberStatus(subscriber, today);
                  const benefits = planServiceBenefits(plan);
                  return <tr key={subscriber.id} className={`border-b border-brand-border/50 hover:bg-brand-bg/50 ${recentlyAddedSubscriberIds.has(subscriber.id) ? 'bm-list-item-enter' : ''}`}><td className="py-3 font-medium">{subscriber.name}<br /><span className="text-xs text-muted-foreground font-normal">{subscriber.phone}</span></td><td className="py-3 font-medium text-brand-gold">{plan?.name || '—'}{benefits.length > 0 && <div className="mt-1 space-y-0.5 text-xs font-normal text-muted-foreground">{benefits.map(benefit => <p key={benefit.serviceId}>{benefit.serviceName}: {subscriberServiceUsesRemaining(appointments, subscriber, benefit)} de {benefit.usesPerCycle} usos restantes</p>)}</div>}</td><td className="py-3">{displayDate(subscriber.nextPayment)}</td><td className="py-3 text-center"><span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${statusClasses(status)}`}>{paymentStatusLabels[status]}</span></td><td className="py-3 text-right"><div className="flex justify-end gap-1">
                    <button aria-label={`Registrar mensalidade de ${subscriber.name}`} title="Registrar mensalidade presencial" onClick={() => openPaymentDialog(subscriber)} className="p-1.5 text-brand-gold hover:bg-brand-gold/10 rounded"><Receipt className="w-4 h-4" /></button>
                    {benefits.length > 0 && <button type="button" aria-label={`Renovar usos do plano de ${subscriber.name}`} title="Renovar usos do plano" onClick={() => renewUsages(subscriber)} className="p-1.5 text-brand-gold hover:bg-brand-gold/10 rounded"><RefreshCw className="w-4 h-4" /></button>}
                     {subscriber.phone && <button aria-label={`Enviar WhatsApp para ${subscriber.name}`} onClick={() => openSubscriberWhatsapp(subscriber, plan?.name)} className="p-1.5 text-[#25D366] hover:bg-[#25D366]/10 rounded"><MessageSquare className="w-4 h-4" /></button>}
                    <button aria-label={`Editar assinante ${subscriber.name}`} onClick={() => handleSubOpen(subscriber)} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-brand-bg rounded"><Edit2 className="w-4 h-4" /></button>
                    <AlertDialog><AlertDialogTrigger asChild><button aria-label={`Excluir assinante ${subscriber.name}`} className="p-1.5 text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-4 h-4" /></button></AlertDialogTrigger><AlertDialogContent className="bg-brand-surface border-brand-border text-foreground"><AlertDialogHeader><AlertDialogTitle>Excluir Assinante?</AlertDialogTitle><AlertDialogDescription>Excluir o cadastro e o histórico presencial deste assinante?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white" onClick={async () => { if (await removeSubscriber(subscriber.id)) toast.success('Excluído'); }}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                  </div></td></tr>;
                })}</tbody>
              </table>
            </div>
             <div className="md:hidden space-y-3">{subscribers.map(subscriber => {
              const plan = plans.find(item => item.id === subscriber.planId);
              const status = subscriberStatus(subscriber, today);
                const benefits = planServiceBenefits(plan);
                return <div key={subscriber.id} className={`min-w-0 p-3 sm:p-4 bg-brand-bg border border-brand-border rounded-xl ${recentlyAddedSubscriberIds.has(subscriber.id) ? 'bm-list-item-enter' : ''}`}><div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 mb-2"><div className="min-w-0"><p className="break-words font-bold text-sm">{subscriber.name}</p><p className="break-words text-xs text-brand-gold font-medium">{plan?.name || '—'}</p>{benefits.length > 0 && <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">{benefits.map(benefit => <p key={benefit.serviceId} className="break-words">{benefit.serviceName}: {subscriberServiceUsesRemaining(appointments, subscriber, benefit)} de {benefit.usesPerCycle} usos restantes</p>)}</div>}</div><div className="flex max-w-full flex-col items-end gap-2"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusClasses(status)}`}>{paymentStatusLabels[status]}</span><span className="text-right text-xs text-muted-foreground">Vence: {displayDate(subscriber.nextPayment)}</span></div></div><div className="flex gap-1 pt-2 border-t border-brand-border/50 justify-end"><button aria-label={`Registrar mensalidade de ${subscriber.name}`} onClick={() => openPaymentDialog(subscriber)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-gold hover:bg-brand-gold/10 rounded"><Receipt className="w-4 h-4" /></button>{benefits.length > 0 && <button type="button" aria-label={`Renovar usos do plano de ${subscriber.name}`} onClick={() => renewUsages(subscriber)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-gold hover:bg-brand-gold/10 rounded"><RefreshCw className="w-4 h-4" /></button>}{subscriber.phone && <button aria-label={`Enviar WhatsApp para ${subscriber.name}`} onClick={() => openSubscriberWhatsapp(subscriber, plan?.name)} className="flex min-h-11 min-w-11 items-center justify-center text-[#25D366] hover:bg-[#25D366]/10 rounded"><MessageSquare className="w-4 h-4" /></button>}<button aria-label={`Editar assinante ${subscriber.name}`} onClick={() => handleSubOpen(subscriber)} className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground rounded"><Edit2 className="w-4 h-4" /></button><AlertDialog><AlertDialogTrigger asChild><button aria-label={`Excluir assinante ${subscriber.name}`} className="flex min-h-11 min-w-11 items-center justify-center text-destructive hover:bg-destructive/10 rounded"><Trash2 className="w-4 h-4" /></button></AlertDialogTrigger><AlertDialogContent className="bg-brand-surface border-brand-border text-foreground"><AlertDialogHeader><AlertDialogTitle>Excluir Assinante?</AlertDialogTitle><AlertDialogDescription>Excluir o cadastro e o histórico presencial deste assinante?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white" onClick={async () => { if (await removeSubscriber(subscriber.id)) toast.success('Excluído'); }}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>;
            })}</div>
          </>}
        </div>
      </div>

      <section className="pt-8 border-t border-brand-border">
        <div className="mb-4 flex items-center gap-2"><History className="text-brand-gold" /><h2 className="text-2xl font-bold">Histórico presencial</h2><FeatureInfo label="Histórico presencial">Consulte confirmações, pendências e vencimentos registrados em cada ciclo.</FeatureInfo></div>
        <div className="min-w-0 bg-brand-surface border border-brand-border rounded-2xl p-3 sm:p-6">
          {history.length === 0 ? <p className="text-center py-8 text-muted-foreground">Nenhuma mensalidade registrada ainda.</p> : <div className="space-y-3">{history.slice(0, 20).map(payment => {
            const subscriber = subscribers.find(item => item.id === payment.subscriberId);
             return <div key={payment.id} className="grid min-w-0 grid-cols-1 md:grid-cols-[1.3fr_0.8fr_0.8fr_0.8fr_1.5fr_auto] gap-2 md:gap-4 items-center p-3 bg-brand-bg border border-brand-border/70 rounded-xl text-sm"><div className="min-w-0"><p className="break-words font-semibold">{subscriber?.name || 'Assinante removido'}</p><p className="text-xs text-muted-foreground">Vencimento: {displayDate(payment.dueDate)}</p></div><span className={`w-fit px-2 py-1 rounded text-[10px] font-bold uppercase ${statusClasses(payment.status)}`}>{paymentStatusLabels[payment.status]}</span><span className="text-muted-foreground"><span className="text-xs block">Data</span>{displayDate(payment.paidAt ?? payment.dueDate)}</span><span className="font-semibold">{brl(payment.amount)}<span className="block text-xs text-muted-foreground font-normal">{payment.paymentMethod ? PAY_LABELS[payment.paymentMethod] : 'Sem recebimento'}</span></span><span className="min-w-0 whitespace-normal break-words text-muted-foreground" title={payment.note}>{payment.note || 'Sem observação'}</span>{isManager && <button type="button" onClick={async () => { if (!window.confirm(`Excluir o histórico da mensalidade de ${subscriber?.name || 'assinante'}?`)) return; if (await removeSubscriptionPayment(payment.id)) toast.success('Histórico da mensalidade excluído.'); }} aria-label="Excluir histórico da mensalidade" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>}</div>;
          })}</div>}
        </div>
      </section>

      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90dvh] overflow-y-auto bg-brand-surface border-brand-border text-foreground sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>Controle de mensalidade presencial</DialogTitle>
              <FeatureInfo label="Atualizar ciclo">A alteração é feita manualmente e não cria uma cobrança online.</FeatureInfo>
            </div>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Assinante: <strong className="text-foreground">{paymentSubscriber?.name}</strong></p>
          <form onSubmit={handlePaymentSubmit} className="space-y-4 pt-2 [&_input]:min-h-11 [&_select]:min-h-11">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="text-xs uppercase text-muted-foreground">Status *</label><select value={paymentForm.status} onChange={e => setPaymentForm({ ...paymentForm, status: e.target.value as SubscriptionPaymentStatus })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none"><option value="pago">Paga</option><option value="pendente">Pendente</option><option value="vencido">Vencida</option></select></div><div><label className="text-xs uppercase text-muted-foreground">Vencimento</label><input type="date" required value={paymentForm.dueDate} onChange={e => setPaymentForm({ ...paymentForm, dueDate: e.target.value })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none text-sm" /></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="text-xs uppercase text-muted-foreground">Valor (R$)</label><input type="number" min="0" step="0.01" required value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none" /></div>{paymentForm.status === 'pago' && <div><label className="text-xs uppercase text-muted-foreground">Recebido em *</label><input type="date" required value={paymentForm.paidAt} onChange={e => setPaymentForm({ ...paymentForm, paidAt: e.target.value })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none text-sm" /></div>}</div>
            {paymentForm.status === 'pago' && <div><label className="text-xs uppercase text-muted-foreground">Forma de pagamento *</label><select required value={paymentForm.paymentMethod} onChange={e => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value as PayMethod })} className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none">{paymentMethods.map(method => <option key={method} value={method}>{PAY_LABELS[method]}</option>)}</select></div>}
            <div><label className="text-xs uppercase text-muted-foreground">Observação da confirmação presencial</label><textarea rows={3} value={paymentForm.note} onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })} placeholder="Ex.: recebido no balcão pelo gestor" className="w-full bg-brand-bg border border-brand-border rounded px-3 py-2 mt-1 outline-none resize-none" /></div>
            <div className="flex gap-2 text-xs text-muted-foreground bg-brand-bg border border-brand-border rounded-lg p-3"><Clock3 className="w-4 h-4 text-brand-gold shrink-0" /> Ao marcar como paga, o próximo vencimento avançará automaticamente conforme o ciclo do plano.</div>
            <button type="submit" disabled={isPaymentSaving} className="min-h-11 w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed">{isPaymentSaving ? 'Salvando...' : 'Salvar controle presencial'}</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
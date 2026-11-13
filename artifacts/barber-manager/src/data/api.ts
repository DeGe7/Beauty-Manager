import { supabase } from '@/services/supabaseClient';
import type {
  DevAdminProvisionResult,
  OrganizationManagerProvisionResult,
} from '@workspace/api-client-react';
import { getStorageObjectPath } from '@/services/storage';
import { formatTimestampDateKey } from './date';
import type { CashClosing, ExpenseCategory, PayMethod, ProductSale, SubscriptionPayment, SubscriptionPaymentStatus, Subscriber } from './store';
import type { CashClosingFrequency } from './cash-closing';

type Row = Record<string, unknown>;
type HistoryModule = 'client_visits' | 'finance' | 'sales' | 'communication' | 'subscription_payments' | 'team_access';
type HistoryItemType = 'finance_change' | 'communication_send' | 'subscription_payment' | 'join_request_event' | 'cash_closing';

export interface OrganizationInvitation {
  id: string;
  email: string;
  phone?: string;
  professionalId: string;
  role: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  revokedByName?: string;
  invitedByName?: string;
  createdAt: string;
  emailDeliveryStatus?: InvitationEmailDeliveryStatus;
  emailDeliveryUpdatedAt?: string;
}

export type InvitationEmailDeliveryStatus =
  | 'sent'
  | 'delayed'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'complained';

export interface CreatedInvitation extends OrganizationInvitation {
  token: string;
}

export interface PublicInvitationInfo {
  valid: boolean;
  status: 'valid' | 'invalid' | 'expired' | 'revoked' | 'used';
  channel?: 'email' | 'phone';
  email?: string;
  organizationName?: string;
  professionalName?: string;
}

export type OrganizationJoinRequestStatus = 'pending' | 'approved' | 'rejected';

export interface OrganizationJoinRequest {
  id: string;
  userId?: string;
  applicantName: string;
  applicantEmail?: string;
  applicantPhone?: string;
  status: OrganizationJoinRequestStatus;
  professionalId?: string;
  requestedAt: string;
  reviewedAt?: string;
  hiddenAt?: string;
  restoredAt?: string;
}

export type OrganizationJoinRequestEventType =
  | 'request_submitted'
  | 'request_approved'
  | 'request_rejected'
  | 'request_archived'
  | 'request_restored'
  | 'request_reopened'
  | 'invitation_created'
  | 'invitation_email_status'
  | 'invitation_revoked'
  | 'invitation_accepted';

export interface OrganizationJoinRequestEvent {
  id: string;
  requestId: string;
  eventType: OrganizationJoinRequestEventType;
  actorName?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface JoinRequestCandidate {
  id: string;
  name: string;
  role: string;
}

export type CommunicationChannel = 'whatsapp' | 'email';
export type CommunicationKind = 'campaign' | 'invitation';
export type CommunicationStatus = 'initiated' | 'failed';

export interface CommunicationSend {
  id: string;
  channel: CommunicationChannel;
  kind: CommunicationKind;
  campaignId?: string;
  campaignLabel?: string;
  recipientId?: string;
  recipientName: string;
  recipientAddress: string;
  message: string;
  status: CommunicationStatus;
  failureReason?: string;
  consentedAt: string;
  createdAt: string;
}

export type ProvisionedDevAdmin = DevAdminProvisionResult;
export type ProvisionedOrganizationManager = OrganizationManagerProvisionResult;

export interface FinanceHistoryItem {
  id: string;
  entryType: 'income' | 'expense';
  entryId: string;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  previousValues: {
    date: string;
    description: string;
    amount: number;
    category?: ExpenseCategory;
    paymentMethod?: PayMethod;
  };
  newValues: {
    date: string;
    description: string;
    amount: number;
    category?: ExpenseCategory;
    paymentMethod?: PayMethod;
  };
}

export interface PersonalEarning {
  id: string;
  date: string;
  kind: 'commission' | 'tip';
  source: string;
  attribution: string;
  amount: number;
}

export interface ReceptionDailyOperations {
  date: string;
  attendances: number;
  planUses: number;
  incomeByMethod: Record<PayMethod, number>;
  incomeTotal: number;
  incomeWithoutMethod: number;
  expenseByMethod: Record<PayMethod, number>;
  expenseTotal: number;
  planReceiptsByMethod: Record<PayMethod, number> & { sem_forma: number };
  planReceiptTotal: number;
}

function client() {
  if (!supabase) {
    throw new Error('Supabase não está configurado neste ambiente.');
  }
  return supabase;
}

async function organizationId(): Promise<string> {
  const db = client();
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData.user) throw new Error('Faça login para acessar os dados.');

  const { data, error } = await db.rpc('current_organization_id');

  if (error) throw new Error(`Não foi possível identificar o estabelecimento: ${error.message}`);
  if (!data) {
    throw new Error('Sua conta ainda não está vinculada a um estabelecimento.');
  }
  return String(data);
}

function defined(input: Row): Row {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function translateJoinRequestError(message: string): Error {
  const normalized = message.toLowerCase();
  if (normalized.includes('confirm your email or phone')) {
    return new Error('Confirme seu e-mail ou telefone antes de solicitar acesso.');
  }
  if (normalized.includes('complete your name')) {
    return new Error('Complete seu nome no perfil antes de solicitar acesso.');
  }
  if (normalized.includes('exactly one organization')) {
    return new Error('Não há uma empresa única disponível para receber pedidos de acesso.');
  }
  if (normalized.includes('use the pending invitation')) {
    return new Error('Já existe um convite para este contato. Use o link enviado pelo gestor.');
  }
  if (normalized.includes('already has an approved access request')) {
    return new Error('Este contato já tem um pedido aprovado. Aguarde ou solicite ao gestor que gere outro convite.');
  }
  if (normalized.includes('too many access requests')) {
    return new Error('Muitas tentativas para este contato. Aguarde uma hora antes de enviar outro pedido.');
  }
  if (normalized.includes('provide exactly one contact')) {
    return new Error('Informe apenas um contato: e-mail ou telefone.');
  }
  if (normalized.includes('valid e.164 phone')) {
    return new Error('Informe o telefone com código do país e DDD, por exemplo +55 11 99999-9999.');
  }
  if (normalized.includes('valid email is required')) {
    return new Error('Informe um e-mail válido.');
  }
  if (normalized.includes('account already belongs') || normalized.includes('applicant already belongs')) {
    return new Error('Esta conta já está vinculada a uma empresa.');
  }
  if (normalized.includes('active professional profile not found')) {
    return new Error('O perfil selecionado não está ativo ou não pertence a esta empresa.');
  }
  if (normalized.includes('professional profile is already linked')) {
    return new Error('Este perfil profissional já está vinculado a outra conta.');
  }
  if (normalized.includes('pending access request not found')) {
    return new Error('Este pedido já foi analisado ou não pertence à sua empresa.');
  }
  if (normalized.includes('only managers can')) {
    return new Error('Somente o Gestor/Proprietário pode analisar pedidos de acesso.');
  }
  if (
    normalized.includes('get_onboarding_options') ||
    normalized.includes('request_organization_join') ||
    normalized.includes('organization_join_requests')
  ) {
    return new Error('A atualização de pedidos de acesso ainda não foi aplicada ao banco Supabase.');
  }
  if (
    normalized.includes('manual_commission')
    || normalized.includes('manual_commissions')
    || normalized.includes('primary_professional_missing_from_manual_commissions')
  ) {
    if (normalized.includes('plan_manual_commissions_must_equal_professional_pool')) {
      return new Error('A soma das comissões deve corresponder ao valor reservado aos profissionais neste uso do plano.');
    }
    if (normalized.includes('manual_commissions_must_equal_service_share')) {
      return new Error('A soma das comissões dos profissionais deve corresponder a 50% do valor do serviço ou do uso do plano.');
    }
    return new Error('Revise a atribuição manual: selecione profissionais ativos, sem repetição, e informe a comissão de cada um em reais.');
  }
  if (normalized.includes('prosthesis_commission_amount_mismatch')) {
    return new Error('A comissão da aplicação de prótese foi alterada. Confira o valor fixo ou o cálculo de lucro do Marcos Macedo.');
  }
  return new Error(message);
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function mapProfessional(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    role: String(row.role ?? 'barbeiro'),
    initials: String(row.initials ?? ''),
    color: String(row.color ?? '#3b82f6'),
    isActive: Boolean(row.is_active),
    commissions: (row.commissions ?? {}) as Row,
  };
}

function mapAppointment(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    time: String(row.time ?? '').slice(0, 5),
    client: String(row.client ?? ''),
    clientPhone: row.client_phone ? String(row.client_phone) : undefined,
    clientId: row.client_id ? String(row.client_id) : undefined,
    professionalId: String(row.professional_id ?? ''),
    serviceId: row.service_id ? String(row.service_id) : undefined,
    planSubscriberId: row.plan_subscriber_id ? String(row.plan_subscriber_id) : undefined,
    planUsageValue: row.plan_subscriber_id ? Number(row.plan_usage_value ?? 0) : undefined,
    serviceCommissionRateSnapshot: row.service_commission_rate_snapshot == null
      ? undefined
      : Number(row.service_commission_rate_snapshot),
    prosthesisCostSnapshot: row.prosthesis_cost_snapshot == null
      ? undefined
      : Number(row.prosthesis_cost_snapshot),
    prosthesisCommissionRuleSnapshot: Boolean(row.prosthesis_commission_rule_snapshot),
    professionalCommissions: arrayValue<Row>(row.professional_commissions)
      .map(assignment => ({
        professionalId: String(assignment.professionalId ?? assignment.professional_id ?? ''),
        amount: Number(assignment.amount ?? 0),
      }))
      .filter(assignment => assignment.professionalId),
    sellerProfessionalId: row.seller_professional_id ? String(row.seller_professional_id) : undefined,
    sellerIsCompany: Boolean(row.seller_is_company),
    service: String(row.service ?? ''),
    serviceDescription: row.service_description ? String(row.service_description) : undefined,
    duration: Number(row.duration ?? 30),
    status: row.status,
    checkedInAt: row.checked_in_at ? String(row.checked_in_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    attendanceRecordedAt: row.attendance_recorded_at
      ? String(row.attendance_recorded_at)
      : row.status === 'completed' && row.created_at
        ? String(row.created_at)
        : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    value: Number(row.value ?? 0),
    tip: Number(row.tip ?? 0),
    products: arrayValue(row.products),
    payMethod: row.pay_method,
    paymentSplits: arrayValue(row.payment_splits),
  };
}

function mapBlock(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    professionalId: String(row.professional_id ?? ''),
    slots: arrayValue<string>(row.slots),
    reason: String(row.reason ?? ''),
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function mapClient(row: Row) {
  const createdAt = row.created_at ? formatTimestampDateKey(String(row.created_at)) : '';
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    whatsapp: String(row.whatsapp ?? ''),
    birthday: row.birthday ? String(row.birthday) : undefined,
    source: row.source ? String(row.source) : undefined,
    sourceOther: row.source_other ? String(row.source_other) : undefined,
    interest: row.interest,
    createdAt,
    visits: arrayValue(row.visits),
  };
}

function mapProduct(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: String(row.category ?? ''),
    isProsthesisCapillary: Boolean(row.is_prosthesis_capillary),
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    stock: Number(row.stock ?? 0),
    minStock: Number(row.min_stock ?? 0),
    isActive: Boolean(row.is_active),
  };
}

function mapProductSale(row: Row): ProductSale {
  const items = arrayValue<Row>(row.items).map(item => ({
    productId: String(item.productId ?? item.product_id ?? ''),
    productName: String(item.productName ?? item.product_name ?? ''),
    unitPrice: Number(item.unitPrice ?? item.unit_price ?? 0),
    quantity: Number(item.quantity ?? 0),
    ...(item.discountType || item.discount_type
      ? { discountType: String(item.discountType ?? item.discount_type) as 'amount' | 'percent' }
      : {}),
    discountValue: Number(item.discountValue ?? item.discount_value ?? 0),
    discountAmount: Number(item.discountAmount ?? item.discount_amount ?? 0),
    total: Number(item.total ?? 0),
  }));
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    reversalDate: row.reversal_date ? String(row.reversal_date) : undefined,
    reversalReason: row.reversal_reason ? String(row.reversal_reason) : undefined,
    reversedAt: row.reversed_at ? String(row.reversed_at) : undefined,
    clientId: row.client_id ? String(row.client_id) : undefined,
    appointmentId: row.appointment_id ? String(row.appointment_id) : undefined,
    paymentMethod: row.payment_method as PayMethod,
    items,
    total: Number(row.total ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}

function mapExpense(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    description: String(row.description ?? ''),
    amount: Number(row.amount ?? 0),
    category: String(row.category ?? 'Outros') as ExpenseCategory,
    ...(row.payment_method ? { paymentMethod: row.payment_method as PayMethod } : {}),
  };
}

function mapIncome(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    description: String(row.description ?? ''),
    amount: Number(row.amount ?? 0),
  };
}

function mapCashClosing(row: Row): CashClosing {
  return {
    id: String(row.id),
    periodStart: String(row.period_start ?? ''),
    periodEnd: String(row.period_end ?? ''),
    frequency: String(row.frequency ?? 'weekly') as CashClosingFrequency,
    totalIncome: Number(row.total_income ?? 0),
    totalExpenses: Number(row.total_expenses ?? 0),
    netTotal: Number(row.net_total ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}

function mapFinanceHistory(row: Row): FinanceHistoryItem {
  const mapValues = (value: unknown): FinanceHistoryItem['previousValues'] => {
    const values = (value ?? {}) as Row;
    return {
      date: String(values.date ?? ''),
      description: String(values.description ?? ''),
      amount: Number(values.amount ?? 0),
      ...(values.category ? { category: String(values.category) as ExpenseCategory } : {}),
      ...(values.payment_method ? { paymentMethod: values.payment_method as PayMethod } : {}),
    };
  };
  return {
    id: String(row.id),
    entryType: row.entry_type as FinanceHistoryItem['entryType'],
    entryId: String(row.entry_id ?? ''),
    changedBy: String(row.changed_by ?? ''),
    changedByName: String(row.changed_by_name ?? 'Usuário'),
    changedAt: String(row.changed_at ?? ''),
    previousValues: mapValues(row.previous_values),
    newValues: mapValues(row.new_values),
  };
}

function mapProthesisSale(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    client: String(row.client ?? ''),
    whatsapp: row.whatsapp ? String(row.whatsapp) : undefined,
    value: Number(row.value ?? 0),
    sellerId: String(row.seller_id ?? ''),
    installments: Number(row.installments ?? 1),
    installmentsPaid: Number(row.installments_paid ?? 0),
    payMethod1: row.pay_method1,
    payAmount1: Number(row.pay_amount1 ?? 0),
    payMethod2: row.pay_method2,
    payAmount2: row.pay_amount2 == null ? undefined : Number(row.pay_amount2),
    lastMaintenance: row.last_maintenance ? String(row.last_maintenance) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function mapMentoria(row: Row) {
  return {
    id: String(row.id),
    date: String(row.date ?? ''),
    client: String(row.client ?? ''),
    sellerId: String(row.seller_id ?? ''),
    value: Number(row.value ?? 0),
    durationHours: Number(row.duration_hours ?? 2),
    status: row.status,
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function mapPlan(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    price: Number(row.price ?? 0),
    services: arrayValue<string | { serviceId: string; serviceName: string; usesPerCycle: number }>(row.services),
    duration: row.duration,
    salonSharePercent: row.salon_share_percent == null ? null : Number(row.salon_share_percent),
  };
}

function mapSubscriber(row: Row): Subscriber {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? ''),
    planId: String(row.plan_id ?? ''),
    professionalId: row.professional_id ? String(row.professional_id) : undefined,
    startDate: String(row.start_date ?? ''),
    nextPayment: String(row.next_payment ?? ''),
    status: row.status as Subscriber['status'],
    usageStartedAt: row.usage_started_at ? String(row.usage_started_at) : undefined,
    salonSharePercentSnapshot: row.salon_share_percent_snapshot == null
      ? null
      : Number(row.salon_share_percent_snapshot),
  };
}

function mapSubscriptionPayment(row: Row): SubscriptionPayment {
  return {
    id: String(row.id),
    subscriberId: String(row.subscriber_id ?? ''),
    dueDate: String(row.due_date ?? ''),
    paidAt: row.paid_at ? String(row.paid_at) : undefined,
    amount: Number(row.amount ?? 0),
    paymentMethod: row.payment_method as SubscriptionPayment['paymentMethod'],
    status: row.status as SubscriptionPaymentStatus,
    note: row.note ? String(row.note) : undefined,
    salonSharePercentSnapshot: row.salon_share_percent_snapshot == null
      ? undefined
      : Number(row.salon_share_percent_snapshot),
  };
}

function mapInvitation(row: Row): OrganizationInvitation {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    ...(row.phone ? { phone: String(row.phone) } : {}),
    professionalId: String(row.professional_id ?? ''),
    role: row.role as OrganizationInvitation['role'],
    expiresAt: String(row.expires_at ?? ''),
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
    revokedByName: row.revoked_by_name ? String(row.revoked_by_name) : undefined,
    invitedByName: row.invited_by_name ? String(row.invited_by_name) : undefined,
    createdAt: String(row.created_at ?? ''),
    emailDeliveryStatus: row.email_delivery_status
      ? String(row.email_delivery_status) as InvitationEmailDeliveryStatus
      : undefined,
    emailDeliveryUpdatedAt: row.email_delivery_updated_at
      ? String(row.email_delivery_updated_at)
      : undefined,
  };
}

async function fetchOrganizationInvitation(id: string): Promise<OrganizationInvitation> {
  const { data, error } = await client()
    .from('organization_invitations')
    .select('id, email, phone, professional_id, role, expires_at, accepted_at, revoked_at, revoked_by_name, invited_by_name, created_at, email_delivery_status, email_delivery_updated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Não foi possível atualizar o histórico do convite: ${error.message}`);
  return mapInvitation(data as Row);
}

function mapOrganizationJoinRequest(row: Row): OrganizationJoinRequest {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    applicantName: String(row.applicant_name ?? ''),
    applicantEmail: row.applicant_email ? String(row.applicant_email) : undefined,
    applicantPhone: row.applicant_phone ? String(row.applicant_phone) : undefined,
    status: String(row.status ?? 'pending') as OrganizationJoinRequestStatus,
    professionalId: row.professional_id ? String(row.professional_id) : undefined,
    requestedAt: String(row.requested_at ?? ''),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    hiddenAt: row.hidden_at ? String(row.hidden_at) : undefined,
    restoredAt: row.restored_at ? String(row.restored_at) : undefined,
  };
}

function mapCommunicationSend(row: Row): CommunicationSend {
  return {
    id: String(row.id),
    channel: row.channel as CommunicationChannel,
    kind: row.kind as CommunicationKind,
    campaignId: row.campaign_id ? String(row.campaign_id) : undefined,
    campaignLabel: row.campaign_label ? String(row.campaign_label) : undefined,
    recipientId: row.recipient_id ? String(row.recipient_id) : undefined,
    recipientName: String(row.recipient_name ?? ''),
    recipientAddress: String(row.recipient_address ?? ''),
    message: String(row.message ?? ''),
    status: row.status as CommunicationStatus,
    failureReason: row.failure_reason ? String(row.failure_reason) : undefined,
    consentedAt: String(row.consented_at ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

async function listRows(table: string, order = 'created_at'): Promise<Row[]> {
  await organizationId();
  const { data, error } = await client().from(table).select('*').order(order, { ascending: false });
  if (error) throw new Error(`Não foi possível carregar ${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

async function insertRow(table: string, row: Row): Promise<Row> {
  const currentOrganizationId = await organizationId();
  const { data, error } = await client().from(table)
    .insert(defined({ ...row, organization_id: currentOrganizationId }))
    .select('*')
    .single();
  if (error) throw new Error(`Não foi possível salvar em ${table}: ${error.message}`);
  return data as Row;
}

async function insertRowWithoutRepresentation(table: string, row: Row): Promise<Row> {
  const currentOrganizationId = await organizationId();
  const values = defined({ ...row, organization_id: currentOrganizationId });
  const { error } = await client().from(table).insert(values);
  if (error) throw new Error(`Não foi possível salvar em ${table}: ${error.message}`);
  return values;
}

function translatePlanAttendanceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('plan_usage_exhausted')) {
    return new Error('Os usos deste serviço acabaram. Renove manualmente o plano ou lance o atendimento como serviço normal.');
  }
  if (normalized.includes('plan_subscriber_inactive')) {
    return new Error('Este plano está pendente ou vencido e não pode ser usado neste atendimento.');
  }
  if (normalized.includes('plan_subscriber_client_mismatch')) {
    return new Error('O plano selecionado não pertence ao cliente escolhido. Confira o telefone cadastrado no assinante.');
  }
  if (normalized.includes('plan_service_not_included')) {
    return new Error('O serviço selecionado não está incluído neste plano.');
  }
  if (normalized.includes('plan_service_not_configured')) {
    return new Error('O serviço do plano não está mais ativo ou configurado. Atualize o plano antes de usar esta cobertura.');
  }
  if (normalized.includes('plan_usage_migration_required') || normalized.includes('plan_usage_columns_missing')) {
    return new Error('Aplique a migração de controle de usos dos planos no Supabase antes de registrar atendimentos com plano.');
  }
  return error instanceof Error ? error : new Error(message);
}

async function updateRow(table: string, id: string, row: Row): Promise<Row> {
  await organizationId();
  const { data, error } = await client().from(table).update(defined(row)).eq('id', id).select('*').single();
  if (error) throw new Error(`Não foi possível atualizar ${table}: ${error.message}`);
  return data as Row;
}

async function removeRow(table: string, id: string): Promise<void> {
  await organizationId();
  const { error } = await client().from(table).delete().eq('id', id);
  if (error) throw new Error(`Não foi possível remover de ${table}: ${error.message}`);
}

async function authenticatedApiRequest<T>(
  path: string,
  method: 'POST' | 'DELETE',
  body?: Record<string, unknown>,
  errorMessage = 'Não foi possível concluir a solicitação.',
  authErrorMessage = 'Faça login novamente para continuar.',
): Promise<T> {
  const { data, error } = await client().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error(authErrorMessage);
  }

  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(result.error || `${errorMessage} (HTTP ${response.status}).`);
  }
  return result;
}

export const api = {
  dashboard: {
    getReceptionDailyOperations: async (date: string): Promise<ReceptionDailyOperations> => {
      await organizationId();
      const { data, error } = await client().rpc('get_reception_daily_operations', { p_date: date });
      if (error) throw new Error(`Não foi possível carregar o resumo operacional: ${error.message}`);
      const row = data as Row;
      const mapMethods = (value: unknown): Record<PayMethod, number> => {
        const methods = (value ?? {}) as Row;
        return {
          debito: Number(methods.debito ?? 0),
          credito: Number(methods.credito ?? 0),
          pix: Number(methods.pix ?? 0),
          dinheiro: Number(methods.dinheiro ?? 0),
        };
      };
      const planReceipts = (row.planReceiptsByMethod ?? {}) as Row;
      return {
        date: String(row.date ?? date),
        attendances: Number(row.attendances ?? 0),
        planUses: Number(row.planUses ?? 0),
        incomeByMethod: mapMethods(row.incomeByMethod),
        incomeTotal: Number(row.incomeTotal ?? 0),
        incomeWithoutMethod: Number(row.incomeWithoutMethod ?? 0),
        expenseByMethod: mapMethods(row.expenseByMethod),
        expenseTotal: Number(row.expenseTotal ?? 0),
        planReceiptsByMethod: {
          ...mapMethods(planReceipts),
          sem_forma: Number(planReceipts.sem_forma ?? 0),
        },
        planReceiptTotal: Number(row.planReceiptTotal ?? 0),
      };
    },
  },
  admin: {
    provisionDevAdmin: (email: string, organizationId: string) =>
      authenticatedApiRequest<ProvisionedDevAdmin>(
        "/api/admin/dev-admins",
        "POST",
        { email, organizationId },
        "Não foi possível provisionar a conta DEV/ADMIN.",
        "Faça login novamente para provisionar a conta.",
      ),
    provisionOrganizationManager: (email: string, organizationId: string) =>
      authenticatedApiRequest<ProvisionedOrganizationManager>(
        "/api/admin/organization-managers",
        "POST",
        { email, organizationId },
        "Não foi possível conceder o acesso de Gestor / Proprietário.",
        "Faça login novamente para conceder este acesso.",
      ),
  },
  googleCalendar: {
    syncAppointment: (appointmentId: string) =>
      authenticatedApiRequest<{ synced: boolean; eventLink: string | null }>(
        `/api/google-calendar/appointments/${encodeURIComponent(appointmentId)}/sync`,
        'POST',
        undefined,
        'Falha ao sincronizar o Google Agenda.',
        'Faça login novamente para sincronizar o Google Agenda.',
      ),
    syncAppointments: (appointmentIds: string[]) =>
      authenticatedApiRequest<{
        syncedCount: number;
        failed: Array<{ appointmentId: string; error: string }>;
      }>(
        '/api/google-calendar/sync',
        'POST',
        { appointmentIds },
        'Falha ao sincronizar o Google Agenda.',
        'Faça login novamente para sincronizar o Google Agenda.',
      ),
    deleteAppointment: (appointmentId: string) =>
      authenticatedApiRequest<void>(
        `/api/google-calendar/appointments/${encodeURIComponent(appointmentId)}`,
        'DELETE',
        undefined,
        'Falha ao remover do Google Agenda.',
        'Faça login novamente para sincronizar o Google Agenda.',
      ),
  },
  invitations: {
    sendEmail: (invitationId: string, token: string, invitationUrl: string, consentConfirmed: boolean) =>
      authenticatedApiRequest<{ emailId: string; status: 'sent' }>(
        `/api/invitations/${encodeURIComponent(invitationId)}/email`,
        'POST',
        { token, invitationUrl, consentConfirmed },
        'Não foi possível enviar o convite pelo Resend.',
        'Faça login novamente para enviar o convite.',
      ),
    preview: async (token: string): Promise<PublicInvitationInfo> => {
      const { data, error } = await client().rpc('get_public_organization_invitation_info', {
        p_token: token,
      });
      if (error) throw new Error(`Não foi possível validar o convite: ${error.message}`);
      const row = data as Row;
      const channel = row.channel === 'phone' ? 'phone' : row.channel === 'email' ? 'email' : undefined;
      const status = String(row.status ?? 'invalid') as PublicInvitationInfo['status'];
      return {
        valid: Boolean(row.valid),
        status,
        ...(channel ? { channel } : {}),
        ...(typeof row.email === 'string' ? { email: row.email } : {}),
        ...(typeof row.organization_name === 'string' ? { organizationName: row.organization_name } : {}),
        ...(typeof row.professional_name === 'string' ? { professionalName: row.professional_name } : {}),
      };
    },
    list: async (): Promise<OrganizationInvitation[]> => {
      await organizationId();
      const { data, error } = await client()
        .from('organization_invitations')
        .select('id, email, phone, professional_id, role, expires_at, accepted_at, revoked_at, revoked_by_name, invited_by_name, created_at, email_delivery_status, email_delivery_updated_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Não foi possível carregar os convites: ${error.message}`);
      return (data ?? []).map(mapInvitation);
    },
    create: async (professionalId: string, email: string, expiresInDays = 7): Promise<CreatedInvitation> => {
      await organizationId();
      const { data, error } = await client().rpc('create_organization_invitation', {
        p_professional_id: professionalId,
        p_email: email,
        p_expires_in_days: expiresInDays,
      });
      if (error) throw new Error(`Não foi possível criar o convite: ${error.message}`);
      return { ...await fetchOrganizationInvitation(String((data as Row).id)), token: String((data as Row).token ?? '') };
    },
    createReception: async (email: string, expiresInDays = 7): Promise<CreatedInvitation> => {
      await organizationId();
      const { data, error } = await client().rpc('create_reception_invitation', {
        p_email: email,
        p_expires_in_days: expiresInDays,
      });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migration de acesso da recepção no Supabase antes de enviar este convite.');
        }
        throw new Error(`Não foi possível criar o convite da recepção: ${error.message}`);
      }
      return { ...await fetchOrganizationInvitation(String((data as Row).id)), token: String((data as Row).token ?? '') };
    },
    revoke: async (id: string): Promise<OrganizationInvitation> => {
      await organizationId();
      const { error } = await client().rpc('revoke_organization_invitation', { p_invitation_id: id });
      if (error) throw new Error(`Não foi possível revogar o convite: ${error.message}`);
      return fetchOrganizationInvitation(id);
    },
    delete: async (id: string): Promise<void> => {
      await organizationId();
      const { error } = await client().rpc('delete_organization_invitation', { p_invitation_id: id });
      if (error) throw new Error(`Não foi possível excluir o convite do histórico: ${error.message}`);
    },
    cleanupHistorical: async (): Promise<string[]> => {
      await organizationId();
      const { data, error } = await client().rpc('cleanup_historical_organization_invitations');
      if (error) throw new Error(`Não foi possível limpar o histórico de convites: ${error.message}`);
      return (data ?? []).map((id: string) => String(id));
    },
  },
  joinRequests: {
    listForManager: async (): Promise<OrganizationJoinRequest[]> => {
      await organizationId();
      const rows: Row[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const fetchPage = (columns: string) => client()
          .from('organization_join_requests')
          .select(columns)
          .order('requested_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + pageSize - 1);
        const currentSchemaResult = await fetchPage('id, user_id, applicant_name, applicant_email, applicant_phone, status, professional_id, requested_at, reviewed_at, hidden_at, restored_at');
        let data: Row[] | null = null;
        let error = currentSchemaResult.error;
        if (currentSchemaResult.error && ['42703', 'PGRST204'].includes(currentSchemaResult.error.code)) {
          const archiveSchemaResult = await fetchPage('id, user_id, applicant_name, applicant_email, applicant_phone, status, professional_id, requested_at, reviewed_at, hidden_at');
          if (archiveSchemaResult.error && ['42703', 'PGRST204'].includes(archiveSchemaResult.error.code)) {
            const legacySchemaResult = await fetchPage('id, user_id, applicant_name, applicant_email, applicant_phone, status, professional_id, requested_at, reviewed_at');
            data = legacySchemaResult.data as unknown as Row[] | null;
            error = legacySchemaResult.error;
          } else {
            data = archiveSchemaResult.data as unknown as Row[] | null;
            error = archiveSchemaResult.error;
          }
        } else {
          data = currentSchemaResult.data as unknown as Row[] | null;
        }
        if (error) {
          throw new Error(`Não foi possível carregar os pedidos de acesso: ${translateJoinRequestError(error.message).message}`);
        }
        rows.push(...(data ?? []));
        if ((data ?? []).length < pageSize) break;
      }
      return rows.map(mapOrganizationJoinRequest);
    },
    listHistory: async (requestIds: string[]): Promise<OrganizationJoinRequestEvent[]> => {
      await organizationId();
      if (requestIds.length === 0) return [];
      const rows: Row[] = [];
      const pageSize = 500;
      for (let start = 0; start < requestIds.length; start += 100) {
        const requestBatch = requestIds.slice(start, start + 100);
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await client()
            .from('organization_join_request_events')
            .select('id, request_id, event_type, actor_name, metadata, created_at')
            .in('request_id', requestBatch)
            .order('created_at', { ascending: true })
            .range(offset, offset + pageSize - 1);
          if (error) throw new Error(`Não foi possível carregar o histórico dos pedidos: ${error.message}`);
          rows.push(...(data ?? []));
          if ((data ?? []).length < pageSize) break;
        }
      }
      return rows
        .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
        .map((row: Row) => ({
        id: String(row.id),
        requestId: String(row.request_id),
        eventType: String(row.event_type) as OrganizationJoinRequestEventType,
        actorName: row.actor_name ? String(row.actor_name) : undefined,
        metadata: row.metadata && typeof row.metadata === 'object'
          ? row.metadata as Record<string, unknown>
          : {},
        createdAt: String(row.created_at ?? ''),
      }));
    },
    create: async (input: {
      organizationId: string;
      applicantName: string;
      email: string;
    }): Promise<OrganizationJoinRequest> => {
      const { data, error } = await client().rpc('request_organization_join', {
        p_organization_id: input.organizationId,
        p_applicant_name: input.applicantName.trim(),
        p_applicant_email: input.email?.trim().toLowerCase() || null,
        p_applicant_phone: null,
      });
      if (error) throw new Error(`Não foi possível enviar o pedido de acesso: ${translateJoinRequestError(error.message).message}`);
      const result = data as (Row & { rate_limited?: boolean; retry_after_seconds?: number }) | null;
      if (result?.rate_limited) {
        const retryMinutes = Math.max(1, Math.ceil(Number(result.retry_after_seconds ?? 3600) / 60));
        const minuteLabel = retryMinutes === 1 ? 'minuto' : 'minutos';
        throw new Error(
          `Muitos pedidos foram enviados recentemente. Aguarde cerca de ${retryMinutes} ${minuteLabel} e tente novamente.`,
        );
      }
      return mapOrganizationJoinRequest(data as Row);
    },
    publicOrganizationName: async (organizationId: string): Promise<string> => {
      const { data, error } = await client().rpc('get_public_organization_name', {
        p_organization_id: organizationId,
      });
      if (error) throw new Error(`Não foi possível identificar o salão: ${error.message}`);
      if (!data) throw new Error('O link não identifica um salão válido.');
      return String(data);
    },
    candidates: async (): Promise<JoinRequestCandidate[]> => {
      await organizationId();
      const { data, error } = await client().rpc('list_organization_join_request_candidates');
      if (error) throw new Error(`Não foi possível carregar os perfis disponíveis: ${translateJoinRequestError(error.message).message}`);
      return (data ?? []).map((row: Row) => ({
        id: String(row.id),
        name: String(row.name ?? ''),
        role: String(row.role ?? ''),
      }));
    },
    approve: async (requestId: string, professionalId: string): Promise<void> => {
      await organizationId();
      const { error } = await client().rpc('approve_organization_join_request', {
        p_request_id: requestId,
        p_professional_id: professionalId,
      });
      if (error) throw new Error(`Não foi possível aprovar o pedido: ${translateJoinRequestError(error.message).message}`);
    },
    reject: async (requestId: string): Promise<void> => {
      await organizationId();
      const { error } = await client().rpc('reject_organization_join_request', {
        p_request_id: requestId,
      });
      if (error) throw new Error(`Não foi possível recusar o pedido: ${translateJoinRequestError(error.message).message}`);
    },
    archiveRejected: async (requestId: string): Promise<string> => {
      await organizationId();
      const { data, error } = await client().rpc('archive_rejected_organization_join_request', {
        p_request_id: requestId,
      });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migração de arquivamento de pedidos recusados no Supabase.');
        }
        throw new Error(`Não foi possível arquivar o pedido: ${error.message}`);
      }
      if (!data) throw new Error('O Supabase não retornou a data do arquivamento.');
      return String(data);
    },
    restoreRejected: async (requestId: string): Promise<string> => {
      await organizationId();
      const { data, error } = await client().rpc('restore_rejected_organization_join_request', {
        p_request_id: requestId,
      });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migração de restauração de pedidos recusados no Supabase.');
        }
        throw new Error(`Não foi possível restaurar o pedido: ${error.message}`);
      }
      if (!data) throw new Error('O Supabase não retornou a data da restauração.');
      return String(data);
    },
    revokeApprovedInvitation: async (requestId: string, invitationId: string): Promise<OrganizationInvitation> => {
      await organizationId();
      const { error } = await client().rpc('revoke_approved_join_request_invitation', {
        p_request_id: requestId,
        p_invitation_id: invitationId,
      });
      if (error) throw new Error(`Não foi possível revogar o convite e liberar o perfil: ${error.message}`);
      return fetchOrganizationInvitation(invitationId);
    },
  },
  communication: {
    list: async (): Promise<CommunicationSend[]> => {
      await organizationId();
      const { data, error } = await client()
        .from('communication_sends')
        .select('id, channel, kind, campaign_id, campaign_label, recipient_id, recipient_name, recipient_address, message, status, failure_reason, consented_at, created_at')
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw new Error(`Não foi possível carregar o histórico de envios: ${error.message}`);
      return (data ?? []).map(mapCommunicationSend);
    },
    log: async (body: {
      channel: CommunicationChannel;
      kind: CommunicationKind;
      campaignId?: string;
      campaignLabel?: string;
      recipientId?: string;
      recipientName: string;
      recipientAddress: string;
      message: string;
      status: CommunicationStatus;
      failureReason?: string;
    }): Promise<CommunicationSend> => mapCommunicationSend(await insertRow('communication_sends', {
      channel: body.channel,
      kind: body.kind,
      campaign_id: body.campaignId,
      campaign_label: body.campaignLabel,
      recipient_id: body.recipientId,
      recipient_name: body.recipientName,
      recipient_address: body.recipientAddress,
      message: body.message,
      status: body.status,
      failure_reason: body.failureReason,
      consented_at: new Date().toISOString(),
    })),
    markFailed: async (id: string, failureReason: string): Promise<CommunicationSend> => mapCommunicationSend(await updateRow('communication_sends', id, {
      status: 'failed',
      failure_reason: failureReason,
    })),
  },
  history: {
    counts: async (): Promise<Record<string, number>> => {
      await organizationId();
      const { data, error } = await client().rpc('get_organization_history_counts');
      if (error) throw new Error(`Não foi possível carregar os históricos: ${error.message}`);
      const result = (data ?? {}) as Row;
      return Object.fromEntries(
        Object.entries(result).map(([key, value]) => [key, Number(value) || 0]),
      );
    },
    clear: async (historyType: HistoryModule): Promise<number> => {
      await organizationId();
      const { data, error } = historyType === 'finance'
        ? await client().rpc('clear_organization_finance_history')
        : await client().rpc('clear_organization_history', { p_history_type: historyType });
      if (error) throw new Error(`Não foi possível limpar este histórico: ${error.message}`);
      return Number((data as Row | null)?.deleted_count) || 0;
    },
    deleteItem: async (historyType: HistoryItemType, itemId: string): Promise<boolean> => {
      await organizationId();
      const { data, error } = historyType === 'cash_closing'
        ? await client().rpc('delete_organization_cash_closing', { p_item_id: itemId })
        : await client().rpc('delete_organization_history_item', { p_history_type: historyType, p_item_id: itemId });
      if (error) throw new Error(`Não foi possível excluir este registro: ${error.message}`);
      return data === true;
    },
  },
  auth: {
    getOnboardingOptions: async (): Promise<{ canCreateOrganization: boolean; canRequestAccess: boolean }> => {
      const { data, error } = await client().rpc('get_onboarding_options');
      if (error) throw new Error(`Não foi possível verificar as opções de acesso: ${translateJoinRequestError(error.message).message}`);
      const options = data as Row;
      return {
        canCreateOrganization: Boolean(options.can_create_organization),
        canRequestAccess: Boolean(options.can_request_access),
      };
    },
    acceptInvitation: async (token: string): Promise<{ organizationId: string; role: string; professionalId: string }> => {
      const { data, error } = await client().rpc('accept_organization_invitation', { p_token: token });
      if (error) throw new Error(error.message);
      const payload = data as Row;
      return {
        organizationId: String(payload.organization_id),
        role: String(payload.role),
        professionalId: String(payload.professional_id),
      };
    },
  },
  professionals: {
    list: async () => (await listRows('professionals')).map(mapProfessional),
    accountEmails: async (): Promise<Record<string, string>> => {
      const { data, error } = await client().rpc('list_professional_account_emails');
      if (error) {
        if (['42883', 'PGRST202'].includes(error.code)) {
          throw new Error('Aplique a migration de e-mails vinculados aos profissionais no Supabase.');
        }
        throw new Error(`Não foi possível carregar os e-mails vinculados aos profissionais: ${error.message}`);
      }

      const contacts: Record<string, string> = {};
      for (const row of arrayValue<Row>(data)) {
        const professionalId = String(row.professional_id ?? '').trim();
        const email = String(row.email ?? '').trim();
        if (professionalId && email) contacts[professionalId] = email;
      }
      return contacts;
    },
    create: async (body: Row) => mapProfessional(await insertRow('professionals', {
      id: body.id,
      name: body.name,
      role: body.role,
      initials: body.initials,
      color: body.color,
      is_active: body.isActive,
      commissions: body.commissions,
    })),
    update: async (id: string, body: Row) => mapProfessional(await updateRow('professionals', id, {
      name: body.name,
      role: body.role,
      initials: body.initials,
      color: body.color,
      is_active: body.isActive,
      commissions: body.commissions,
    })),
    remove: async (id: string): Promise<void> => {
      await organizationId();
      const { data, error } = await client().rpc('delete_professional_preserving_history', { p_professional_id: id });
      if (error) {
        if (['23503', '23502', 'PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migração de exclusão segura de profissionais no Supabase antes de excluir um profissional com histórico.');
        }
        throw new Error(`Não foi possível excluir o profissional: ${error.message}`);
      }
      if (data !== id) throw new Error('O Supabase não confirmou a exclusão do profissional.');
    },
  },
  appointments: {
    list: async () => (await listRows('appointments', 'date')).map(mapAppointment),
    create: async (body: Row) => mapAppointment(await insertRow('appointments', {
      id: body.id,
      date: body.date,
      time: body.time,
      client: body.client,
      client_phone: body.clientPhone,
      client_id: body.clientId,
      professional_id: body.professionalId,
      service_id: body.serviceId,
      plan_subscriber_id: body.planSubscriberId,
      plan_usage_value: body.planUsageValue,
      professional_commissions: body.professionalCommissions,
      seller_professional_id: body.sellerProfessionalId ?? null,
      seller_is_company: body.sellerIsCompany,
      service: body.service,
      service_description: body.serviceDescription ?? null,
      duration: body.duration,
      status: body.status,
      checked_in_at: body.checkedInAt,
      completed_at: body.completedAt,
      attendance_recorded_at: body.attendanceRecordedAt,
      value: body.value,
      tip: body.tip,
      products: body.products,
      pay_method: body.payMethod,
      payment_splits: body.paymentSplits,
      notes: body.notes,
    }).catch(error => { throw translatePlanAttendanceError(error); })),
    update: async (id: string, body: Row) => mapAppointment(await updateRow('appointments', id, {
      date: body.date,
      time: body.time,
      client: body.client,
      client_phone: body.clientPhone,
      client_id: body.clientId,
      professional_id: body.professionalId,
      ...('serviceId' in body ? { service_id: body.serviceId } : {}),
      ...('planSubscriberId' in body ? { plan_subscriber_id: body.planSubscriberId } : {}),
      ...('planUsageValue' in body ? { plan_usage_value: body.planUsageValue } : {}),
      ...('professionalCommissions' in body ? { professional_commissions: body.professionalCommissions } : {}),
      ...('sellerProfessionalId' in body
        ? { seller_professional_id: body.sellerProfessionalId ?? null }
        : {}),
      ...('sellerIsCompany' in body ? { seller_is_company: body.sellerIsCompany } : {}),
      service: body.service,
      ...('serviceDescription' in body ? { service_description: body.serviceDescription ?? null } : {}),
      duration: body.duration,
      status: body.status,
      checked_in_at: body.checkedInAt,
      completed_at: body.completedAt,
      value: body.value,
      tip: body.tip,
      products: body.products,
      pay_method: body.payMethod,
      payment_splits: body.paymentSplits,
      notes: body.notes,
    })),
    remove: (id: string) => removeRow('appointments', id),
  },
  blocks: {
    list: async () => (await listRows('blocks', 'date')).map(mapBlock),
    create: async (body: Row) => mapBlock(await insertRow('blocks', {
      id: body.id, date: body.date, professional_id: body.professionalId,
      slots: body.slots, reason: body.reason, notes: body.notes,
    })),
    remove: (id: string) => removeRow('blocks', id),
  },
  clients: {
    list: async () => (await listRows('clients')).map(mapClient),
    create: async (body: Row) => {
      await organizationId();
      const { data, error } = await client().rpc('create_or_get_client_by_phone', {
        p_id: body.id,
        p_name: body.name,
        p_email: body.email,
        p_whatsapp: body.whatsapp,
        p_birthday: body.birthday ?? null,
        p_source: body.source ?? null,
        p_source_other: body.sourceOther ?? null,
        p_interest: body.interest,
        p_created_at: body.createdAt,
        p_initial_visit: body.initialVisit ?? null,
      });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migração de cadastro atômico de clientes no Supabase antes de cadastrar clientes.');
        }
        throw new Error(`Não foi possível salvar o cliente: ${error.message}`);
      }
      const clientRow = Array.isArray(data) ? data[0] : data;
      if (!clientRow || typeof clientRow !== 'object') {
        throw new Error('O Supabase não retornou o cliente salvo.');
      }
      return mapClient(clientRow as Row);
    },
    update: async (id: string, body: Row) => mapClient(await updateRow('clients', id, {
      name: body.name, email: body.email, whatsapp: body.whatsapp, birthday: body.birthday,
      source: body.source, source_other: body.sourceOther, interest: body.interest, visits: body.visits,
    })),
    remove: (id: string) => removeRow('clients', id),
  },
  products: {
    list: async () => (await listRows('products')).map(mapProduct),
    create: async (body: Row) => mapProduct(await insertRow('products', {
      id: body.id, name: body.name, category: body.category, price: body.price, cost: body.cost,
      stock: body.stock, min_stock: body.minStock, is_active: body.isActive,
      is_prosthesis_capillary: body.isProsthesisCapillary,
    })),
    update: async (id: string, body: Row) => mapProduct(await updateRow('products', id, {
      name: body.name, category: body.category, price: body.price, cost: body.cost,
      stock: body.stock, min_stock: body.minStock, is_active: body.isActive,
      is_prosthesis_capillary: body.isProsthesisCapillary,
    })),
    adjustStock: async (id: string, delta: number) => {
      await organizationId();
      const { data, error } = await client().rpc('adjust_product_stock', {
        p_product_id: id,
        p_delta: delta,
      });
      if (error) throw new Error(`Não foi possível atualizar o estoque: ${error.message}`);
      return mapProduct(data as Row);
    },
    remove: (id: string) => removeRow('products', id),
  },
  productSales: {
    list: async () => (await listRows('product_sales', 'date')).map(mapProductSale),
    create: async (body: Row) => {
      await organizationId();
      const { data, error } = await client().rpc('record_product_sale', {
        p_date: body.date,
        p_client_id: body.clientId ?? null,
        p_appointment_id: body.appointmentId ?? null,
        p_payment_method: body.paymentMethod,
        p_items: body.items,
      });
      if (error) throw new Error(`Não foi possível registrar a venda de produtos: ${error.message}`);
      return mapProductSale(data as Row);
    },
    reverse: async (id: string, reason: string) => {
      await organizationId();
      const { data, error } = await client().rpc('reverse_product_sale', {
        p_sale_id: id,
        p_reason: reason,
      });
      if (error) throw new Error(`Não foi possível estornar a venda de produtos: ${error.message}`);
      return mapProductSale(data as Row);
    },
  },
  expenses: {
    list: async () => (await listRows('expenses', 'date')).map(mapExpense),
    create: async (body: Row, options: { returnRepresentation?: boolean } = {}) => {
      const values = {
        id: body.id, date: body.date, description: body.description, amount: body.amount, category: body.category,
        payment_method: body.paymentMethod,
      };
      const saved = options.returnRepresentation === false
        ? await insertRowWithoutRepresentation('expenses', values)
        : await insertRow('expenses', values);
      return mapExpense(saved);
    },
    update: async (id: string, body: Row) => mapExpense(await updateRow('expenses', id, {
      date: body.date, description: body.description, amount: body.amount, category: body.category,
      payment_method: body.paymentMethod,
    })),
    remove: (id: string) => removeRow('expenses', id),
  },
  incomes: {
    list: async () => (await listRows('incomes', 'date')).map(mapIncome),
    create: async (body: Row) => mapIncome(await insertRow('incomes', {
      id: body.id, date: body.date, description: body.description, amount: body.amount,
    })),
    update: async (id: string, body: Row) => mapIncome(await updateRow('incomes', id, {
      date: body.date, description: body.description, amount: body.amount,
    })),
    remove: (id: string) => removeRow('incomes', id),
  },
  financeHistory: {
    list: async (): Promise<FinanceHistoryItem[]> =>
      (await listRows('finance_entry_changes', 'changed_at')).map(mapFinanceHistory),
  },
  personalEarnings: {
    list: async (startDate: string, endDate: string, professionalId?: string): Promise<PersonalEarning[]> => {
      const db = client();
      const [baseResult, planResult, manualResult] = await Promise.all([
        db.rpc('get_my_financial_earnings', {
          p_start_date: startDate,
          p_end_date: endDate,
          p_professional_id: professionalId ?? null,
        }),
        db.rpc('get_my_plan_usage_earnings', {
          p_start_date: startDate,
          p_end_date: endDate,
          p_professional_id: professionalId ?? null,
        }),
        db.rpc('get_my_manual_appointment_commissions', {
          p_start_date: startDate,
          p_end_date: endDate,
          p_professional_id: professionalId ?? null,
        }),
      ]);
      if (baseResult.error || planResult.error || manualResult.error) {
        const error = baseResult.error ?? planResult.error ?? manualResult.error!;
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Aplique a migração de comissões individuais e usos de planos no Supabase para liberar este módulo.');
        }
        if (error.message.includes('active_professional_profile_required')) {
          throw new Error('Este usuário ainda não está vinculado a um profissional ativo. Peça ao gestor para conferir o cadastro.');
        }
        if (error.message.includes('cannot_request_another_professional_earnings')) {
          throw new Error('Por segurança, cada profissional só pode consultar os próprios ganhos.');
        }
        throw new Error(`Não foi possível carregar seus ganhos: ${error.message}`);
      }
      const plannedRows = arrayValue<Row>(planResult.data);
      const plannedAppointmentIds = new Set(plannedRows.map(row => String(row.entry_id ?? '').replace(/:plan-(performer|seller)$/, '')));
      const manualRows = arrayValue<Row>(manualResult.data);
      const manualAppointmentIds = new Set(manualRows.map(row => String(row.entry_id ?? '').replace(/:manual:.+$/, '')));
      const baseRows = arrayValue<Row>(baseResult.data).filter(row => {
        const entryId = String(row.entry_id ?? '');
        const appointmentId = entryId.replace(/:(performer|seller)$/, '');
        return !plannedAppointmentIds.has(appointmentId)
          && !(entryId.endsWith(':performer') && manualAppointmentIds.has(appointmentId));
      });
      const visibleManualRows = manualRows.filter(row => Number(row.amount ?? 0) > 0);
      return [...baseRows, ...plannedRows, ...visibleManualRows].map(row => ({
        id: String(row.entry_id ?? ''),
        date: String(row.entry_date ?? '').slice(0, 10),
        kind: (row.kind === 'tip' ? 'tip' : 'commission') as PersonalEarning['kind'],
        source: String(row.source ?? ''),
        attribution: String(row.attribution ?? ''),
        amount: Number(row.amount ?? 0),
      })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    },
  },
  cashClosings: {
    list: async (): Promise<CashClosing[]> =>
      (await listRows('cash_closings', 'period_end')).map(mapCashClosing),
    create: async (body: Row) => mapCashClosing(await insertRow('cash_closings', {
      organization_id: await organizationId(),
      period_start: body.periodStart,
      period_end: body.periodEnd,
      frequency: body.frequency,
      total_income: body.totalIncome,
      total_expenses: body.totalExpenses,
      net_total: body.netTotal,
    })),
  },
  prothesisSales: {
    list: async () => (await listRows('prothesis_sales', 'date')).map(mapProthesisSale),
    create: async (body: Row) => mapProthesisSale(await insertRow('prothesis_sales', {
      id: body.id, date: body.date, client: body.client, whatsapp: body.whatsapp, value: body.value,
      seller_id: body.sellerId, installments: body.installments, installments_paid: body.installmentsPaid,
      pay_method1: body.payMethod1, pay_amount1: body.payAmount1, pay_method2: body.payMethod2,
      pay_amount2: body.payAmount2, last_maintenance: body.lastMaintenance, notes: body.notes,
    })),
    update: async (id: string, body: Row) => mapProthesisSale(await updateRow('prothesis_sales', id, {
      date: body.date, client: body.client, whatsapp: body.whatsapp, value: body.value,
      seller_id: body.sellerId, installments: body.installments, installments_paid: body.installmentsPaid,
      pay_method1: body.payMethod1, pay_amount1: body.payAmount1, pay_method2: body.payMethod2,
      pay_amount2: body.payAmount2, last_maintenance: body.lastMaintenance, notes: body.notes,
    })),
    remove: (id: string) => removeRow('prothesis_sales', id),
  },
  mentoriaSessions: {
    list: async () => (await listRows('mentoria_sessions', 'date')).map(mapMentoria),
    create: async (body: Row) => mapMentoria(await insertRow('mentoria_sessions', {
      id: body.id, date: body.date, client: body.client, seller_id: body.sellerId,
      value: body.value, duration_hours: body.durationHours, status: body.status, notes: body.notes,
    })),
    update: async (id: string, body: Row) => mapMentoria(await updateRow('mentoria_sessions', id, {
      date: body.date, client: body.client, seller_id: body.sellerId, value: body.value,
      duration_hours: body.durationHours, status: body.status, notes: body.notes,
    })),
    remove: (id: string) => removeRow('mentoria_sessions', id),
  },
  plans: {
    list: async () => (await listRows('subscription_plans')).map(mapPlan),
    create: async (body: Row) => mapPlan(await insertRow('subscription_plans', {
      id: body.id, name: body.name, price: body.price, services: body.services, duration: body.duration,
      salon_share_percent: body.salonSharePercent ?? null,
    })),
    update: async (id: string, body: Row) => mapPlan(await updateRow('subscription_plans', id, {
      name: body.name, price: body.price, services: body.services, duration: body.duration,
      salon_share_percent: body.salonSharePercent ?? null,
    })),
    remove: (id: string) => removeRow('subscription_plans', id),
  },
  subscribers: {
    list: async () => (await listRows('subscribers')).map(mapSubscriber),
    create: async (body: Row) => mapSubscriber(await insertRow('subscribers', {
      id: body.id, name: body.name, phone: body.phone, plan_id: body.planId,
      start_date: body.startDate, next_payment: body.nextPayment,
      status: body.status,
    })),
    update: async (id: string, body: Row) => mapSubscriber(await updateRow('subscribers', id, {
      name: body.name, phone: body.phone, plan_id: body.planId,
      start_date: body.startDate, next_payment: body.nextPayment, status: body.status,
    })),
    remove: (id: string) => removeRow('subscribers', id),
    renewUsages: async (id: string): Promise<Subscriber> => {
      await organizationId();
      const { data, error } = await client().rpc('renew_subscriber_plan_usages', {
        p_subscriber_id: id,
      });
      if (error) throw new Error(`Não foi possível renovar os usos do plano: ${error.message}`);
      return mapSubscriber(data as Row);
    },
  },
  subscriptionPayments: {
    list: async () => (await listRows('subscription_payments', 'due_date')).map(mapSubscriptionPayment),
    setStatus: async (body: {
      subscriberId: string;
      dueDate: string;
      status: SubscriptionPaymentStatus;
      paidAt?: string;
      amount: number;
      paymentMethod?: string;
      note?: string;
    }): Promise<{ payment: SubscriptionPayment; subscriber: Subscriber; nextPayment?: SubscriptionPayment }> => {
      await organizationId();
      const { data, error } = await client().rpc('set_subscription_payment_status', {
        p_subscriber_id: body.subscriberId,
        p_due_date: body.dueDate,
        p_status: body.status,
        p_paid_at: body.paidAt ?? null,
        p_amount: body.amount,
        p_payment_method: body.paymentMethod ?? null,
        p_note: body.note ?? null,
      });
      if (error) throw new Error(`Não foi possível atualizar a mensalidade: ${error.message}`);
      const payload = data as Row;
      return {
        payment: mapSubscriptionPayment(payload.payment as Row),
        subscriber: mapSubscriber(payload.subscriber as Row),
        nextPayment: payload.next_payment ? mapSubscriptionPayment(payload.next_payment as Row) : undefined,
      };
    },
  },
  config: {
    get: async () => {
      const orgId = await organizationId();
      const db = client();
      const { data, error } = await db.from('organization_settings').select('payload').eq('organization_id', orgId).maybeSingle();
      if (error) throw new Error(`Não foi possível carregar as configurações: ${error.message}`);
      const payload = { ...((data?.payload ?? {}) as Row) };
      const logoPath = getStorageObjectPath(payload.logo, 'logos');
      if (!logoPath) return payload;

      const { data: userData, error: userError } = await db.auth.getUser();
      if (userError || !userData.user) return { ...payload, logo: undefined };
      const { data: membership, error: membershipError } = await db
        .from('organization_members')
        .select('role')
        .eq('organization_id', orgId)
        .eq('user_id', userData.user.id)
        .maybeSingle();
      if (membershipError) throw new Error(`Não foi possível carregar seu acesso: ${membershipError.message}`);
      if (!['gestor', 'dev-admin'].includes(String(membership?.role || ''))) {
        return { ...payload, logo: undefined };
      }

      const { data: logoData, error: logoError } = await db.storage.from('logos').createSignedUrl(logoPath, 3600);
      return {
        ...payload,
        logo: logoError || !logoData?.signedUrl ? undefined : logoData.signedUrl,
        logoPath,
      };
    },
    update: async (body: Row) => {
      const orgId = await organizationId();
      const logoPath = getStorageObjectPath(body.logoPath ?? body.logo, 'logos');
      const payload: Row = { ...body, logo: logoPath ?? null };
      delete payload.logoPath;
      const { error: organizationError } = await client().rpc('update_organization_details', {
        p_name: String(body.name ?? ''),
        p_cnpj: String(body.cnpj ?? ''),
        p_address: String(body.address ?? ''),
        p_logo_url: logoPath ?? null,
      });
      if (organizationError) throw new Error(`Não foi possível salvar os dados do estabelecimento: ${organizationError.message}`);
      const { data, error } = await client()
        .from('organization_settings')
        .upsert({ organization_id: orgId, payload }, { onConflict: 'organization_id' })
        .select('payload')
        .single();
      if (error) throw new Error(`Não foi possível salvar as configurações: ${error.message}`);
      return (data?.payload ?? {}) as Row;
    },
  },
};

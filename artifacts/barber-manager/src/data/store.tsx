/**
 * Central data store — API-backed.
 * All state is fetched from the backend on mount and kept in memory.
 * Mutations use optimistic updates: state changes immediately, then the API
 * call fires in the background. On failure a toast appears and the state rolls back.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { api, type FinanceHistoryItem } from './api';
import type { CashClosingFrequency } from './cash-closing';
import { formatDateKey } from './date';
import { useAuth } from '@/auth/auth';
import { DEFAULT_ROLE_PERMISSIONS } from '@/auth/roles';
import { useQueryClient } from '@tanstack/react-query';

// ─── Entity types ──────────────────────────────────────────────────────────────

export type Role = string;
export type ClientSource = 'Indicação' | 'Instagram' | 'Google' | 'Facebook' | 'Site' | 'Passou na rua' | 'Outro' | string;
export type ClientInterest = 'barbearia' | 'salao' | 'protese';
export type PayMethod = 'debito' | 'credito' | 'pix' | 'dinheiro';
export type ApptStatus =
  | 'confirmed'
  | 'pending'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled';
export type ExpenseCategory =
  | 'Aluguel'
  | 'Produtos'
  | 'Marketing'
  | 'Folha de pagamento'
  | 'Manutenção'
  | 'Outros';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Aluguel', 'Produtos', 'Marketing', 'Folha de pagamento', 'Manutenção', 'Outros',
];

export const PAY_LABELS: Record<PayMethod, string> = {
  debito: 'Débito',
  credito: 'Crédito',
  pix: 'PIX',
  dinheiro: 'Dinheiro',
};

export interface ProfessionalCommissions {
  barbearia: number;
  manutencao: number;
  manicure: number;
  protese: number;
  mentoria: number;
}

export interface Professional {
  id: string;
  name: string;
  role: Role;
  initials: string;
  color: string;
  isActive: boolean;
  commissions: ProfessionalCommissions;
}

export interface AppointmentProduct {
  productId: string;
  quantity: number;
}

export interface ProfessionalCommissionAssignment {
  professionalId: string;
  amount: number;
}

export interface Appointment {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  client: string;
  clientPhone?: string;
  clientId?: string;
  professionalId: string;
  serviceId?: string;
  planSubscriberId?: string;
  planUsageValue?: number;
  serviceCommissionRateSnapshot?: number;
  prosthesisCostSnapshot?: number;
  prosthesisCommissionRuleSnapshot?: boolean;
  professionalCommissions?: ProfessionalCommissionAssignment[];
  sellerProfessionalId?: string;
  sellerIsCompany?: boolean;
  service: string;
  serviceDescription?: string;
  duration: number; // minutes
  status: ApptStatus;
  checkedInAt?: string;
  completedAt?: string;
  attendanceRecordedAt?: string;
  notes?: string;
  value: number;
  tip: number;
  products: AppointmentProduct[];
  payMethod: PayMethod;
  paymentSplits?: PaymentSplit[];
}

export interface PaymentSplit {
  method: PayMethod;
  amount: number;
}

export interface Block {
  id: string;
  date: string;
  professionalId: string;
  slots: string[]; // [] = full day
  reason: string;
  notes?: string;
}

export interface ClientVisit {
  id: string;
  date: string;
  type: 'servico' | 'produto';
  description: string;
  professional?: string;
  amount: number;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  birthday?: string;
  source?: ClientSource;
  sourceOther?: string;
  interest: ClientInterest;
  createdAt: string;
  visits: ClientVisit[];
}

export interface SavedClient extends Client {
  wasCreated: boolean;
  initialVisitId?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  isProsthesisCapillary: boolean;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  price: number;
  duration: number;
  commissionKey: string;
  isActive: boolean;
  sortOrder: number;
  legacyNames?: string[];
}

export interface RoleItem {
  id: string;
  key: string;
  label: string;
  description: string;
  isActive: boolean;
  permissions: string[];
}

export interface ProthesisSale {
  id: string;
  date: string;
  client: string;
  whatsapp?: string;
  value: number;
  sellerId: string;
  installments: number;
  installmentsPaid: number;
  payMethod1: PayMethod;
  payAmount1: number;
  payMethod2?: PayMethod;
  payAmount2?: number;
  lastMaintenance?: string;
  notes?: string;
}

export interface MentoriaSession {
  id: string;
  date: string;
  client: string;
  sellerId: string;
  value: number;
  durationHours: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
}

export interface Expense {
  id: string;
  date: string;
  createdAt?: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  paymentMethod?: PayMethod;
}

export interface Income {
  id: string;
  date: string;
  description: string;
  amount: number;
}

export type ProductSaleDiscountType = 'amount' | 'percent';

export interface ProductSaleItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discountType?: ProductSaleDiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
}

export interface ProductSale {
  id: string;
  date: string;
  reversalDate?: string;
  reversalReason?: string;
  reversedAt?: string;
  clientId?: string;
  appointmentId?: string;
  paymentMethod: PayMethod;
  items: ProductSaleItem[];
  total: number;
  createdAt: string;
}

export interface CashClosing {
  id: string;
  periodStart: string;
  periodEnd: string;
  frequency: CashClosingFrequency;
  totalIncome: number;
  totalExpenses: number;
  netTotal: number;
  createdAt: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  services: Array<string | PlanServiceBenefit>;
  duration: 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';
  /**
   * Salon share for new uses/payments. Null means a legacy plan keeps its
   * existing professional commission rules until a manager configures it.
   */
  salonSharePercent?: number | null;
}

export interface PlanServiceBenefit {
  serviceId: string;
  serviceName: string;
  usesPerCycle: number;
}

export interface Subscriber {
  id: string;
  name: string;
  phone: string;
  planId: string;
  professionalId?: string;
  startDate: string;
  nextPayment: string;
  status: 'ativo' | 'vencido' | 'pendente';
  usageStartedAt?: string;
  salonSharePercentSnapshot?: number | null;
}

export type SubscriptionPaymentStatus = 'pago' | 'pendente' | 'vencido';

export interface SubscriptionPayment {
  id: string;
  subscriberId: string;
  dueDate: string;
  paidAt?: string;
  amount: number;
  paymentMethod?: PayMethod;
  status: SubscriptionPaymentStatus;
  note?: string;
  salonSharePercentSnapshot?: number;
}

export interface BarbeariaConfig {
  name: string;
  cnpj: string;
  address: string;
  logo?: string;
  logoPath?: string;
  services: ServiceItem[];
  roles: RoleItem[];
  paymentMethods: { key: PayMethod; label: string; isActive: boolean }[];
  clientSources: string[];
  clientSegments: { key: ClientInterest; label: string }[];
  defaultServiceDuration: number;
  cashClosing: {
    frequency: CashClosingFrequency;
    weekday: number;
    dayOfMonth: number;
  };
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

export const brl = (n: number): string =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const productStatus = (p: Product): 'critical' | 'low' | 'ok' => {
  if (p.stock <= Math.max(2, Math.floor(p.minStock * 0.2))) return 'critical';
  if (p.stock <= p.minStock) return 'low';
  return 'ok';
};

const uid = (): string => crypto.randomUUID();

function subscriptionPaymentKey(payment: SubscriptionPayment) {
  return `${payment.subscriberId}:${payment.dueDate}`;
}

// Cast API response to typed entity
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = <T,>(x: unknown): T => x as T;

// ─── Store interface ───────────────────────────────────────────────────────────

export interface AppStoreValue {
  isLoading: boolean;

  // Professionals
  professionals: Professional[];
  addProfessional: (p: Omit<Professional, 'id'>) => Promise<boolean>;
  updateProfessional: (id: string, p: Partial<Professional>) => Promise<boolean>;
  removeProfessional: (id: string) => Promise<boolean>;
  getProfessional: (id: string) => Professional | undefined;

  // Appointments
  appointments: Appointment[];
  addAppointment: (a: Omit<Appointment, 'id'>) => Promise<Appointment | null>;
  updateAppointment: (id: string, a: Partial<Appointment>) => Promise<boolean>;
  removeAppointment: (id: string) => Promise<boolean>;

  // Blocks
  blocks: Block[];
  addBlock: (b: Omit<Block, 'id'>) => Promise<boolean>;
  removeBlock: (id: string) => Promise<boolean>;

  // Clients
  clients: Client[];
  addClient: (
    c: Omit<Client, 'id' | 'createdAt' | 'visits'>,
    initialVisit?: Omit<ClientVisit, 'id'>,
    options?: { notifyOnError?: boolean },
  ) => Promise<SavedClient | null>;
  updateClient: (id: string, c: Partial<Omit<Client, 'id' | 'createdAt' | 'visits'>>) => Promise<boolean>;
  removeClient: (id: string) => Promise<boolean>;
  addVisit: (clientId: string, visit: Omit<ClientVisit, 'id'>) => Promise<ClientVisit | null>;
  removeVisit: (clientId: string, visitId: string) => Promise<boolean>;

  // Products
  products: Product[];
  addProduct: (p: Omit<Product, 'id'>) => Promise<boolean>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<boolean>;
  removeProduct: (id: string) => Promise<boolean>;
  sellProduct: (id: string, qty: number) => Promise<boolean>;
  restock: (id: string, qty: number) => Promise<boolean>;
  productSales: ProductSale[];
  recordProductSale: (input: {
    date: string;
    clientId?: string;
    appointmentId?: string;
    paymentMethod: PayMethod;
    items: Array<{
      productId: string;
      quantity: number;
      discountType?: ProductSaleDiscountType;
      discountValue: number;
    }>;
  }) => Promise<ProductSale | null>;
  reverseProductSale: (id: string, reason: string) => Promise<ProductSale | null>;

  // Prothesis Sales
  prothesisSales: ProthesisSale[];
  addProthesisSale: (s: Omit<ProthesisSale, 'id'>) => Promise<boolean>;
  updateProthesisSale: (id: string, s: Partial<ProthesisSale>) => Promise<boolean>;
  removeProthesisSale: (id: string) => Promise<boolean>;

  // Mentoria
  mentoriaSessions: MentoriaSession[];
  addMentoriaSession: (m: Omit<MentoriaSession, 'id'>) => Promise<boolean>;
  updateMentoriaSession: (id: string, m: Partial<MentoriaSession>) => Promise<boolean>;
  removeMentoriaSession: (id: string) => Promise<boolean>;

  // Finance
  expenses: Expense[];
  addExpense: (e: Omit<Expense, 'id'>) => Promise<boolean>;
  updateExpense: (id: string, e: Partial<Expense>) => Promise<boolean>;
  removeExpense: (id: string) => Promise<boolean>;
  incomes: Income[];
  addIncome: (i: Omit<Income, 'id'>) => Promise<boolean>;
  updateIncome: (id: string, i: Partial<Income>) => Promise<boolean>;
  removeIncome: (id: string) => Promise<boolean>;
  financeHistory: FinanceHistoryItem[];
  refreshFinanceHistory: () => Promise<void>;
  cashClosings: CashClosing[];
  addCashClosing: (closing: Omit<CashClosing, 'id' | 'createdAt'>) => Promise<CashClosing | null>;
  removeCashClosing: (id: string) => Promise<boolean>;

  // Plans
  plans: SubscriptionPlan[];
  addPlan: (p: Omit<SubscriptionPlan, 'id'>) => Promise<boolean>;
  updatePlan: (id: string, p: Partial<SubscriptionPlan>) => Promise<boolean>;
  removePlan: (id: string) => Promise<boolean>;

  // Subscribers
  subscribers: Subscriber[];
  addSubscriber: (s: Omit<Subscriber, 'id'>) => Promise<Subscriber | null>;
  updateSubscriber: (id: string, s: Partial<Subscriber>) => Promise<boolean>;
  removeSubscriber: (id: string) => Promise<boolean>;
  renewSubscriberPlanUsages: (id: string) => Promise<boolean>;
  subscriptionPayments: SubscriptionPayment[];
  removeSubscriptionPayment: (id: string) => Promise<boolean>;
  setSubscriptionPaymentStatus: (input: {
    subscriberId: string;
    dueDate: string;
    status: SubscriptionPaymentStatus;
    paidAt?: string;
    amount: number;
    paymentMethod?: PayMethod;
    note?: string;
  }) => Promise<boolean>;

  // Config
  config: BarbeariaConfig;
  updateConfig: (c: Partial<BarbeariaConfig>) => Promise<boolean>;
}

// ─── Context & Provider ───────────────────────────────────────────────────────

const StoreContext = createContext<AppStoreValue | null>(null);

export const DEFAULT_SERVICES: ServiceItem[] = [
  { id: 'service-barbearia', name: 'Barbearia', category: 'Barbearia', price: 0, duration: 30, commissionKey: 'barbearia', isActive: true, sortOrder: 1 },
  { id: 'service-manutencao', name: 'Manutenção', category: 'Barbearia', price: 0, duration: 30, commissionKey: 'manutencao', isActive: true, sortOrder: 2 },
  { id: 'service-manicure', name: 'Manicure', category: 'Salão de Beleza', price: 0, duration: 60, commissionKey: 'manicure', isActive: true, sortOrder: 3 },
  { id: 'service-protese', name: 'Prótese Capilar', category: 'Prótese', price: 0, duration: 120, commissionKey: 'protese', isActive: true, sortOrder: 4 },
  { id: 'service-mentoria', name: 'Mentoria', category: 'Prótese', price: 0, duration: 120, commissionKey: 'mentoria', isActive: true, sortOrder: 5 },
];

export const DEFAULT_ROLES: RoleItem[] = [
  { id: 'role-gestor', key: 'gestor', label: 'Gestor / Proprietário', description: 'Acesso completo ao sistema.', isActive: true, permissions: DEFAULT_ROLE_PERMISSIONS.gestor },
  { id: 'role-recepcao', key: 'recepcao', label: 'Recepcionista', description: 'Acesso operacional sem Financeiro, Equipe, Configurações ou Disparos de Mensagens; não é um perfil profissional.', isActive: true, permissions: DEFAULT_ROLE_PERMISSIONS.recepcao },
  { id: 'role-barbeiro', key: 'barbeiro', label: 'Barbeiro', description: 'Agenda e controle diário próprios.', isActive: true, permissions: DEFAULT_ROLE_PERMISSIONS.barbeiro },
  { id: 'role-manicure', key: 'manicure', label: 'Manicure', description: 'Agenda e controle diário próprios.', isActive: true, permissions: DEFAULT_ROLE_PERMISSIONS.manicure },
  { id: 'role-vendedor', key: 'vendedor', label: 'Vendedor de Prótese', description: 'Agenda, controle diário e clientes.', isActive: true, permissions: DEFAULT_ROLE_PERMISSIONS.vendedor },
];

export const DEFAULT_CONFIG: BarbeariaConfig = {
  name: 'Beauty Manager', cnpj: '', address: '',
  services: DEFAULT_SERVICES, roles: DEFAULT_ROLES,
  paymentMethods: [
    { key: 'pix', label: 'PIX', isActive: true },
    { key: 'dinheiro', label: 'Dinheiro', isActive: true },
    { key: 'debito', label: 'Débito', isActive: true },
    { key: 'credito', label: 'Crédito', isActive: true },
  ],
  clientSources: ['Indicação', 'Instagram', 'Google', 'Facebook', 'Site', 'Passou na rua', 'Outro'],
  clientSegments: [
    { key: 'barbearia', label: 'Barbearia' },
    { key: 'salao', label: 'Salão de Beleza' },
    { key: 'protese', label: 'Prótese Capilar' },
  ],
  defaultServiceDuration: 30,
  cashClosing: { frequency: 'weekly', weekday: 6, dayOfMonth: 1 },
};

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const scope = user && profile?.role && profile.organizationId
    ? JSON.stringify([user.id, profile.organizationId, profile.role, profile.professionalId, profile.permissions])
    : 'no-access';

  useEffect(() => {
    queryClient.clear();
  }, [scope, queryClient]);

  // A scope change discards every entity and mutation closure synchronously.
  // Late requests can only update the unmounted instance, never the next user.
  return <ScopedAppStoreProvider key={scope}>{children}</ScopedAppStoreProvider>;
}

function ScopedAppStoreProvider({ children }: { children: ReactNode }) {
  const { user, profile, viewAsProfile } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const viewAsProfileRef = useRef(viewAsProfile);
  viewAsProfileRef.current = viewAsProfile;

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const clientsRef = useRef<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [prothesisSales, setProthesisSales] = useState<ProthesisSale[]>([]);
  const [mentoriaSessions, setMentoriaSessions] = useState<MentoriaSession[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [financeHistory, setFinanceHistory] = useState<FinanceHistoryItem[]>([]);
  const [cashClosings, setCashClosings] = useState<CashClosing[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [config, setConfig] = useState<BarbeariaConfig>(DEFAULT_CONFIG);

  // The ref makes a server-returned client available to rollback calls immediately,
  // before React has rendered the corresponding state update.
  const commitClients = useCallback((update: (current: Client[]) => Client[]) => {
    const next = update(clientsRef.current);
    clientsRef.current = next;
    setClients(next);
  }, []);

  // Keep a stable ref to products for sellProduct (avoids stale closure)
  const productsRef = useRef(products);
  useEffect(() => { productsRef.current = products; }, [products]);

  // ── Load all data after AuthProvider has resolved the active organization ──
  useEffect(() => {
    let cancelled = false;
    if (!user || !profile?.role || !profile.organizationId) {
      setProfessionals([]);
      setAppointments([]);
      setBlocks([]);
      clientsRef.current = [];
      setClients([]);
      setProducts([]);
      setProductSales([]);
      setProthesisSales([]);
      setMentoriaSessions([]);
      setExpenses([]);
      setIncomes([]);
       setFinanceHistory([]);
      setCashClosings([]);
      setPlans([]);
      setSubscribers([]);
      setSubscriptionPayments([]);
      setConfig(DEFAULT_CONFIG);
      setIsLoading(false);
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    const canLoadFinancialData = profile.role !== 'recepcao';

    Promise.all([
      api.professionals.list(),
      api.appointments.list(),
      api.blocks.list(),
      api.clients.list(),
      api.products.list(),
      api.productSales.list(),
      canLoadFinancialData ? api.prothesisSales.list() : Promise.resolve([]),
      canLoadFinancialData ? api.mentoriaSessions.list() : Promise.resolve([]),
      canLoadFinancialData ? api.expenses.list() : Promise.resolve([]),
      canLoadFinancialData ? api.incomes.list() : Promise.resolve([]),
      canLoadFinancialData ? api.financeHistory.list() : Promise.resolve([]),
      canLoadFinancialData ? api.cashClosings.list() : Promise.resolve([]),
      api.plans.list(),
      api.subscribers.list(),
      api.subscriptionPayments.list(),
      api.config.get(),
    ])
      .then(([profs, appts, blks, cls, prods, productSalesRows, psales, msessions, exps, incs, history, closings, pls, subs, payments, cfg]) => {
        if (cancelled) return;
        setProfessionals((profs as unknown[]).map(cast<Professional>));
        setAppointments((appts as unknown[]).map(cast<Appointment>));
        setBlocks((blks as unknown[]).map(cast<Block>));
        commitClients(() => (cls as unknown[]).map(x => {
          const c = cast<Client>(x);
          // Ensure visits is always an array
          return { ...c, visits: Array.isArray(c.visits) ? c.visits : [] };
        }));
        setProducts((prods as unknown[]).map(x => {
          const product = cast<Partial<Product>>(x);
          return {
            ...product,
            isActive: product.isActive ?? true,
            isProsthesisCapillary: product.isProsthesisCapillary ?? false,
          } as Product;
        }));
        setProductSales((productSalesRows as unknown[]).map(cast<ProductSale>));
        setProthesisSales((psales as unknown[]).map(cast<ProthesisSale>));
        setMentoriaSessions((msessions as unknown[]).map(cast<MentoriaSession>));
        setExpenses((exps as unknown[]).map(cast<Expense>));
        setIncomes((incs as unknown[]).map(cast<Income>));
        setFinanceHistory((history as FinanceHistoryItem[]));
        setCashClosings((closings as unknown[]).map(cast<CashClosing>));
        setPlans((pls as unknown[]).map(cast<SubscriptionPlan>));
        setSubscribers((subs as unknown[]).map(cast<Subscriber>));
        setSubscriptionPayments((payments as unknown[]).map(cast<SubscriptionPayment>));
        const remoteConfig = cast<Partial<BarbeariaConfig>>(cfg) ?? {};
        setConfig({
          ...DEFAULT_CONFIG,
          ...remoteConfig,
          services: remoteConfig.services?.length ? remoteConfig.services : DEFAULT_SERVICES,
            roles: remoteConfig.roles?.length
              ? [
                ...remoteConfig.roles.map(role => ({
               ...role,
               permissions: Array.isArray(role.permissions)
                 ? role.permissions
                 : (DEFAULT_ROLE_PERMISSIONS[role.key] || ['dashboard']),
                })),
                ...DEFAULT_ROLES.filter(role =>
                  role.key === 'recepcao' && !remoteConfig.roles?.some(existing => existing.key === role.key),
                ),
              ]
             : DEFAULT_ROLES,
          paymentMethods: remoteConfig.paymentMethods?.length ? remoteConfig.paymentMethods : DEFAULT_CONFIG.paymentMethods,
          clientSources: remoteConfig.clientSources?.length ? remoteConfig.clientSources : DEFAULT_CONFIG.clientSources,
          clientSegments: remoteConfig.clientSegments?.length ? remoteConfig.clientSegments : DEFAULT_CONFIG.clientSegments,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load data from API:', err);
        toast.error('Erro ao carregar dados. Verifique a conexão.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.id, profile?.organizationId, profile?.role, profile?.professionalId, commitClients]);

  // ─── Persist first, then publish the confirmed server state ─────────────────

  async function mutation<T>(
    apiFn: () => Promise<T>,
    errMsg: string,
    notifyOnError = true,
  ): Promise<T | undefined> {
    if (viewAsProfileRef.current) return undefined;
    try {
      const result = await apiFn();
      // Delete endpoints intentionally return no row. Preserve success with a
      // sentinel so callers can distinguish it from a rejected request.
      return result === undefined ? (true as unknown as T) : result;
    } catch (err) {
      console.error(errMsg, err);
      if (notifyOnError) toast.error(errMsg);
      return undefined;
    }
  }

  const refreshFinanceHistory = useCallback(async () => {
    try {
      setFinanceHistory(await api.financeHistory.list());
    } catch (err) {
      console.error('Erro ao atualizar histórico financeiro', err);
    }
  }, []);

  // ── Professionals ──
  const addProfessional = useCallback(async (p: Omit<Professional, 'id'>) => {
    const newP: Professional = { ...p, id: uid() };
    const saved = await mutation(
      () => api.professionals.create(newP as unknown as Record<string, unknown>),
      'Erro ao salvar profissional',
    );
    if (!saved) return false;
    setProfessionals(prev => [...prev, cast<Professional>(saved)]);
    return true;
  }, []);

  const updateProfessional = useCallback(async (id: string, p: Partial<Professional>) => {
    const saved = await mutation(
      () => api.professionals.update(id, p),
      'Erro ao atualizar profissional',
    );
    if (!saved) return false;
    setProfessionals(prev => prev.map(item => item.id === id ? cast<Professional>(saved) : item));
    return true;
  }, []);

  const removeProfessional = useCallback(async (id: string) => {
    if (viewAsProfileRef.current) return false;
    try {
      await api.professionals.remove(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao remover profissional');
      return false;
    }
    setProfessionals(prev => prev.filter(item => item.id !== id));
    setAppointments(prev => prev.map(item => item.professionalId === id ? { ...item, professionalId: '' } : item));
    setBlocks(prev => prev.map(item => item.professionalId === id ? { ...item, professionalId: '' } : item));
    setProthesisSales(prev => prev.map(item => item.sellerId === id ? { ...item, sellerId: '' } : item));
    setMentoriaSessions(prev => prev.map(item => item.sellerId === id ? { ...item, sellerId: '' } : item));
    setSubscribers(prev => prev.map(item => item.professionalId === id ? { ...item, professionalId: '' } : item));
    return true;
  }, []);

  const getProfessional = useCallback((id: string) => professionals.find(p => p.id === id), [professionals]);

  // ── Appointments ──
  const addAppointment = useCallback(async (a: Omit<Appointment, 'id'>) => {
    const newA: Appointment = { ...a, id: uid() };
    const saved = await mutation(
      () => api.appointments.create(newA as unknown as Record<string, unknown>),
      'Erro ao salvar agendamento',
    );
    if (!saved) return null;
    const created = cast<Appointment>(saved);
    setAppointments(prev => [...prev, created]);
    return created;
  }, []);

  const updateAppointment = useCallback(async (id: string, a: Partial<Appointment>) => {
    const saved = await mutation(
      () => api.appointments.update(id, a),
      'Erro ao atualizar agendamento',
    );
    if (!saved) return false;
    setAppointments(prev => prev.map(item => item.id === id ? cast<Appointment>(saved) : item));
    return true;
  }, []);

  const removeAppointment = useCallback(async (id: string) => {
    if (viewAsProfileRef.current) return false;
    try {
      await api.appointments.remove(id);
    } catch (err) {
      console.error('Erro ao remover agendamento', err);
      toast.error(
        err instanceof Error && err.message.includes('attendance_delete_window_expired')
          ? 'O prazo de 24 horas para excluir este atendimento terminou.'
          : 'Erro ao remover agendamento',
      );
      return false;
    }
    setAppointments(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Blocks ──
  const addBlock = useCallback(async (b: Omit<Block, 'id'>) => {
    const newB: Block = { ...b, id: uid() };
    const saved = await mutation(
      () => api.blocks.create(newB as unknown as Record<string, unknown>),
      'Erro ao criar bloqueio',
    );
    if (!saved) return false;
    setBlocks(prev => [...prev, saved]);
    return true;
  }, []);

  const removeBlock = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.blocks.remove(id),
      'Erro ao remover bloqueio',
    );
    if (saved === undefined) return false;
    setBlocks(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Clients ──
  const addClient = useCallback(async (
    c: Omit<Client, 'id' | 'createdAt' | 'visits'>,
    initialVisit?: Omit<ClientVisit, 'id'>,
    options?: { notifyOnError?: boolean },
  ) => {
    const savedVisit = initialVisit ? { ...initialVisit, id: uid() } : undefined;
    const newC = {
      ...c,
      id: uid(),
      createdAt: formatDateKey(),
      visits: savedVisit ? [savedVisit] : [],
      initialVisit: savedVisit,
    };
    const saved = await mutation(
      () => api.clients.create(newC as unknown as Record<string, unknown>),
      'Erro ao salvar cliente',
      options?.notifyOnError !== false,
    );
    if (!saved) return null;
    const clientRecord = cast<Client>(saved);
    const created: SavedClient = {
      ...clientRecord,
      wasCreated: clientRecord.id === newC.id,
      initialVisitId: savedVisit?.id,
    };
    commitClients(prev => {
      const existingIndex = prev.findIndex(item => item.id === created.id);
      if (existingIndex < 0) return [...prev, clientRecord];
      return prev.map(item => item.id === created.id ? clientRecord : item);
    });
    return created;
  }, [commitClients]);

  const updateClient = useCallback(async (id: string, c: Partial<Omit<Client, 'id' | 'createdAt' | 'visits'>>) => {
    const saved = await mutation(
      () => api.clients.update(id, c),
      'Erro ao atualizar cliente',
    );
    if (!saved) return false;
    commitClients(prev => prev.map(item => item.id === id ? cast<Client>(saved) : item));
    return true;
  }, [commitClients]);

  const removeClient = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.clients.remove(id),
      'Erro ao remover cliente',
    );
    if (saved === undefined) return false;
    commitClients(prev => prev.filter(item => item.id !== id));
    return true;
  }, [commitClients]);

  const addVisit = useCallback(async (clientId: string, visit: Omit<ClientVisit, 'id'>) => {
    const current = clientsRef.current.find(item => item.id === clientId);
    if (!current) return null;
    const newVisit: ClientVisit = { ...visit, id: uid() };
    const saved = await mutation(
      () => api.clients.update(clientId, { visits: [...current.visits, newVisit] }),
      'Erro ao salvar visita',
    );
    if (!saved) return null;
    commitClients(prev => prev.map(item => item.id === clientId ? cast<Client>(saved) : item));
    return newVisit;
  }, [commitClients]);

  const removeVisit = useCallback(async (clientId: string, visitId: string) => {
    const current = clientsRef.current.find(item => item.id === clientId);
    if (!current) return false;
    const saved = await mutation(
      () => api.clients.update(clientId, { visits: current.visits.filter(item => item.id !== visitId) }),
      'Erro ao remover visita',
    );
    if (!saved) return false;
    commitClients(prev => prev.map(item => item.id === clientId ? cast<Client>(saved) : item));
    return true;
  }, [commitClients]);

  // ── Products ──
  const addProduct = useCallback(async (p: Omit<Product, 'id'>) => {
    const newP: Product = { ...p, id: uid() };
    const saved = await mutation(
      () => api.products.create(newP as unknown as Record<string, unknown>),
      'Erro ao salvar produto',
    );
    if (!saved) return false;
    setProducts(prev => [...prev, saved]);
    return true;
  }, []);

  const updateProduct = useCallback(async (id: string, p: Partial<Product>) => {
    const saved = await mutation(
      () => api.products.update(id, p),
      'Erro ao atualizar produto',
    );
    if (!saved) return false;
    setProducts(prev => prev.map(item => item.id === id ? saved : item));
    return true;
  }, []);

  const removeProduct = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.products.remove(id),
      'Erro ao remover produto',
    );
    if (saved === undefined) return false;
    setProducts(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  const sellProduct = useCallback(async (id: string, qty: number): Promise<boolean> => {
    const prod = productsRef.current.find(p => p.id === id);
    if (!prod) return false;
    if (!Number.isInteger(qty) || qty <= 0) return false;
    if (prod.stock < qty) {
      toast.error(`Estoque insuficiente: ${prod.name} tem apenas ${prod.stock} un.`);
      return false;
    }
    const saved = await mutation(
      () => api.products.adjustStock(id, -qty),
      'Erro ao atualizar estoque',
    );
    if (!saved) return false;
    setProducts(prev => prev.map(item => item.id === id ? saved : item));
    if (saved.stock <= saved.minStock) toast.warning(`Estoque baixo: ${saved.name} — ${saved.stock} un restantes`);
    return true;
  }, []);

  const restock = useCallback(async (id: string, qty: number) => {
    if (!Number.isInteger(qty) || qty <= 0) return false;
    const saved = await mutation(
      () => api.products.adjustStock(id, qty),
      'Erro ao repor estoque',
    );
    if (!saved) return false;
    setProducts(prev => prev.map(item => item.id === id ? saved : item));
    return true;
  }, []);

  const recordProductSale = useCallback(async (input: {
    date: string;
    clientId?: string;
    appointmentId?: string;
    paymentMethod: PayMethod;
    items: Array<{
      productId: string;
      quantity: number;
      discountType?: ProductSaleDiscountType;
      discountValue: number;
    }>;
  }) => {
    const saved = await mutation(
      () => api.productSales.create(input as unknown as Record<string, unknown>),
      'Erro ao registrar venda de produtos',
    );
    if (!saved) return null;
    const sale = cast<ProductSale>(saved);
    setProductSales(prev => [...prev, sale].sort((a, b) => b.date.localeCompare(a.date)));
    try {
      const updatedProducts = await api.products.list();
      setProducts(updatedProducts);
    } catch (error) {
      console.warn('Sale was saved, but inventory refresh failed:', error);
      toast.warning('Venda registrada, mas o estoque não foi atualizado na tela. Atualize para conferir.');
    }
    return sale;
  }, []);

  const reverseProductSale = useCallback(async (id: string, reason: string) => {
    const saved = await mutation(
      () => api.productSales.reverse(id, reason),
      'Erro ao estornar a venda de produtos',
    );
    if (!saved) return null;
    const sale = cast<ProductSale>(saved);
    setProductSales(prev => prev.map(item => item.id === sale.id ? sale : item));
    try {
      setProducts(await api.products.list());
    } catch (error) {
      console.warn('Sale was reversed, but inventory refresh failed:', error);
      toast.warning('Estorno registrado, mas o estoque não foi atualizado na tela. Atualize para conferir.');
    }
    return sale;
  }, []);

  // ── Prothesis Sales ──
  const addProthesisSale = useCallback(async (s: Omit<ProthesisSale, 'id'>) => {
    const newS: ProthesisSale = { ...s, id: uid() };
    const saved = await mutation(
      () => api.prothesisSales.create(newS as unknown as Record<string, unknown>),
      'Erro ao salvar venda de prótese',
    );
    if (!saved) return false;
    setProthesisSales(prev => [...prev, cast<ProthesisSale>(saved)]);
    return true;
  }, []);

  const updateProthesisSale = useCallback(async (id: string, s: Partial<ProthesisSale>) => {
    const saved = await mutation(
      () => api.prothesisSales.update(id, s),
      'Erro ao atualizar venda de prótese',
    );
    if (!saved) return false;
    setProthesisSales(prev => prev.map(item => item.id === id ? cast<ProthesisSale>(saved) : item));
    return true;
  }, []);

  const removeProthesisSale = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.prothesisSales.remove(id),
      'Erro ao remover venda de prótese',
    );
    if (saved === undefined) return false;
    setProthesisSales(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Mentoria ──
  const addMentoriaSession = useCallback(async (m: Omit<MentoriaSession, 'id'>) => {
    const newM: MentoriaSession = { ...m, id: uid() };
    const saved = await mutation(
      () => api.mentoriaSessions.create(newM as unknown as Record<string, unknown>),
      'Erro ao salvar mentoria',
    );
    if (!saved) return false;
    setMentoriaSessions(prev => [...prev, cast<MentoriaSession>(saved)]);
    return true;
  }, []);

  const updateMentoriaSession = useCallback(async (id: string, m: Partial<MentoriaSession>) => {
    const saved = await mutation(
      () => api.mentoriaSessions.update(id, m),
      'Erro ao atualizar mentoria',
    );
    if (!saved) return false;
    setMentoriaSessions(prev => prev.map(item => item.id === id ? cast<MentoriaSession>(saved) : item));
    return true;
  }, []);

  const removeMentoriaSession = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.mentoriaSessions.remove(id),
      'Erro ao remover mentoria',
    );
    if (saved === undefined) return false;
    setMentoriaSessions(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Finance ──
  const addExpense = useCallback(async (e: Omit<Expense, 'id'>) => {
    const newE: Expense = { ...e, id: uid() };
    const saved = await mutation(
      () => api.expenses.create(newE as unknown as Record<string, unknown>, {
        returnRepresentation: profile?.role !== 'recepcao',
      }),
      'Erro ao salvar despesa',
    );
    if (!saved) return false;
    setExpenses(prev => [...prev, cast<Expense>(saved)]);
    return true;
  }, [profile?.role]);

  const updateExpense = useCallback(async (id: string, e: Partial<Expense>) => {
    const saved = await mutation(
      () => api.expenses.update(id, e as unknown as Record<string, unknown>),
      'Erro ao atualizar despesa',
    );
    if (!saved) return false;
    setExpenses(prev => prev.map(item => item.id === id ? cast<Expense>(saved) : item));
    await refreshFinanceHistory();
    return true;
  }, [refreshFinanceHistory]);

  const removeExpense = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.expenses.remove(id),
      'Erro ao remover despesa',
    );
    if (saved === undefined) return false;
    setExpenses(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  const addIncome = useCallback(async (i: Omit<Income, 'id'>) => {
    const newI: Income = { ...i, id: uid() };
    const saved = await mutation(
      () => api.incomes.create(newI as unknown as Record<string, unknown>),
      'Erro ao salvar receita',
    );
    if (!saved) return false;
    setIncomes(prev => [...prev, cast<Income>(saved)]);
    return true;
  }, []);

  const updateIncome = useCallback(async (id: string, i: Partial<Income>) => {
    const saved = await mutation(
      () => api.incomes.update(id, i as unknown as Record<string, unknown>),
      'Erro ao atualizar receita',
    );
    if (!saved) return false;
    setIncomes(prev => prev.map(item => item.id === id ? cast<Income>(saved) : item));
    await refreshFinanceHistory();
    return true;
  }, [refreshFinanceHistory]);

  const removeIncome = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.incomes.remove(id),
      'Erro ao remover receita',
    );
    if (saved === undefined) return false;
    setIncomes(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  const addCashClosing = useCallback(async (closing: Omit<CashClosing, 'id' | 'createdAt'>) => {
    const saved = await mutation(
      () => api.cashClosings.create(closing as unknown as Record<string, unknown>),
      'Erro ao fechar caixa',
    );
    if (!saved) return null;
    const confirmed = cast<CashClosing>(saved);
    setCashClosings(prev => [...prev, confirmed].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)));
    return confirmed;
  }, []);

  const removeCashClosing = useCallback(async (id: string) => {
    const deleted = await mutation(
      () => api.history.deleteItem('cash_closing', id),
      'Erro ao excluir fechamento de caixa',
    );
    if (deleted !== true) return false;
    setCashClosings(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Plans ──
  const addPlan = useCallback(async (p: Omit<SubscriptionPlan, 'id'>) => {
    const newP: SubscriptionPlan = { ...p, id: uid() };
    const saved = await mutation(
      () => api.plans.create(newP as unknown as Record<string, unknown>),
      'Erro ao salvar plano',
    );
    if (!saved) return false;
    setPlans(prev => [...prev, cast<SubscriptionPlan>(saved)]);
    return true;
  }, []);

  const updatePlan = useCallback(async (id: string, p: Partial<SubscriptionPlan>) => {
    const saved = await mutation(
      () => api.plans.update(id, p),
      'Erro ao atualizar plano',
    );
    if (!saved) return false;
    setPlans(prev => prev.map(item => item.id === id ? cast<SubscriptionPlan>(saved) : item));
    return true;
  }, []);

  const removePlan = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.plans.remove(id),
      'Erro ao remover plano',
    );
    if (saved === undefined) return false;
    setPlans(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  // ── Subscribers ──
  const addSubscriber = useCallback(async (s: Omit<Subscriber, 'id'>) => {
    const newS: Subscriber = { ...s, id: uid() };
    const saved = await mutation(
      () => api.subscribers.create(newS as unknown as Record<string, unknown>),
      'Erro ao salvar assinante',
    );
    if (!saved) return null;
    const subscriber = cast<Subscriber>(saved);
    setSubscribers(prev => [...prev, subscriber]);
    return subscriber;
  }, []);

  const updateSubscriber = useCallback(async (id: string, s: Partial<Subscriber>) => {
    const saved = await mutation(
      () => api.subscribers.update(id, s),
      'Erro ao atualizar assinante',
    );
    if (!saved) return false;
    setSubscribers(prev => prev.map(item => item.id === id ? cast<Subscriber>(saved) : item));
    return true;
  }, []);

  const removeSubscriber = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.subscribers.remove(id),
      'Erro ao remover assinante',
    );
    if (saved === undefined) return false;
    setSubscribers(prev => prev.filter(item => item.id !== id));
    return true;
  }, []);

  const renewSubscriberPlanUsages = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.subscribers.renewUsages(id),
      'Erro ao renovar usos do plano',
    );
    if (!saved) return false;
    setSubscribers(prev => prev.map(item => item.id === id ? cast<Subscriber>(saved) : item));
    return true;
  }, []);

  const removeSubscriptionPayment = useCallback(async (id: string) => {
    const saved = await mutation(
      () => api.history.deleteItem('subscription_payment', id),
      'Erro ao remover mensalidade',
    );
    if (!saved) return false;
    setSubscriptionPayments(previous => previous.filter(payment => payment.id !== id));
    return true;
  }, []);

  const setSubscriptionPaymentStatus = useCallback(async (input: {
    subscriberId: string;
    dueDate: string;
    status: SubscriptionPaymentStatus;
    paidAt?: string;
    amount: number;
    paymentMethod?: PayMethod;
    note?: string;
  }) => {
    const saved = await mutation(
      () => api.subscriptionPayments.setStatus(input),
      'Erro ao atualizar mensalidade',
    );
    if (!saved) return false;
    const confirmed = saved as {
      payment: SubscriptionPayment;
      subscriber: Subscriber;
      nextPayment?: SubscriptionPayment;
    };
    setSubscriptionPayments(prev => {
      const confirmedPayments = [confirmed.payment, confirmed.nextPayment]
        .filter((item): item is SubscriptionPayment => Boolean(item));
      const paymentKeys = new Set(confirmedPayments.map(subscriptionPaymentKey));
      const withoutConfirmed = prev.filter(item => !paymentKeys.has(subscriptionPaymentKey(item)));
      return [
        ...withoutConfirmed,
        ...confirmedPayments,
      ].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    });
    setSubscribers(prev => prev.map(item => item.id === confirmed.subscriber.id ? confirmed.subscriber : item));
    return true;
  }, []);

  // ── Config ──
  const updateConfig = useCallback(async (c: Partial<BarbeariaConfig>) => {
    const next = { ...config, ...c };
    const saved = await mutation(
      () => api.config.update(next),
      'Erro ao salvar configuração',
    );
    if (!saved) return false;
    setConfig(prev => ({ ...prev, ...saved }));
    return true;
  }, [config]);

  const value: AppStoreValue = {
    isLoading,
    professionals, addProfessional, updateProfessional, removeProfessional, getProfessional,
    appointments, addAppointment, updateAppointment, removeAppointment,
    blocks, addBlock, removeBlock,
    clients, addClient, updateClient, removeClient, addVisit, removeVisit,
    products, addProduct, updateProduct, removeProduct, sellProduct, restock, productSales, recordProductSale, reverseProductSale,
    prothesisSales, addProthesisSale, updateProthesisSale, removeProthesisSale,
    mentoriaSessions, addMentoriaSession, updateMentoriaSession, removeMentoriaSession,
    expenses, addExpense, updateExpense, removeExpense,
    incomes, addIncome, updateIncome, removeIncome,
    financeHistory, refreshFinanceHistory,
    cashClosings, addCashClosing, removeCashClosing,
    plans, addPlan, updatePlan, removePlan,
    subscribers, addSubscriber, updateSubscriber, removeSubscriber, renewSubscriberPlanUsages,
    subscriptionPayments, removeSubscriptionPayment, setSubscriptionPaymentStatus,
    config, updateConfig,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within AppStoreProvider');
  return context;
}

// ─── Backward-compat hooks ────────────────────────────────────────────────────

export function useClients() {
  const store = useStore();
  return {
    clients: store.clients,
    addClient: store.addClient,
    updateClient: store.updateClient,
    removeClient: store.removeClient,
    addVisit: store.addVisit,
    removeVisit: store.removeVisit,
  };
}

export function useProducts() {
  const store = useStore();
  return {
    products: store.products,
    addProduct: store.addProduct,
    updateProduct: store.updateProduct,
    removeProduct: store.removeProduct,
    sellProduct: store.sellProduct,
    restock: store.restock,
  };
}

export function useFinance() {
  const store = useStore();
  return {
    expenses: store.expenses,
    incomes: store.incomes,
    addExpense: store.addExpense,
    removeExpense: store.removeExpense,
    addIncome: store.addIncome,
  };
}

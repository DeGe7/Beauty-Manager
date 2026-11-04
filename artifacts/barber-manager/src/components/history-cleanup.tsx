import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CreditCard, History, LoaderCircle, Mail, Trash2, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/data/api';
import { isWithinAttendanceDeleteWindow } from '@/data/attendance-deletion';
import { useAuth } from '@/auth/auth';
import { useStore } from '@/data/store';

type HistoryModuleId =
  | 'client_visits'
  | 'appointments'
  | 'finance'
  | 'sales'
  | 'communication'
  | 'subscription_payments'
  | 'team_access';

type HistoryCounts = Record<string, number>;
const CLEANUP_CONFIRMATION = 'EXCLUIR';

const MODULES: {
  id: HistoryModuleId;
  title: string;
  description: string;
  counts: string[];
  warning: string;
  icon: typeof History;
}[] = [
  {
    id: 'client_visits',
    title: 'Visitas dos clientes',
    description: 'Apaga as visitas registradas nos cartões, sem excluir o cadastro dos clientes.',
    counts: ['client_visits'],
    warning: 'Os cadastros dos clientes serão mantidos; somente as visitas serão apagadas.',
    icon: Users,
  },
  {
    id: 'appointments',
    title: 'Agenda e atendimentos',
    description: 'Remove agendamentos permitidos pela regra atual, preservando uma cópia restrita do atendimento para recuperação.',
    counts: ['appointments'],
    warning: 'A Recepção e os profissionais mantêm o limite de 24 horas. Gestor/Proprietário e DEV/ADMIN podem excluir atendimentos antigos. O atendimento excluído será arquivado; falhas de estoque ou Google Agenda serão informadas.',
    icon: CalendarDays,
  },
  {
    id: 'finance',
    title: 'Financeiro',
    description: 'Apaga receitas, despesas manuais, fechamentos de caixa e o histórico de alterações financeiras.',
    counts: ['expenses', 'incomes', 'finance_changes', 'cash_closings'],
    warning: 'Os lançamentos e resumos de fechamento deixam de compor os relatórios financeiros. Os atendimentos e vendas ficam preservados.',
    icon: Wallet,
  },
  {
    id: 'sales',
    title: 'Vendas e mentorias',
    description: 'Apaga vendas de prótese e sessões de mentoria.',
    counts: ['prosthesis_sales', 'mentoring_sessions'],
    warning: 'Esses registros deixam de compor os relatórios e comissões.',
    icon: History,
  },
  {
    id: 'communication',
    title: 'Envios de comunicação',
    description: 'Apaga o histórico de tentativas de envio por WhatsApp e e-mail.',
    counts: ['communication_sends'],
    warning: 'O histórico de envios não poderá ser recuperado.',
    icon: Mail,
  },
  {
    id: 'subscription_payments',
    title: 'Mensalidades',
    description: 'Apaga os registros de pagamentos, mantendo assinantes e planos.',
    counts: ['subscription_payments'],
    warning: 'As confirmações e pendências de mensalidades serão removidas; assinantes e planos continuam cadastrados.',
    icon: CreditCard,
  },
  {
    id: 'team_access',
    title: 'Pedidos e convites da equipe',
    description: 'Apaga solicitações, convites e eventos do histórico de acesso.',
    counts: ['join_requests', 'invitations', 'join_request_events'],
    warning: 'Convites pendentes também serão removidos e seus links deixarão de funcionar.',
    icon: Users,
  },
];

function countForModule(moduleId: HistoryModuleId, counts: HistoryCounts) {
  const module = MODULES.find(item => item.id === moduleId);
  return module?.counts.reduce((total, key) => total + (counts[key] || 0), 0) || 0;
}

function isLockedAttendance(
  appointment: ReturnType<typeof useStore>['appointments'][number],
  role: string | null | undefined,
) {
  if (role === 'gestor' || role === 'dev-admin') return false;
  if (appointment.attendanceRecordedAt) return !isWithinAttendanceDeleteWindow(appointment.attendanceRecordedAt);
  if (appointment.status === 'completed') return true;
  if (appointment.status !== 'confirmed') return false;
  const scheduledAt = Date.parse(`${appointment.date}T${appointment.time}:00-03:00`);
  return Number.isFinite(scheduledAt) && scheduledAt <= Date.now();
}

export default function HistoryCleanup() {
  const { appointments, removeAppointment, restock, cashClosings } = useStore();
  const { profile, viewAsProfile } = useAuth();
  const session = viewAsProfile ?? profile;
  const [counts, setCounts] = useState<HistoryCounts>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [selectedModules, setSelectedModules] = useState<HistoryModuleId[]>([]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');

  const lockedAppointments = useMemo(
    () => appointments.filter(appointment => isLockedAttendance(appointment, session?.role)).length,
    [appointments, session?.role],
  );

  const refreshCounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await api.history.counts();
      next.appointments = appointments.length;
      next.appointments_locked = lockedAppointments;
      next.cash_closings = cashClosings.length;
      setCounts(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os históricos.');
    } finally {
      setIsLoading(false);
    }
  }, [appointments.length, lockedAppointments, cashClosings.length]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const selected = MODULES.filter(module => selectedModules.includes(module.id));
  const selectedTotal = selected.reduce((total, module) => total + countForModule(module.id, counts), 0);

  const clearAppointments = async () => {
    let deleted = 0;
    let stockFailures = 0;
    let calendarFailures = 0;
    for (const appointment of appointments) {
      if (isLockedAttendance(appointment, session?.role)) continue;
      if (!await removeAppointment(appointment.id)) continue;
      deleted += 1;
      for (const item of appointment.products ?? []) {
        if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
        if (!await restock(item.productId, item.quantity)) stockFailures += 1;
      }
      try {
        await api.googleCalendar.deleteAppointment(appointment.id);
      } catch {
        calendarFailures += 1;
      }
    }
    if (stockFailures) toast.warning(`Não foi possível restaurar ${stockFailures} item(ns) de estoque.`);
    if (calendarFailures) toast.warning(`${calendarFailures} agendamento(s) podem continuar no Google Agenda.`);
    if (lockedAppointments) toast.warning(`${lockedAppointments} atendimento(s) foram preservados pela regra de 24 horas.`);
    return deleted;
  };

  const confirmClear = async () => {
    if (
      !selectedModules.length
      || isClearing
      || confirmationText.trim().toLocaleUpperCase('pt-BR') !== CLEANUP_CONFIRMATION
    ) return;
    setIsClearing(true);
    setIsConfirmOpen(false);
    let totalDeleted = 0;
    let databaseChanged = false;
    try {
      for (const module of selected) {
        if (module.id === 'appointments') {
          totalDeleted += await clearAppointments();
        } else {
          const deleted = await api.history.clear(module.id);
          totalDeleted += deleted;
          databaseChanged ||= deleted > 0;
        }
      }
      toast.success(`${totalDeleted} registro(s) removido(s).`);
      setSelectedModules([]);
      setConfirmationText('');
      if (databaseChanged) {
        window.setTimeout(() => window.location.reload(), 500);
        return;
      }
      await refreshCounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'A limpeza foi interrompida.');
      await refreshCounts();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <section className="scroll-mt-24 space-y-5 rounded-2xl border border-brand-border bg-brand-surface p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-3 border-b border-brand-border/50 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-brand-gold" />
          <div>
            <h3 className="font-bold text-foreground">Histórico e limpeza</h3>
            <p className="mt-1 text-sm text-muted-foreground">Escolha os módulos antes de cada limpeza. Os cadastros principais são preservados.</p>
          </div>
        </div>
        <button type="button" onClick={() => void refreshCounts()} disabled={isLoading || isClearing} className="min-h-10 rounded-lg border border-brand-border px-3 py-2 text-xs font-semibold text-foreground hover:border-brand-gold disabled:opacity-50">
          {isLoading ? 'Atualizando…' : 'Atualizar contagens'}
        </button>
      </div>

      <div className="grid gap-3">
        {MODULES.map(module => {
          const Icon = module.icon;
          const isSelected = selectedModules.includes(module.id);
          const count = countForModule(module.id, counts);
          return (
            <label key={module.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${isSelected ? 'border-brand-gold/50 bg-brand-gold/5' : 'border-brand-border bg-brand-bg hover:border-brand-gold/30'}`}>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isLoading || isClearing}
                onChange={event => setSelectedModules(current => event.target.checked
                  ? [...current, module.id]
                  : current.filter(id => id !== module.id))}
                className="mt-1 h-4 w-4 accent-brand-gold"
              />
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-gold" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{module.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {isLoading ? '…' : `${count} ${count === 1 ? 'registro' : 'registros'}`}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{module.description}</span>
                {module.id === 'appointments' && lockedAppointments > 0 && (
                  <span className="mt-2 block text-xs text-warning">{lockedAppointments} atendimento(s) estão protegidos pela regra de 24 horas.</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t border-brand-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">A exclusão individual continua disponível nas telas de cada módulo.</p>
        <button
          type="button"
          onClick={() => {
            setConfirmationText('');
            setIsConfirmOpen(true);
          }}
          disabled={!selectedModules.length || isLoading || isClearing || selectedTotal === 0}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isClearing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Limpar módulos selecionados
        </button>
      </div>

      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && !isClearing) {
            setIsConfirmOpen(false);
            setConfirmationText('');
          }
        }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="history-cleanup-title" className="w-full max-w-lg space-y-4 rounded-2xl border border-brand-border bg-brand-surface p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <h4 id="history-cleanup-title" className="font-bold text-foreground">Confirmar limpeza</h4>
                <p className="mt-1 text-sm text-muted-foreground">Serão removidos até {selectedTotal} registros destes módulos:</p>
              </div>
            </div>
            <ul className="space-y-3">
              {selected.map(module => (
                <li key={module.id} className="rounded-lg border border-brand-border bg-brand-bg p-3">
                  <p className="text-sm font-semibold text-foreground">{module.title} · {countForModule(module.id, counts)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{module.warning}</p>
                </li>
              ))}
            </ul>
            <div className="space-y-2">
              <label htmlFor="history-cleanup-confirmation" className="block text-sm font-semibold text-foreground">
                Digite <span className="font-mono text-destructive">{CLEANUP_CONFIRMATION}</span> para confirmar
              </label>
              <input
                id="history-cleanup-confirmation"
                value={confirmationText}
                onChange={event => setConfirmationText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-foreground outline-none focus:border-destructive"
                placeholder={CLEANUP_CONFIRMATION}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Outros históricos selecionados podem ser permanentes. Os atendimentos apagados serão guardados em um arquivo restrito.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfirmOpen(false);
                  setConfirmationText('');
                }}
                className="min-h-10 rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-gold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmClear()}
                disabled={isClearing || confirmationText.trim().toLocaleUpperCase('pt-BR') !== CLEANUP_CONFIRMATION}
                className="min-h-10 rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-white hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearing ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

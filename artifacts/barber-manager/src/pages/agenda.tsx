import { useState } from 'react';
import { useStore, brl, ApptStatus } from '@/data/store';
import { useAuth } from '@/auth/auth';
import { FeatureInfo } from '@/components/FeatureInfo';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/data/api';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Trash2, Plus, Clock, MessageSquare, AlertCircle, LogIn, CheckCircle2, UserX
} from 'lucide-react';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, 
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, 
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatDateKey } from '@/data/date';
import { canDeleteAttendance } from '@/data/attendance-deletion';
import { isAssignableProfessional } from '@/data/professional-selection';

// Helper for dates
const dToStr = (d: Date) => formatDateKey(d);
const parseD = (s: string) => new Date(s + 'T12:00:00');

export default function Agenda() {
  const { appointments, blocks, professionals, products, config, addAppointment, updateAppointment, removeAppointment, restock, addBlock, removeBlock, isLoading } = useStore();
  const { profile, viewAsProfile } = useAuth();
  const session = viewAsProfile ?? profile;
  const isReceptionist = session?.role === 'recepcao';
  const ownProfile = Boolean(
    session?.professionalId
    && session.role !== 'gestor'
    && session.role !== 'dev-admin'
    && session.role !== 'recepcao',
  );
  const ownProfessionalId = ownProfile ? session?.professionalId : undefined;

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(dToStr(new Date()));
  const [filterProf, setFilterProf] = useState(ownProfessionalId || '');
  const [mobileFilter, setMobileFilter] = useState<'all' | 'active' | 'waiting' | 'done'>('all');
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);

  // Month navigation
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startOffset = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();
  
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const goToday = () => { setCurrentDate(new Date()); setSelectedDate(dToStr(new Date())); };

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), i + 1);
    return dToStr(d);
  });

  const activeProfs = professionals.filter(p => p.isActive && isAssignableProfessional(p));

  // Time slots
  const slots = [];
  for (let h = 9; h <= 18; h++) {
    slots.push(`${h.toString().padStart(2, '0')}:00`);
    if (h < 18 || (h === 18 && false)) slots.push(`${h.toString().padStart(2, '0')}:30`);
  }

  // Selected day data
  const effectiveFilterProf = ownProfessionalId || filterProf;
  const dayAppointments = appointments.filter(a => a.date === selectedDate && (!effectiveFilterProf || a.professionalId === effectiveFilterProf));
  const dayBlocks = blocks.filter(b => b.date === selectedDate && (!effectiveFilterProf || b.professionalId === effectiveFilterProf));

  const getSlotStatus = (time: string) => {
    const appts = dayAppointments.filter(a => a.time === time);
    const blks = dayBlocks.filter(b => b.slots.length === 0 || b.slots.includes(time));
    return { appts, blocks: blks };
  };

  // Forms
  const [isApptOpen, setIsApptOpen] = useState(false);
  const [apptForm, setApptForm] = useState({ time: '09:00', client: '', phone: '', profId: '', service: 'Barbearia', status: 'pending' as ApptStatus, value: 0 });
  
  // Interval overlap helper — true if [s1, s1+d1) overlaps [s2, s2+d2)
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const overlaps = (t1: string, d1: number, t2: string, d2: number) => {
    const s1 = toMin(t1), e1 = s1 + d1, s2 = toMin(t2), e2 = s2 + d2;
    return s1 < e2 && s2 < e1;
  };
  const svcDur = (svc: string) => config.services.find(s => s.name === svc)?.duration ?? config.defaultServiceDuration;
  const checkConflicts = (date: string, time: string, profId: string, service: string, excludeId?: string) => {
    const dur = svcDur(service);
    const profName = professionals.find(p => p.id === profId)?.name || 'Profissional';
    // Appointment interval overlap (exclude self when editing)
    const apptConflict = appointments.find(a =>
      a.id !== excludeId && a.date === date && a.professionalId === profId && a.status !== 'cancelled' &&
      overlaps(time, dur, a.time, a.duration || 30)
    );
    if (apptConflict) return `${profName} já tem agendamento às ${apptConflict.time}.`;
    // Block overlap (full-day or slot-based, each slot treated as 30 min)
    const blockConflict = blocks.find(b =>
      b.date === date && b.professionalId === profId && (
        b.slots.length === 0 ||
        b.slots.some(s => overlaps(time, dur, s, 30))
      )
    );
    if (blockConflict) return `${profName} está bloqueado neste horário (${blockConflict.reason}).`;
    return null;
  };

  const handleAddAppt = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedProfId = ownProfessionalId || apptForm.profId;
    const serviceItem = config.services.find(s => s.name === apptForm.service && s.isActive);
    if (!apptForm.client || !resolvedProfId || !serviceItem) { toast.error('Preencha os campos obrigatórios'); return; }
    const conflict = checkConflicts(selectedDate, apptForm.time, resolvedProfId, apptForm.service);
    if (conflict) { toast.error(conflict); return; }

    const createdAppointment = await addAppointment({
      date: selectedDate,
      time: apptForm.time,
      client: apptForm.client,
      clientPhone: apptForm.phone,
      professionalId: resolvedProfId,
      service: apptForm.service,
      status: apptForm.status,
      duration: serviceItem.duration,
      value: apptForm.value,
      tip: 0,
      products: [],
      payMethod: 'pix',
    });
    if (!createdAppointment) return;
    void api.googleCalendar.syncAppointment(createdAppointment.id).catch((error: unknown) => {
      toast.warning('Agendamento salvo, mas não sincronizado com o Google Agenda.', {
        description: error instanceof Error ? error.message : 'Tente sincronizar novamente pela agenda.',
      });
    });
    toast.success('Agendamento criado');
    setIsApptOpen(false);
  };

  // Edit appointment
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editAppt, setEditAppt] = useState<typeof appointments[0] | null>(null);
  const [editForm, setEditForm] = useState({ client: '', phone: '', profId: '', service: 'Barbearia', time: '09:00', value: 0 });

  const openEdit = (a: typeof appointments[0]) => {
    setEditAppt(a);
    setEditForm({ client: a.client, phone: a.clientPhone || '', profId: a.professionalId, service: a.service, time: a.time, value: a.value });
    setIsEditOpen(true);
  };

  const handleEditAppt = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedEditProfId = ownProfessionalId || editForm.profId;
    if (!editAppt || !editForm.client || !resolvedEditProfId) { toast.error('Preencha os campos obrigatórios'); return; }
    const conflict = checkConflicts(editAppt.date, editForm.time, resolvedEditProfId, editForm.service, editAppt.id);
    if (conflict) { toast.error(conflict); return; }
    if (!await updateAppointment(editAppt.id, {
      client: editForm.client, clientPhone: editForm.phone, professionalId: resolvedEditProfId,
      service: editForm.service, time: editForm.time,
      value: editForm.value,
      duration: svcDur(editForm.service),
    })) return;
    void api.googleCalendar.syncAppointment(editAppt.id).catch((error: unknown) => {
      toast.warning('Agendamento atualizado, mas não sincronizado com o Google Agenda.', {
        description: error instanceof Error ? error.message : 'Tente sincronizar novamente pela agenda.',
      });
    });
    toast.success('Agendamento atualizado');
    setIsEditOpen(false);
  };

  const [isBlockOpen, setIsBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState({ profId: '', reason: 'Folga', fullDay: true, slots: [] as string[], notes: '' });

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedBlockProfId = ownProfessionalId || blockForm.profId;
    if (!resolvedBlockProfId) { toast.error('Selecione o profissional'); return; }
    if (!await addBlock({
      date: selectedDate,
      professionalId: resolvedBlockProfId,
      reason: blockForm.reason,
      slots: blockForm.fullDay ? [] : blockForm.slots,
      notes: blockForm.notes
    })) return;
    toast.success('Horário bloqueado');
    setIsBlockOpen(false);
  };

  const sendWhatsApp = (phone: string | undefined, a: typeof appointments[0]) => {
    if (!phone) { toast.error('Sem número de WhatsApp'); return; }
    const pName = professionals.find(p => p.id === a.professionalId)?.name || 'Profissional removido';
    const msg = `Olá ${a.client}! Passando para confirmar seu horário:\n\nData: ${a.date.split('-').reverse().join('/')}\nHorário: ${a.time}\nServiço: ${a.service}\nProfissional: ${pName}\n\nPor favor, confirme respondendo SIM ou REMARCAR. Obrigado!`;
    window.open(`https://wa.me/55${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const nowTime = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const checkIn = async (a: typeof appointments[0]) => {
    if (a.status !== 'pending' && a.status !== 'confirmed') return;
    if (await updateAppointment(a.id, { status: 'checked_in', checkedInAt: nowTime() })) {
      toast.success(`${a.client} está em atendimento`);
    }
  };
  const finishAppointment = async (a: typeof appointments[0]) => {
    if (a.status !== 'checked_in') return;
    if (await updateAppointment(a.id, { status: 'completed', completedAt: nowTime() })) {
      toast.success(`Atendimento de ${a.client} finalizado`);
    }
  };
  const markNoShow = async (a: typeof appointments[0]) => {
    if (a.status !== 'pending' && a.status !== 'confirmed') return;
    if (await updateAppointment(a.id, { status: 'no_show' })) {
      toast.success(`${a.client} marcado como falta`);
    }
  };

  const handleDeleteAppointment = async (appointment: typeof appointments[0]) => {
    if (!canDeleteAttendance(appointment.attendanceRecordedAt, session?.role)) {
      toast.error('O prazo de 24 horas para excluir este atendimento terminou.');
      return;
    }
    if (!await removeAppointment(appointment.id)) return;

    const failedRestocks = new Set<string>();
    for (const item of appointment.products ?? []) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
      if (!await restock(item.productId, item.quantity)) {
        failedRestocks.add(products.find(product => product.id === item.productId)?.name ?? 'produto não identificado');
      }
    }

    toast.success('Atendimento excluído.');
    if (failedRestocks.size > 0) {
      toast.warning(`Não foi possível restaurar o estoque de: ${[...failedRestocks].join(', ')}. Confira os produtos usados neste atendimento.`);
    }

    try {
      await api.googleCalendar.deleteAppointment(appointment.id);
    } catch (error) {
      toast.warning('Agendamento excluído do Beauty Manager, mas pode continuar no Google Agenda.', {
        description: error instanceof Error ? error.message : 'Não foi possível remover o evento do Google Agenda.',
      });
    }
  };

  const deleteAppointmentAction = (appointment: typeof appointments[0], mobile = false) => {
    const canDelete = canDeleteAttendance(appointment.attendanceRecordedAt, session?.role);
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            aria-label={canDelete
              ? `Excluir agendamento de ${appointment.client}`
              : `Excluir atendimento de ${appointment.client} (prazo de 24 horas encerrado)`}
            title={canDelete ? undefined : 'Atendimento só pode ser excluído nas primeiras 24 horas após o lançamento.'}
            disabled={!canDelete}
            className={mobile
              ? 'inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-destructive/30 p-2 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
              : 'ml-auto flex items-center gap-1 text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50'}
          >
            <Trash2 className={mobile ? 'h-4 w-4' : 'h-3 w-3'} />
            {!mobile && 'Excluir'}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O atendimento de {appointment.client} será removido. Produtos consumidos voltarão ao estoque e o evento correspondente será removido do Google Agenda quando possível. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-brand-bg text-foreground border-brand-border hover:bg-brand-border">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteAppointment(appointment)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  const syncCurrentMonthToGoogle = async () => {
    const monthStart = dToStr(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    const monthEnd = dToStr(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
    const ids = appointments
      .filter(a =>
        a.date >= monthStart &&
        a.date <= monthEnd &&
        a.status !== 'cancelled' &&
        (!effectiveFilterProf || a.professionalId === effectiveFilterProf)
      )
      .map(a => a.id);

    if (ids.length === 0) {
      toast.info('Não há agendamentos neste mês para sincronizar.');
      return;
    }

    setIsSyncingGoogle(true);
    let syncedCount = 0;
    const failures: Array<{ appointmentId: string; error: string }> = [];
    try {
      for (let index = 0; index < ids.length; index += 100) {
        const result = await api.googleCalendar.syncAppointments(ids.slice(index, index + 100));
        syncedCount += result.syncedCount;
        failures.push(...result.failed);
      }
      if (failures.length > 0) {
        toast.warning(`${syncedCount} agendamentos sincronizados; ${failures.length} não foram sincronizados.`, {
          description: failures[0]?.error,
        });
      } else {
        toast.success(`${syncedCount} agendamentos sincronizados com o Google Agenda.`);
      }
    } catch (error) {
      toast.error('Não foi possível sincronizar com o Google Agenda.', {
        description: error instanceof Error ? error.message : 'Tente novamente em instantes.',
      });
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  const mobileAppointments = [...dayAppointments]
    .filter((a) => {
      if (mobileFilter === 'active') return a.status === 'checked_in';
      if (mobileFilter === 'waiting') return a.status === 'pending' || a.status === 'confirmed';
      if (mobileFilter === 'done') return a.status === 'completed' || a.status === 'no_show' || a.status === 'cancelled';
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  const mobileStatus = (status: ApptStatus) => ({
    pending: { label: 'Pendente', className: 'bg-warning/10 text-warning' },
    confirmed: { label: 'Confirmado', className: 'bg-brand-gold/10 text-brand-gold' },
    checked_in: { label: 'Em atendimento', className: 'bg-warning/10 text-warning' },
    completed: { label: 'Concluído', className: 'bg-success/10 text-success' },
    no_show: { label: 'Faltou', className: 'bg-destructive/10 text-destructive' },
    cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
  }[status]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-7xl flex-col space-y-4 p-4 sm:space-y-5 sm:p-5 md:h-[calc(100vh-6rem)] md:space-y-6 md:p-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground md:text-2xl">Agenda</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Veja os horários do dia e acompanhe o andamento dos atendimentos.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
           <button
             type="button"
             data-testid="button-sync-google-calendar"
             onClick={() => void syncCurrentMonthToGoogle()}
             disabled={isSyncingGoogle || isLoading}
               className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-brand-border disabled:opacity-60 sm:w-auto sm:px-4"
           >
             <CalendarIcon className="w-4 h-4 text-brand-gold" />
             {isSyncingGoogle ? 'Sincronizando...' : 'Sincronizar mês'}
           </button>
             <select disabled={ownProfile} value={effectiveFilterProf} onChange={e => setFilterProf(e.target.value)} className="col-span-2 min-h-11 w-full min-w-0 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm text-foreground focus:ring-1 focus:ring-brand-gold outline-none disabled:opacity-60 sm:col-span-1 sm:w-auto">
            <option value="">Todos Profissionais</option>
            {activeProfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          
          <Dialog open={isBlockOpen} onOpenChange={setIsBlockOpen}>
            <DialogTrigger asChild>
               <button className="min-h-11 w-full bg-brand-surface border border-brand-border text-foreground px-3 py-2 rounded-lg text-sm font-medium hover:bg-brand-border transition-colors sm:w-auto sm:px-4">
                Bloquear Horário
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] overflow-y-auto bg-brand-surface border-brand-border text-foreground sm:max-w-lg">
              <DialogHeader><DialogTitle>Bloquear Horário ({selectedDate.split('-').reverse().join('/')})</DialogTitle></DialogHeader>
              <form onSubmit={handleAddBlock} className="space-y-4 pt-4 [&_input:not([type=checkbox])]:min-h-11 [&_select]:min-h-11">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Profissional</label>
                  <select required disabled={ownProfile} value={ownProfessionalId || blockForm.profId} onChange={e => setBlockForm(f => ({ ...f, profId: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none disabled:opacity-60">
                    <option value="">Selecione...</option>
                    {activeProfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Motivo</label>
                  <select value={blockForm.reason} onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none">
                    <option>Folga</option><option>Almoço</option><option>Atestado</option><option>Outro</option>
                  </select>
                </div>
                <div className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" id="fd" checked={blockForm.fullDay} onChange={e => setBlockForm(f => ({ ...f, fullDay: e.target.checked }))} className="h-5 w-5 accent-brand-gold" />
                  <label htmlFor="fd" className="text-sm">Dia Inteiro</label>
                </div>
                {!blockForm.fullDay && (
                  <div>
                      <div className="flex items-center gap-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase">Horários</label>
                        <FeatureInfo label="Selecionar horários">Use Ctrl no Windows ou Command no Mac para selecionar mais de um horário.</FeatureInfo>
                      </div>
                    <div className="mt-2 grid max-h-48 grid-cols-3 gap-2 overflow-y-auto md:hidden">
                      {slots.map(slot => {
                        const selected = blockForm.slots.includes(slot);
                        return (
                          <button
                            key={slot}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setBlockForm(form => ({
                              ...form,
                              slots: selected
                                ? form.slots.filter(item => item !== slot)
                                : [...form.slots, slot],
                            }))}
                            className={`min-h-11 rounded-lg border text-sm font-medium transition-colors ${
                              selected
                                ? 'border-brand-gold bg-brand-gold/15 text-brand-gold'
                                : 'border-brand-border bg-brand-bg text-foreground'
                            }`}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-1 hidden md:block">
                      <select multiple value={blockForm.slots} onChange={e => setBlockForm(f => ({ ...f, slots: Array.from(e.target.selectedOptions, o => o.value) }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm outline-none h-32">
                        {slots.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <button type="submit" className="min-h-12 w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg hover:bg-brand-gold/90 transition-all">Salvar Bloqueio</button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isApptOpen} onOpenChange={setIsApptOpen}>
            <DialogTrigger asChild>
            <button className="min-h-11 w-full justify-center bg-brand-gold text-brand-bg px-3 py-2 rounded-lg text-sm font-bold hover:bg-brand-gold/90 flex items-center gap-2 transition-all sm:w-auto sm:px-4">
                <Plus className="w-4 h-4" /> Novo Agendamento
              </button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] overflow-y-auto bg-brand-surface border-brand-border text-foreground sm:max-w-lg">
              <DialogHeader><DialogTitle>Agendar - {selectedDate.split('-').reverse().join('/')}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddAppt} className="space-y-4 pt-4 [&_input]:min-h-11 [&_select]:min-h-11">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Horário</label>
                    <select value={apptForm.time} onChange={e => setApptForm(f => ({ ...f, time: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none">
                      {slots.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Profissional</label>
                  <select required disabled={ownProfile} value={ownProfessionalId || apptForm.profId} onChange={e => setApptForm(f => ({ ...f, profId: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none disabled:opacity-60">
                      <option value="">Selecione...</option>
                      {activeProfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Cliente</label>
                  <input type="text" required value={apptForm.client} onChange={e => setApptForm(f => ({ ...f, client: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">WhatsApp</label>
                  <input type="text" value={apptForm.phone} onChange={e => setApptForm(f => ({ ...f, phone: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none" placeholder="11999999999" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Serviço</label>
                    <select value={apptForm.service} onChange={e => setApptForm(f => ({ ...f, service: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none">
                      {config.services.filter(s => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(s => <option key={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Valor do Serviço</label>
                    <input type="number" min="0" step="0.01" value={apptForm.value} onChange={e => setApptForm(f => ({ ...f, value: Number(e.target.value) || 0 }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm text-brand-gold font-bold outline-none" placeholder="Digite o valor" />
                  </div>
                </div>
                <button type="submit" className="min-h-12 w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg hover:bg-brand-gold/90 transition-all">Confirmar Agendamento</button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <section className="md:hidden space-y-4">
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda operacional</p>
              <h3 className="mt-1 text-lg font-bold capitalize">
                {parseD(selectedDate).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h3>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setCurrentDate(parseD(event.target.value));
              }}
              aria-label="Selecionar data da agenda"
              className="w-[132px] rounded-lg border border-brand-border bg-brand-bg px-2 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-brand-gold"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ['all', 'Todos'],
              ['active', 'Em atendimento'],
              ['waiting', 'Aguardando'],
              ['done', 'Finalizados'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMobileFilter(value as typeof mobileFilter)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  mobileFilter === value
                    ? 'border-brand-gold bg-brand-gold text-brand-bg'
                    : 'border-brand-border bg-brand-bg text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}</div>
        ) : mobileAppointments.length === 0 ? (
          <div className="rounded-2xl border border-brand-border bg-brand-surface px-5 py-12 text-center text-muted-foreground">
            <CalendarIcon className="mx-auto mb-3 h-10 w-10 opacity-35" />
            <p className="font-medium text-foreground">Nenhum atendimento neste filtro</p>
            <p className="mt-1 text-sm">Use “Novo Agendamento” para adicionar um horário.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {mobileAppointments.map((a) => {
              const status = mobileStatus(a.status);
              const canCheckIn = a.status === 'pending' || a.status === 'confirmed';
              const isActive = a.status === 'checked_in';
              return (
                <article key={a.id} className={`rounded-2xl border bg-brand-surface p-4 ${isActive ? 'border-warning/60 shadow-[0_0_0_1px_hsl(var(--warning)/0.15)]' : 'border-brand-border'} ${a.status === 'completed' || a.status === 'no_show' || a.status === 'cancelled' ? 'opacity-70' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-12 shrink-0 text-center">
                      <p className="font-mono text-sm font-bold">{a.time}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{a.duration} min</p>
                    </div>
                    <div className="min-w-0 flex-1 border-l border-brand-border pl-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-foreground">{a.client}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.service} · {professionals.find((p) => p.id === a.professionalId)?.name || 'Profissional removido'}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${status.className}`}>{status.label}</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-brand-border/60 pt-3">
                        {!isReceptionist && <span className="text-sm font-bold text-brand-gold">{brl(a.value + (a.tip || 0))}</span>}
                        <div className="ml-auto flex items-center gap-2">
                          {canCheckIn && (
                            <div className="flex gap-2">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button type="button" aria-label={`Marcar falta de ${a.client}`} className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                                    <UserX className="h-4 w-4" />
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="border-brand-border bg-brand-surface text-foreground">
                                  <AlertDialogHeader><AlertDialogTitle>Marcar como falta?</AlertDialogTitle><AlertDialogDescription>{a.client} não compareceu ao atendimento das {a.time}.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel className="border-brand-border bg-brand-bg text-foreground">Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => markNoShow(a)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Marcar falta</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <button type="button" onClick={() => checkIn(a)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-3 py-2 text-xs font-bold text-brand-bg">
                                <LogIn className="h-4 w-4" /> Check-in
                              </button>
                            </div>
                          )}
                          {isActive && (
                            <button type="button" onClick={() => finishAppointment(a)} className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-bold text-success-foreground">
                              <CheckCircle2 className="h-4 w-4" /> Finalizar
                            </button>
                          )}
                          {a.status === 'completed' && <span className="text-xs font-medium text-success">Concluído às {a.completedAt || '--:--'}</span>}
                          {a.status === 'checked_in' && <span className="text-xs text-warning">Desde {a.checkedInAt || '--:--'}</span>}
                          {deleteAppointmentAction(a, true)}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="hidden md:flex flex-1 flex-col lg:flex-row gap-6 min-h-0">
        {/* Calendar Left */}
        <div className="lg:w-2/3 bg-brand-surface border border-brand-border rounded-2xl p-6 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <button onClick={prevMonth} className="p-2 hover:bg-brand-bg rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
            <h3 className="text-lg font-bold capitalize">
              {currentDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
            </h3>
            <div className="flex items-center gap-2">
              <button onClick={goToday} className="text-sm font-medium hover:text-brand-gold px-2">Hoje</button>
              <button onClick={nextMonth} className="p-2 hover:bg-brand-bg rounded-lg"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => (
              <div key={d} className="text-xs font-semibold text-muted-foreground uppercase py-2">{d}</div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-1 flex-1">
            {Array.from({ length: startOffset }).map((_, i) => <div key={`empty-${i}`} className="p-2" />)}
            {days.map(d => {
              const apptsCount = appointments.filter(a => a.date === d && (!filterProf || a.professionalId === filterProf)).length;
              const blksCount = blocks.filter(b => b.date === d && (!filterProf || b.professionalId === filterProf)).length;
              const isSelected = selectedDate === d;
              const isToday = d === dToStr(new Date());

              return (
                <button 
                  key={d}
                  type="button"
                  aria-label={`Selecionar dia ${parseInt(d.split('-')[2])}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedDate(d)}
                  className={`border border-brand-border/50 rounded-xl p-1 md:p-2 cursor-pointer transition-all hover:bg-brand-bg text-left w-full ${isSelected ? 'ring-2 ring-brand-gold border-brand-gold bg-brand-gold/5' : ''}`}
                >
                  <div className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-brand-gold text-brand-bg' : ''}`}>
                    {parseInt(d.split('-')[2])}
                  </div>
                  <div className="mt-1 md:mt-2 flex flex-col gap-1 px-1">
                    {apptsCount > 0 && <div className="text-[10px] bg-brand-gold/20 text-brand-gold rounded px-1 truncate">{apptsCount} agend.</div>}
                    {blksCount > 0 && <div className="text-[10px] bg-destructive/20 text-destructive rounded px-1 truncate">{blksCount} bloq.</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Day Details Right */}
        <div className="lg:w-1/3 bg-brand-surface border border-brand-border rounded-2xl p-6 flex flex-col h-full overflow-hidden">
          <div className="mb-4 pb-4 border-b border-brand-border">
            <h3 className="text-lg font-bold text-foreground">
              {parseD(selectedDate).toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </h3>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {dayBlocks.filter(b => b.slots.length === 0).length > 0 && (
                <div className="mb-4 space-y-2">
                  <h4 className="text-xs font-bold text-destructive uppercase">Dia Todo Bloqueado</h4>
                  {dayBlocks.filter(b => b.slots.length === 0).map(b => (
                    <div key={b.id} className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex justify-between items-center text-sm">
                      <div>
                        <span className="font-semibold">{professionals.find(p => p.id === b.professionalId)?.name || 'Profissional removido'}</span> - {b.reason}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><button aria-label="Remover bloqueio de dia inteiro" className="text-destructive hover:bg-destructive/20 p-1 rounded transition-all hover:scale-105"><Trash2 className="w-4 h-4"/></button></AlertDialogTrigger>
                        <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
                          <AlertDialogHeader><AlertDialogTitle>Remover bloqueio?</AlertDialogTitle><AlertDialogDescription>Deseja remover este bloqueio?</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel className="bg-brand-bg text-foreground border-brand-border hover:bg-brand-border">Cancelar</AlertDialogCancel><AlertDialogAction onClick={async () => {if (await removeBlock(b.id)) toast.success('Removido');}} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              )}

              {slots.map(s => {
                const { appts, blocks: slotBlocks } = getSlotStatus(s);
                return (
                  <div key={s} className="flex gap-3">
                    <div className="text-sm font-mono text-muted-foreground w-12 pt-1">{s}</div>
                    <div className="flex-1 flex flex-col gap-2">
                      {appts.length === 0 && slotBlocks.length === 0 && (
                        <button type="button" aria-label={`Agendar horário ${s}`} onClick={() => { setApptForm(f => ({ ...f, time: s })); setIsApptOpen(true); }} className="h-8 w-full border border-dashed border-brand-border rounded-lg flex items-center justify-between px-3 text-muted-foreground hover:border-brand-gold hover:text-brand-gold cursor-pointer group transition-colors">
                          <span className="text-xs">Disponível</span>
                          <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                        </button>
                      )}
                      
                      {slotBlocks.map(b => (
                        <div key={b.id} className="p-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm flex justify-between items-center">
                          <span className="text-destructive/80 text-xs font-medium">Bloqueado: {professionals.find(p => p.id === b.professionalId)?.initials || 'Profissional removido'} - {b.reason}</span>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><button aria-label="Remover bloqueio de horário" className="text-destructive hover:bg-destructive/20 p-1 rounded transition-all hover:scale-105"><Trash2 className="w-3 h-3"/></button></AlertDialogTrigger>
                            <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
                              <AlertDialogHeader><AlertDialogTitle>Remover bloqueio?</AlertDialogTitle><AlertDialogDescription>Deseja remover este bloqueio?</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel className="bg-brand-bg text-foreground border-brand-border hover:bg-brand-border">Cancelar</AlertDialogCancel><AlertDialogAction onClick={async () => {if (await removeBlock(b.id)) toast.success('Removido');}} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ))}

                      {appts.map(a => (
                        <div key={a.id} className={`p-3 rounded-lg border ${
                          a.status === 'completed' ? 'bg-success/5 border-success/20' :
                          a.status === 'checked_in' ? 'bg-warning/5 border-warning/30' :
                          a.status === 'confirmed' ? 'bg-brand-gold/5 border-brand-gold/20' :
                          a.status === 'pending' ? 'bg-warning/5 border-warning/20' : 
                          a.status === 'no_show' ? 'bg-destructive/5 border-destructive/20' : 
                          'bg-muted/10 border-brand-border'
                        }`}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="text-sm font-bold text-foreground">{a.client}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{professionals.find(p => p.id === a.professionalId)?.name || 'Profissional removido'} • {a.service}</p>
                            </div>
                            <select 
                              value={a.status} 
                               onChange={async (e) => {
                                const ns = e.target.value as ApptStatus;
                                 if (await updateAppointment(a.id, {
                                  status: ns,
                                  ...(ns === 'checked_in' && !a.checkedInAt ? { checkedInAt: nowTime() } : {}),
                                  ...(ns === 'completed' && !a.completedAt ? { completedAt: nowTime() } : {}),
                                  })) {
                                    if (ns === 'cancelled' || a.status === 'cancelled') {
                                      void api.googleCalendar.syncAppointment(a.id).catch((error: unknown) => {
                                        toast.warning('Status salvo, mas não sincronizado com o Google Agenda.', {
                                          description: error instanceof Error ? error.message : 'Tente sincronizar novamente pela agenda.',
                                        });
                                      });
                                    }
                                    toast.success('Status atualizado');
                                  }
                              }}
                              className="text-xs bg-transparent border border-brand-border rounded px-1 py-0.5 outline-none cursor-pointer"
                            >
                              <option value="pending">Pendente</option>
                              <option value="confirmed">Confirmado</option>
                              <option value="checked_in">Em atendimento</option>
                              <option value="completed">Concluído</option>
                              <option value="no_show">Faltou</option>
                              <option value="cancelled">Cancelado</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2 pt-2 border-t border-brand-border/50">
                            {a.clientPhone && (
                              <button aria-label={`Enviar WhatsApp para ${a.client}`} onClick={() => sendWhatsApp(a.clientPhone, a)} className="text-xs text-success flex items-center gap-1 hover:underline">
                                <MessageSquare className="w-3 h-3" /> WhatsApp
                              </button>
                            )}
                            <button aria-label={`Editar agendamento de ${a.client}`} onClick={() => openEdit(a)} className="text-xs text-brand-gold flex items-center gap-1 hover:underline">
                              Editar
                            </button>
                            {deleteAppointmentAction(a)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Edit Appointment Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="bg-brand-surface border-brand-border text-foreground">
          <DialogHeader><DialogTitle>Editar Agendamento</DialogTitle></DialogHeader>
          <form onSubmit={handleEditAppt} className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Horário</label>
                <select value={editForm.time} onChange={e => setEditForm(f => ({ ...f, time: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none">
                  {slots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Profissional</label>
                <select required disabled={ownProfile} value={ownProfessionalId || editForm.profId} onChange={e => setEditForm(f => ({ ...f, profId: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none disabled:opacity-60">
                  <option value="">Selecione...</option>
                  {activeProfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Cliente</label>
              <input type="text" required value={editForm.client} onChange={e => setEditForm(f => ({ ...f, client: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">WhatsApp</label>
              <input type="text" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none" placeholder="11999999999" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Serviço</label>
                    <select value={editForm.service} onChange={e => setEditForm(f => ({ ...f, service: e.target.value }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none">
                      {config.services.filter(s => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(s => <option key={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Valor do Serviço</label>
                    <input type="number" min="0" step="0.01" value={editForm.value} onChange={e => setEditForm(f => ({ ...f, value: Number(e.target.value) || 0 }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm text-brand-gold font-bold outline-none" placeholder="Digite o valor" />
              </div>
            </div>
            <button type="submit" className="w-full bg-brand-gold text-brand-bg font-bold py-2 rounded-lg hover:bg-brand-gold/90 transition-all">Salvar Alterações</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { useStore, Professional } from '@/data/store';
import {
  PROFESSIONAL_SALES_COMMISSION_FIELDS,
  PROFESSIONAL_SERVICE_COMMISSION_RATE,
} from '@/data/appointment-commissions';
import {
  api,
  CreatedInvitation,
  OrganizationInvitation,
  OrganizationJoinRequest,
  OrganizationJoinRequestEvent,
  OrganizationJoinRequestEventType,
} from '@/data/api';
import { useAuth } from '@/auth/auth';
import { FeatureInfo } from '@/components/FeatureInfo';
import { useRecentlyAddedIds } from '@/hooks/useRecentlyAddedIds';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Plus, Trash2, Edit2, Mail, Phone, UserPlus, Copy, RefreshCw, Ban, CheckCircle2, Clock, UserCheck, UserX, ShieldAlert, Archive, RotateCcw } from 'lucide-react';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, 
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter, 
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const PRESET_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#64748b'];
const JOIN_REQUEST_AUTO_ARCHIVE_MS = 5 * 60 * 1000;

const JOIN_REQUEST_EVENT_LABELS: Record<OrganizationJoinRequestEventType, string> = {
  request_submitted: 'Pedido enviado',
  request_approved: 'Pedido aprovado',
  request_rejected: 'Pedido recusado',
  request_archived: 'Pedido movido para Arquivados',
  request_restored: 'Pedido restaurado para a lista principal',
  request_reopened: 'Pedido reaberto para nova análise',
  invitation_created: 'Convite gerado',
  invitation_email_status: 'Atualização do e-mail',
  invitation_revoked: 'Convite revogado',
  invitation_accepted: 'Convite aceito',
};

const getJoinRequestEventLabel = (event: OrganizationJoinRequestEvent) => {
  if (event.eventType === 'invitation_email_status') {
    const status = String(event.metadata.status ?? '');
    const statusLabels: Record<string, string> = {
      sent: 'E-mail enviado',
      delayed: 'E-mail atrasado',
      delivered: 'E-mail entregue',
      bounced: 'E-mail devolvido',
      failed: 'Falha no envio do e-mail',
      complained: 'E-mail marcado como spam',
    };
    return statusLabels[status] || JOIN_REQUEST_EVENT_LABELS.invitation_email_status;
  }
  return JOIN_REQUEST_EVENT_LABELS[event.eventType];
};

export default function Profissionais() {
  const { professionals, config, addProfessional, updateProfessional, removeProfessional, isLoading } = useStore();
  const recentlyAddedProfessionalIds = useRecentlyAddedIds(professionals, isLoading);
  const { profile, viewAsProfile } = useAuth();
  const activeProfile = viewAsProfile ?? profile;
  const isManager = activeProfile?.role === 'gestor' || activeProfile?.role === 'dev-admin';
  const canGrantManagerAccess = profile?.role === 'gestor' && !viewAsProfile;

  const [isOpen, setIsOpen] = useState(false);
  const [managerGrantOpen, setManagerGrantOpen] = useState(false);
  const [managerGrantConfirmOpen, setManagerGrantConfirmOpen] = useState(false);
  const [managerGrantEmail, setManagerGrantEmail] = useState('');
  const [isGrantingManager, setIsGrantingManager] = useState(false);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [form, setForm] = useState({
    name: '', role: 'barbeiro' as Professional['role'], initials: '', color: PRESET_COLORS[0], isActive: true,
    commissions: { barbearia: 0, manutencao: 0, manicure: 0, protese: 0, mentoria: 0 }
  });
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [accountEmailsByProfessional, setAccountEmailsByProfessional] = useState<Record<string, string>>({});
  const [deletingInvitationId, setDeletingInvitationId] = useState<string | null>(null);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteProfessional, setInviteProfessional] = useState<Professional | null>(null);
  const [inviteRole, setInviteRole] = useState<'professional' | 'recepcao'>('professional');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSendLoading, setInviteSendLoading] = useState(false);
  const [inviteConsent, setInviteConsent] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatedInvitation, setGeneratedInvitation] = useState<CreatedInvitation | null>(null);
  const [inviteDeliveryStatus, setInviteDeliveryStatus] = useState<'sending' | 'sent' | 'failed' | null>(null);
  const [inviteDeliveryError, setInviteDeliveryError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<OrganizationJoinRequest[]>([]);
  const [joinRequestEvents, setJoinRequestEvents] = useState<OrganizationJoinRequestEvent[]>([]);
  const [joinRequestNow, setJoinRequestNow] = useState(() => Date.now());
  const [joinCandidates, setJoinCandidates] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [requestSelections, setRequestSelections] = useState<Record<string, string>>({});
  const [joinRequestError, setJoinRequestError] = useState('');
  const [joinActionId, setJoinActionId] = useState<string | null>(null);
  const [joinInvitationLinks, setJoinInvitationLinks] = useState<Record<string, string>>({});

  const getInitials = (n: string) => n.split(' ').map(x => x[0]).join('').substring(0,2).toUpperCase();
  const cleanableInvitations = invitations.filter(invitation =>
    !invitation.acceptedAt &&
    (Boolean(invitation.revokedAt) || new Date(invitation.expiresAt).getTime() <= Date.now())
  );
  const pendingInvitationForRequest = (request: OrganizationJoinRequest) => {
    if (request.status !== 'approved' || request.userId || !request.professionalId) return undefined;
    return invitations.find(invitation =>
      invitation.professionalId === request.professionalId &&
      !invitation.acceptedAt &&
      !invitation.revokedAt &&
      new Date(invitation.expiresAt).getTime() > Date.now() &&
      (request.applicantEmail
        ? invitation.email.toLowerCase() === request.applicantEmail.toLowerCase()
        : request.applicantPhone === invitation.phone)
    );
  };
  const rejectedAtForRequest = (request: OrganizationJoinRequest) => {
    const rejectionEvent = [...joinRequestEvents].reverse().find(event =>
      event.requestId === request.id && event.eventType === 'request_rejected'
    );
    return request.reviewedAt || rejectionEvent?.createdAt || request.requestedAt;
  };
  const wasRestoredAfterRejection = (request: OrganizationJoinRequest) => {
    if (!request.restoredAt) return false;
    const restoredAt = Date.parse(request.restoredAt);
    const rejectedAt = Date.parse(rejectedAtForRequest(request));
    return Number.isFinite(restoredAt) && Number.isFinite(rejectedAt) && restoredAt > rejectedAt;
  };
  const isArchivedJoinRequest = (request: OrganizationJoinRequest) => {
    if (request.status !== 'rejected') return false;
    if (request.hiddenAt) return true;
    if (wasRestoredAfterRejection(request)) return false;
    const rejectedAt = Date.parse(rejectedAtForRequest(request));
    return Number.isFinite(rejectedAt) && joinRequestNow - rejectedAt >= JOIN_REQUEST_AUTO_ARCHIVE_MS;
  };
  const activeJoinRequests = joinRequests.filter(request => !isArchivedJoinRequest(request));
  const archivedJoinRequests = joinRequests.filter(isArchivedJoinRequest);

  const loadInvitations = async (showError = true) => {
    if (!isManager) return;
    try {
      setInvitations(await api.invitations.list());
    } catch (error) {
      if (showError) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os convites.');
      }
    }
  };

  const loadProfessionalAccountEmails = async (showError = true) => {
    if (!isManager) return;
    try {
      setAccountEmailsByProfessional(await api.professionals.accountEmails());
    } catch (error) {
      if (showError) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível carregar os e-mails vinculados aos profissionais.');
      }
    }
  };

  const loadJoinRequests = async (showError = true) => {
    if (!isManager) return;
    try {
      const [requests, candidates] = await Promise.all([
        api.joinRequests.listForManager(),
        api.joinRequests.candidates(),
      ]);
      const events = await api.joinRequests.listHistory(requests.map(request => request.id));
      setJoinRequests(requests);
      setJoinRequestEvents(events);
      setJoinCandidates(candidates);
      setJoinRequestError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar os pedidos de acesso.';
      setJoinRequestError(message);
      if (showError) toast.error(message);
    }
  };

  const deleteJoinRequestEvent = async (event: OrganizationJoinRequestEvent) => {
    if (!isManager || !window.confirm('Excluir este evento do histórico do pedido de acesso?')) return;
    try {
      const deleted = await api.history.deleteItem('join_request_event', event.id);
      if (!deleted) throw new Error('Este registro não foi encontrado.');
      setJoinRequestEvents(current => current.filter(item => item.id !== event.id));
      toast.success('Evento removido do histórico.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir o evento.');
    }
  };

  useEffect(() => {
    const deadlines = joinRequests
      .filter(request => request.status === 'rejected' && !request.hiddenAt && !wasRestoredAfterRejection(request))
      .map(request => Date.parse(rejectedAtForRequest(request)) + JOIN_REQUEST_AUTO_ARCHIVE_MS)
      .filter(deadline => Number.isFinite(deadline) && deadline > joinRequestNow);
    if (deadlines.length === 0) return;
    const timer = window.setTimeout(
      () => setJoinRequestNow(Date.now()),
      Math.max(1, Math.min(...deadlines) - Date.now() + 25),
    );
    return () => window.clearTimeout(timer);
  }, [joinRequests, joinRequestEvents, joinRequestNow]);

  useEffect(() => {
    if (!isManager) return;
    void loadInvitations();
    void loadProfessionalAccountEmails();
    const refreshManagerData = () => {
      void loadInvitations(false);
      void loadProfessionalAccountEmails(false);
    };
    const onFocus = () => refreshManagerData();
    const interval = window.setInterval(refreshManagerData, 30_000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [isManager]);

  useEffect(() => {
    if (!isManager) return;
    void loadJoinRequests();
    const onFocus = () => void loadJoinRequests(false);
    const interval = window.setInterval(() => void loadJoinRequests(false), 30_000);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [isManager]);

  const approveJoinRequest = async (request: OrganizationJoinRequest) => {
    if (!request.applicantEmail?.trim()) {
      toast.error('Este pedido antigo foi feito por telefone. Peça ao profissional para enviar um novo pedido com e-mail.');
      return;
    }
    const professionalId = requestSelections[request.id];
    if (!professionalId) {
      toast.error('Selecione o perfil profissional que corresponde a este pedido.');
      return;
    }
    if (joinActionId) return;
    setJoinActionId(request.id);
    try {
      await api.joinRequests.approve(request.id, professionalId);
      const reviewedAt = new Date().toISOString();
      setJoinRequests(current => current.map(item => item.id === request.id
        ? { ...item, status: 'approved', professionalId, reviewedAt }
        : item));
      await loadJoinRequests(false);
      try {
        await generateJoinInvitationLink(request, professionalId);
        toast.success('Pedido aprovado e convite gerado. Envie o link ao profissional.');
      } catch (inviteError) {
        toast.error(inviteError instanceof Error
          ? `Pedido aprovado, mas o convite não foi gerado: ${inviteError.message}`
          : 'Pedido aprovado, mas não foi possível gerar o convite.');
      }
      try {
        setJoinCandidates(await api.joinRequests.candidates());
      } catch {
        await loadJoinRequests(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível aprovar o pedido.');
    } finally {
      setJoinActionId(null);
    }
  };

  const generateJoinInvitationLink = async (
    request: OrganizationJoinRequest,
    professionalId: string,
  ): Promise<string> => {
    if (!request.applicantEmail?.trim()) {
      throw new Error('Este pedido não tem e-mail. Peça ao profissional para enviar um novo pedido por e-mail.');
    }
    const invitation = await api.invitations.create(professionalId, request.applicantEmail);

    const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const link = `${window.location.origin}${basePath}convite/${invitation.token}`;
    setJoinInvitationLinks(current => ({ ...current, [request.id]: link }));
    setInvitations(current => [
      invitation,
      ...current.filter(item => item.professionalId !== invitation.professionalId || item.acceptedAt || item.revokedAt),
    ]);
    await loadJoinRequests(false);
    return link;
  };

  const regenerateJoinInvitation = async (request: OrganizationJoinRequest) => {
    if (!request.professionalId || joinActionId) return;
    setJoinActionId(request.id);
    try {
      const link = await generateJoinInvitationLink(request, request.professionalId);
      try {
        await navigator.clipboard.writeText(link);
        toast.success('Novo convite gerado e link copiado.');
      } catch {
        toast.success('Novo convite gerado. Copie o link exibido no pedido.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível gerar outro convite.');
    } finally {
      setJoinActionId(null);
    }
  };

  const rejectJoinRequest = async (request: OrganizationJoinRequest) => {
    if (!window.confirm(`Recusar o pedido de acesso de ${request.applicantName}?`)) return;
    if (joinActionId) return;
    setJoinActionId(request.id);
    try {
      await api.joinRequests.reject(request.id);
      setJoinRequests(current => current.map(item => item.id === request.id
        ? { ...item, status: 'rejected', reviewedAt: new Date().toISOString() }
        : item));
      await loadJoinRequests(false);
      toast.success('Pedido recusado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível recusar o pedido.');
    } finally {
      setJoinActionId(null);
    }
  };

  const archiveRejectedJoinRequest = async (request: OrganizationJoinRequest) => {
    if (!isManager || request.status !== 'rejected' || joinActionId) return;
    setJoinActionId(request.id);
    try {
      const hiddenAt = await api.joinRequests.archiveRejected(request.id);
      setJoinRequests(current => current.map(item => item.id === request.id
        ? { ...item, hiddenAt }
        : item));
      setJoinRequestNow(Date.now());
      await loadJoinRequests(false);
      toast.success('Pedido removido da lista principal. O histórico foi mantido em Arquivados.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível arquivar o pedido.');
    } finally {
      setJoinActionId(null);
    }
  };

  const restoreRejectedJoinRequest = async (request: OrganizationJoinRequest) => {
    if (!isManager || request.status !== 'rejected' || !request.hiddenAt || joinActionId) return;
    setJoinActionId(request.id);
    try {
      const restoredAt = await api.joinRequests.restoreRejected(request.id);
      setJoinRequests(current => current.map(item => item.id === request.id
        ? { ...item, hiddenAt: undefined, restoredAt }
        : item));
      setJoinRequestNow(Date.now());
      await loadJoinRequests(false);
      toast.success('Pedido restaurado à lista principal. Ele não será arquivado automaticamente novamente.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível restaurar o pedido.');
    } finally {
      setJoinActionId(null);
    }
  };

  const revokeApprovedJoinInvitation = async (
    request: OrganizationJoinRequest,
    invitation: OrganizationInvitation,
  ) => {
    if (joinActionId || !window.confirm(`Revogar o convite de ${request.applicantName} e liberar o perfil selecionado?`)) return;
    setJoinActionId(request.id);
    try {
      const revokedInvitation = await api.joinRequests.revokeApprovedInvitation(request.id, invitation.id);
      setInvitations(current => current.map(item => item.id === invitation.id
        ? revokedInvitation
        : item));
      setJoinRequests(current => current.map(item => item.id === request.id
        ? { ...item, status: 'pending', professionalId: undefined, reviewedAt: undefined, userId: undefined }
        : item));
      setRequestSelections(current => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      setJoinInvitationLinks(current => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      await loadJoinRequests(false);
      toast.success('Convite revogado. O perfil foi liberado para revisar este pedido novamente.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível revogar o convite.');
    } finally {
      setJoinActionId(null);
    }
  };

  const handleOpenEdit = (p: Professional) => {
    setEditingId(p.id);
    setForm({
      name: p.name, role: p.role, initials: p.initials, color: p.color, isActive: p.isActive,
      commissions: { ...p.commissions }
    });
    setIsOpen(true);
  };

  const handleOpenNew = () => {
    setEditingId(null);
    setForm({
      name: '', role: 'barbeiro', initials: '', color: PRESET_COLORS[Math.floor(Math.random()*PRESET_COLORS.length)], isActive: true,
        commissions: { barbearia: 0, manutencao: 0, manicure: 0, protese: 0, mentoria: 0 }
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) { toast.error('Nome obrigatório'); return; }
    const initials = form.initials || getInitials(form.name);
    
    const saved = editingId
      ? await updateProfessional(editingId, { ...form, initials })
      : await addProfessional({ ...form, initials });
    if (!saved) return;
    toast.success(editingId ? 'Profissional atualizado' : 'Profissional adicionado');
    setIsOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      if (await removeProfessional(id)) {
        toast.success('Profissional excluído. Histórico e valores preservados.');
        await loadInvitations();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const grantOrganizationManager = async () => {
    if (!profile?.organizationId || !managerGrantEmail.trim() || isGrantingManager) return;
    setIsGrantingManager(true);
    try {
      const result = await api.admin.provisionOrganizationManager(
        managerGrantEmail.trim(),
        profile.organizationId,
      );
      setManagerGrantConfirmOpen(false);
      setManagerGrantOpen(false);
      setManagerGrantEmail('');
      toast.success(
        `Acesso de Gestor concedido a ${result.fullName} em ${new Date(result.grantedAt).toLocaleString('pt-BR')}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível conceder o acesso de Gestor.');
    } finally {
      setIsGrantingManager(false);
    }
  };

  const openInvite = (professional: Professional) => {
    setInviteProfessional(professional);
    setInviteRole('professional');
    setInviteEmail('');
    setGeneratedLink('');
    setGeneratedInvitation(null);
    setInviteDeliveryStatus(null);
    setInviteDeliveryError('');
    setInviteConsent(false);
    setInviteOpen(true);
  };

  const openReceptionInvite = (email = '') => {
    setInviteProfessional(null);
    setInviteRole('recepcao');
    setInviteEmail(email);
    setGeneratedLink('');
    setGeneratedInvitation(null);
    setInviteDeliveryStatus(null);
    setInviteDeliveryError('');
    setInviteConsent(false);
    setInviteOpen(true);
  };

  const resendReceptionInvite = (invitation: OrganizationInvitation) => {
    if (invitation.email) openReceptionInvite(invitation.email);
  };

  const invitationFor = (professionalId: string) => invitations.find(invitation =>
    invitation.professionalId === professionalId &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    new Date(invitation.expiresAt).getTime() > Date.now()
  );

  const activeEmailInvitationFor = (professionalId: string) => invitations.find(invitation =>
    invitation.professionalId === professionalId &&
    Boolean(invitation.email) &&
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    new Date(invitation.expiresAt).getTime() > Date.now()
  );

  const contactsForProfessional = (professionalId: string) => {
    if (!isManager) return { email: undefined, phone: undefined };

    const linkedAccountEmail = accountEmailsByProfessional[professionalId]?.trim();
    const accountContacts = activeProfile?.professionalId === professionalId
      ? { email: activeProfile.email.trim() || undefined, phone: activeProfile.phone?.trim() || undefined }
      : undefined;
    const acceptedInvitation = invitations.find(invitation =>
      invitation.professionalId === professionalId && Boolean(invitation.acceptedAt)
    );
    const pendingInvitation = invitationFor(professionalId);
    const invitationContacts = acceptedInvitation ?? pendingInvitation;

    return {
      email: linkedAccountEmail || accountContacts?.email || invitationContacts?.email.trim() || undefined,
      phone: accountContacts?.phone || invitationContacts?.phone?.trim() || undefined,
    };
  };

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if ((!inviteProfessional && inviteRole !== 'recepcao') || !inviteEmail.trim()) {
      toast.error('Informe o e-mail da pessoa convidada.');
      return;
    }
    if (!inviteConsent) {
      toast.error('Confirme o consentimento antes de preparar o envio.');
      return;
    }
    setInviteLoading(true);
    try {
      const invitation = inviteRole === 'recepcao'
        ? await api.invitations.createReception(inviteEmail.trim())
        : await api.invitations.create(inviteProfessional!.id, inviteEmail.trim());
      const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
      const link = `${window.location.origin}${basePath}convite/${invitation.token}`;
      setGeneratedInvitation(invitation);
      setGeneratedLink(link);
      setInvitations(current => [
        invitation,
        ...current.filter(item => item.professionalId !== invitation.professionalId || item.acceptedAt || item.revokedAt),
      ]);
      try {
        await navigator.clipboard.writeText(link);
      } catch {}
      await sendInvitationEmail(invitation, link);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar o convite.');
    } finally {
      setInviteLoading(false);
    }
  };

  const sendInvitationEmail = async (
    invitation = generatedInvitation,
    link = generatedLink,
  ) => {
    if (!invitation || !link || !inviteEmail.trim()) return;
    if (!inviteConsent) {
      toast.error('Confirme o consentimento antes de enviar.');
      return;
    }
    setInviteSendLoading(true);
    setInviteDeliveryStatus('sending');
    setInviteDeliveryError('');
    try {
      await api.invitations.sendEmail(invitation.id, invitation.token, link, inviteConsent);
      setInviteDeliveryStatus('sent');
      await loadInvitations(false);
      toast.success(`E-mail enviado ao Resend para ${inviteEmail.trim()}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível enviar o convite.';
      setInviteDeliveryStatus('failed');
      setInviteDeliveryError(message);
      toast.error(`O convite foi criado, mas o e-mail não foi enviado: ${message}`);
    } finally {
      setInviteSendLoading(false);
    }
  };

  const revokeInvite = async (invitation: OrganizationInvitation) => {
    try {
      const revokedInvitation = await api.invitations.revoke(invitation.id);
      setInvitations(current => current.map(item => item.id === invitation.id ? revokedInvitation : item));
      toast.success('Convite revogado.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível revogar o convite.');
    }
  };

  const deleteInvite = async (invitation: OrganizationInvitation) => {
    if (deletingInvitationId) return;
    setDeletingInvitationId(invitation.id);
    try {
      await api.invitations.delete(invitation.id);
      setInvitations(current => current.filter(item => item.id !== invitation.id));
      toast.success('Convite excluído do histórico.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir o convite.');
    } finally {
      setDeletingInvitationId(null);
    }
  };

  const cleanupHistoricalInvitations = async () => {
    if (cleanupLoading || cleanableInvitations.length === 0) return;
    setCleanupLoading(true);
    try {
      const deletedIds = await api.invitations.cleanupHistorical();
      const deletedIdSet = new Set(deletedIds);
      setInvitations(current => current.filter(invitation => !deletedIdSet.has(invitation.id)));
      setCleanupDialogOpen(false);
      toast.success(`${deletedIds.length} convite${deletedIds.length === 1 ? '' : 's'} removido${deletedIds.length === 1 ? '' : 's'} do histórico.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível limpar o histórico de convites.');
    } finally {
      setCleanupLoading(false);
    }
  };

  const resendInvite = (professional: Professional, invitation: OrganizationInvitation) => {
    if (!invitation.email) {
      toast.error('Este convite antigo foi criado por telefone. Gere um novo convite por e-mail.');
      return;
    }
    setInviteProfessional(professional);
    setInviteEmail(invitation.email);
    setInviteConsent(false);
    setGeneratedLink('');
    setInviteOpen(true);
  };

  return (
    <div className="p-4 sm:p-5 md:p-8 space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Equipe</h2>
          <p className="text-sm text-muted-foreground mt-1">{professionals.length} profissionais cadastrados</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap md:w-auto">
          {canGrantManagerAccess && (
            <button
              type="button"
              onClick={() => {
                setManagerGrantEmail('');
                setManagerGrantOpen(true);
              }}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-gold/40 px-4 py-2 text-sm font-semibold text-brand-gold hover:bg-brand-gold/10 sm:w-auto"
            >
              <UserPlus className="h-4 w-4" /> Vincular Gestor
            </button>
          )}
          {isManager && (
            <button
              type="button"
              onClick={() => openReceptionInvite()}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold text-foreground hover:border-brand-gold hover:text-brand-gold sm:w-auto"
            >
              <Mail className="h-4 w-4" /> Convidar Recepção
            </button>
          )}
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <button onClick={handleOpenNew} className="min-h-11 w-full justify-center bg-brand-gold text-brand-bg px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-gold/90 flex items-center gap-2 sm:w-auto">
              <Plus className="w-4 h-4" /> Adicionar Profissional
            </button>
          </DialogTrigger>
          <DialogContent className="bg-brand-surface border-brand-border text-foreground max-w-xl">
            <DialogHeader><DialogTitle>{editingId ? 'Editar Profissional' : 'Novo Profissional'}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 md:col-span-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Nome *</label>
                  <input type="text" required value={form.name} onChange={e => {
                    setForm(f => ({ ...f, name: e.target.value, initials: !editingId ? getInitials(e.target.value) : f.initials }));
                  }} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none focus:ring-1 focus:ring-brand-gold" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Cargo</label>
                  <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as any }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none focus:ring-1 focus:ring-brand-gold">
                    {config.roles.filter(role => role.isActive).map(role => <option key={role.key} value={role.key}>{role.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Iniciais</label>
                  <input type="text" maxLength={3} value={form.initials} onChange={e => setForm(f => ({ ...f, initials: e.target.value.toUpperCase() }))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 mt-1 text-sm outline-none focus:ring-1 focus:ring-brand-gold" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Cor</label>
                  <div className="flex gap-2 mt-2">
                    {PRESET_COLORS.map(c => (
                      <button key={c} type="button" aria-label={`Selecionar cor ${c}`} aria-pressed={form.color === c} onClick={() => setForm(f => ({...f, color: c}))} className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${form.color === c ? 'ring-2 ring-brand-gold ring-offset-2 ring-offset-brand-surface' : ''}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground uppercase border-b border-brand-border/50 pb-2 mb-3 block">Comissões por venda (%)</label>
                <p className="mb-3 text-xs text-muted-foreground">
                  A execução de serviços é fixa: {Math.round(PROFESSIONAL_SERVICE_COMMISSION_RATE * 100)}% para o profissional e 50% para o salão. Configure abaixo somente comissões de venda.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {PROFESSIONAL_SALES_COMMISSION_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-xs text-muted-foreground">{label}</label>
                      <div className="flex items-center gap-2 mt-1">
                        <input type="number" min="0" max="100" value={Math.round(form.commissions[key] * 100)} onChange={e => setForm(f => ({...f, commissions: {...f.commissions, [key]: Number(e.target.value)/100}}))} className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand-gold" />
                        <span className="text-sm font-medium">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-brand-bg border border-brand-border rounded-lg">
                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-bold text-sm">Status do Profissional</p>
                    <FeatureInfo label="Status do profissional">Inativar remove a pessoa da agenda, mas mantém seu histórico e registros.</FeatureInfo>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({...f, isActive: e.target.checked}))} className="sr-only peer" />
                  <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
                </label>
              </div>

              <button type="submit" className="w-full bg-brand-gold text-brand-bg font-bold py-3 rounded-lg hover:bg-brand-gold/90 transition-all">Salvar Profissional</button>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {canGrantManagerAccess && (
        <>
          <Dialog open={managerGrantOpen} onOpenChange={open => {
            if (!isGrantingManager) setManagerGrantOpen(open);
          }}>
            <DialogContent className="bg-brand-surface border-brand-border text-foreground max-w-lg">
              <DialogHeader>
                <DialogTitle>Vincular conta como Gestor / Proprietário</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4 pt-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (!profile?.organizationId) {
                    toast.error('Não foi possível identificar a empresa ativa.');
                    return;
                  }
                  setManagerGrantConfirmOpen(true);
                }}
              >
                <p className="text-sm text-muted-foreground">
                  O vínculo será feito com <strong className="text-foreground">{config.name || 'a empresa ativa'}</strong>.
                  A conta precisa já existir e não pode ter outro vínculo ativo ou histórico.
                </p>
                <div>
                  <label htmlFor="manager-grant-email" className="mb-2 block text-sm font-semibold">E-mail da conta existente</label>
                  <input
                    id="manager-grant-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={managerGrantEmail}
                    onChange={event => setManagerGrantEmail(event.target.value)}
                    placeholder="nome@exemplo.com"
                    className="w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-brand-gold"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setManagerGrantOpen(false)} className="rounded-lg border border-brand-border px-4 py-2 text-sm font-semibold">
                    Cancelar
                  </button>
                  <button type="submit" disabled={!managerGrantEmail.trim()} className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-bold text-brand-bg disabled:opacity-50">
                    Continuar
                  </button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <AlertDialog open={managerGrantConfirmOpen} onOpenChange={setManagerGrantConfirmOpen}>
            <AlertDialogContent className="border-brand-border bg-brand-surface text-foreground">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-warning" /> Confirmar acesso completo
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
                  Ao conceder esse cargo, <strong className="text-foreground">{managerGrantEmail.trim()}</strong> terá
                  acesso completo à empresa, incluindo equipe, configurações e dados financeiros.
                  A ação ficará registrada com seu usuário e o horário. Confirme somente se essa pessoa deve receber esse nível de acesso.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isGrantingManager}>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isGrantingManager}
                  onClick={event => {
                    event.preventDefault();
                    void grantOrganizationManager();
                  }}
                  className="bg-brand-gold text-brand-bg hover:bg-brand-gold/90"
                >
                  {isGrantingManager ? 'Concedendo...' : 'Confirmar acesso completo'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {isManager && (
        <section className="rounded-2xl border border-brand-border bg-brand-surface p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-foreground">Pedidos de acesso</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {joinRequests.filter(request => request.status === 'pending').length} aguardando aprovação
              </p>
            </div>
            <UserCheck className="h-5 w-5 text-brand-gold" />
          </div>
          {joinRequestError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
              <p role="alert" className="text-sm text-destructive">{joinRequestError}</p>
              <button type="button" onClick={() => void loadJoinRequests()} className="mt-3 rounded-lg border border-brand-border px-3 py-2 text-xs font-semibold text-foreground hover:border-brand-gold">
                Tentar novamente
              </button>
            </div>
          ) : activeJoinRequests.length === 0 && archivedJoinRequests.length === 0 ? (
            <p className="rounded-xl border border-brand-border bg-brand-bg p-4 text-sm text-muted-foreground">
              Nenhum profissional solicitou acesso até agora.
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {activeJoinRequests.length === 0 && (
                <p className="rounded-xl border border-brand-border bg-brand-bg p-4 text-sm text-muted-foreground">
                  Não há pedidos ativos. Os pedidos recusados antigos ficam em Arquivados.
                </p>
              )}
              {activeJoinRequests.map(request => {
                const pending = request.status === 'pending';
                const selectedCandidate = requestSelections[request.id] || '';
                  const approvedProfessional = request.professionalId
                    ? professionals.find(item => item.id === request.professionalId)
                    : undefined;
                  const invitationLink = joinInvitationLinks[request.id];
                  const pendingInvitation = pendingInvitationForRequest(request);
                  const requestEvents = joinRequestEvents.filter(event => event.requestId === request.id);
                const statusLabel = request.status === 'approved' ? 'Aprovado' : request.status === 'rejected' ? 'Recusado' : 'Pendente';
                const rejectionTime = request.status === 'rejected' ? Date.parse(rejectedAtForRequest(request)) : Number.NaN;
                const remainingMs = !wasRestoredAfterRejection(request) && Number.isFinite(rejectionTime)
                  ? Math.max(0, rejectionTime + JOIN_REQUEST_AUTO_ARCHIVE_MS - joinRequestNow)
                  : null;
                return (
                  <div key={request.id} data-testid="organization-join-request-row" className="rounded-xl border border-brand-border bg-brand-bg p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`mt-0.5 rounded-lg p-2 ${request.status === 'approved' ? 'bg-success/10 text-success' : request.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                          {request.status === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : request.status === 'rejected' ? <UserX className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{request.applicantName}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{request.applicantEmail || request.applicantPhone}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">Solicitado em {new Date(request.requestedAt).toLocaleString('pt-BR')}</p>
                          {request.status === 'rejected' && remainingMs !== null && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Vai para Arquivados em {Math.ceil(remainingMs / 60_000) < 1 ? 'menos de 1 min' : `${Math.ceil(remainingMs / 60_000)} min`}.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${request.status === 'approved' ? 'bg-success/10 text-success' : request.status === 'rejected' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                          {statusLabel}
                        </span>
                        {request.status === 'rejected' && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button
                                type="button"
                                disabled={joinActionId !== null}
                                aria-label={`Excluir ${request.applicantName} da lista principal`}
                                title="Excluir da lista principal"
                                className="rounded-lg border border-brand-border p-2 text-muted-foreground hover:border-brand-gold hover:text-brand-gold disabled:opacity-50"
                              >
                                <Archive className="h-4 w-4" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Mover pedido para Arquivados?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  O pedido sairá da lista principal. O registro e toda a linha do tempo serão mantidos em Arquivados.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={joinActionId !== null} className="bg-brand-bg border-brand-border">Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  disabled={joinActionId !== null}
                                  onClick={event => {
                                    event.preventDefault();
                                    void archiveRejectedJoinRequest(request);
                                  }}
                                  className="bg-brand-gold text-brand-bg hover:bg-brand-gold/90"
                                >
                                  {joinActionId === request.id ? 'Arquivando...' : 'Arquivar agora'}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                    <details className="mt-3 rounded-lg border border-brand-border bg-brand-surface/50">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground hover:text-brand-gold">
                        Histórico do pedido · {requestEvents.length} {requestEvents.length === 1 ? 'registro' : 'registros'}
                      </summary>
                      <ol className="space-y-3 border-t border-brand-border px-3 py-3">
                        {requestEvents.length === 0 ? (
                          <li className="text-xs text-muted-foreground">Nenhuma ação registrada ainda.</li>
                        ) : requestEvents.map(event => (
                          <li key={event.id} className="flex items-start gap-3">
                            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gold" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground">
                                {getJoinRequestEventLabel(event)}
                                {event.actorName ? <span className="font-normal text-muted-foreground"> · {event.actorName}</span> : null}
                              </p>
                              <time dateTime={event.createdAt} className="mt-0.5 block text-[11px] text-muted-foreground">
                                {new Date(event.createdAt).toLocaleString('pt-BR')}
                              </time>
                            </div>
                            {isManager && (
                              <button type="button" onClick={() => void deleteJoinRequestEvent(event)} className="rounded p-1.5 text-destructive hover:bg-destructive/10" aria-label="Excluir evento do histórico">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    </details>
                    {pending && (
                      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <select
                          aria-label={`Perfil profissional para ${request.applicantName}`}
                          value={selectedCandidate}
                          onChange={event => setRequestSelections(current => ({ ...current, [request.id]: event.target.value }))}
                          disabled={joinActionId !== null || joinCandidates.length === 0}
                          className="min-w-0 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-brand-gold disabled:opacity-60"
                        >
                          <option value="">Selecione o perfil correspondente</option>
                          {joinCandidates.map(candidate => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name} — {config.roles.find(role => role.key === candidate.role)?.label || candidate.role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void approveJoinRequest(request)}
                          disabled={!request.applicantEmail || !selectedCandidate || joinActionId !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-gold px-3 py-2 text-xs font-bold text-brand-bg hover:bg-brand-gold/90 disabled:opacity-50"
                        >
                          <UserCheck className="h-4 w-4" /> {joinActionId === request.id ? 'Aprovando...' : 'Aprovar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void rejectJoinRequest(request)}
                          disabled={joinActionId !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          <UserX className="h-4 w-4" /> Recusar
                        </button>
                      </div>
                    )}
                    {pending && !request.applicantEmail && (
                      <p className="mt-3 text-xs text-warning">
                        Este pedido antigo usa telefone. Peça ao profissional para enviar um novo pedido com e-mail antes de aprovar.
                      </p>
                    )}
                    {pending && joinCandidates.length === 0 && (
                      <p className="mt-3 text-xs text-warning">
                        Cadastre primeiro o perfil profissional em Equipe para poder aprovar este pedido.
                      </p>
                    )}
                    {request.status === 'approved' && request.userId && (
                      <p className="mt-4 rounded-lg border border-success/20 bg-success/5 p-3 text-xs text-foreground">
                        O profissional já aceitou o convite e está vinculado à empresa.
                      </p>
                    )}
                    {request.status === 'approved' && request.professionalId && !request.userId && !request.applicantEmail && (
                      <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
                        Este pedido aprovado usava telefone e não pode gerar novos convites. Peça ao profissional para enviar um novo pedido com e-mail.
                      </p>
                    )}
                    {request.status === 'approved' && request.professionalId && !request.userId && request.applicantEmail && (
                      <div className="mt-4 space-y-3 rounded-lg border border-success/20 bg-success/5 p-3">
                        <p className="text-xs text-foreground">
                          Perfil selecionado: <strong>{approvedProfessional?.name || 'Profissional aprovado'}</strong>.
                          A conta só será criada e vinculada depois que a pessoa aceitar o convite recebido no e-mail.
                        </p>
                        {invitationLink && (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              aria-label={`Link de convite para ${request.applicantName}`}
                              readOnly
                              value={invitationLink}
                              className="min-w-0 flex-1 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs text-foreground"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(invitationLink);
                                  toast.success('Link do convite copiado.');
                                } catch {
                                  toast.error('Não foi possível copiar o link. Selecione e copie o texto.');
                                }
                              }}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-border px-3 py-2 text-xs font-semibold text-foreground hover:border-brand-gold"
                            >
                              <Copy className="h-4 w-4" /> Copiar
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void regenerateJoinInvitation(request)}
                          disabled={joinActionId !== null}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-gold px-3 py-2 text-xs font-bold text-brand-bg hover:bg-brand-gold/90 disabled:opacity-50"
                        >
                          <RefreshCw className="h-4 w-4" />
                          {joinActionId === request.id
                            ? 'Gerando convite...'
                            : invitationLink
                              ? 'Gerar novo link (invalida o anterior)'
                              : 'Gerar convite'}
                        </button>
                        {pendingInvitation && (
                          <button
                            type="button"
                            onClick={() => void revokeApprovedJoinInvitation(request, pendingInvitation)}
                            disabled={joinActionId !== null}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          >
                            <Ban className="h-4 w-4" />
                            {joinActionId === request.id ? 'Revogando convite...' : 'Revogar convite e liberar perfil'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {archivedJoinRequests.length > 0 && (
                <details className="rounded-xl border border-brand-border bg-brand-bg p-3">
                  <summary className="cursor-pointer list-inside text-sm font-semibold text-foreground hover:text-brand-gold">
                    Pedidos recusados arquivados ({archivedJoinRequests.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {archivedJoinRequests.map(request => {
                      const requestEvents = joinRequestEvents.filter(event => event.requestId === request.id);
                      return (
                        <div key={request.id} data-testid="organization-join-request-archived-row" className="rounded-lg border border-brand-border bg-brand-surface p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className="mt-0.5 rounded-lg bg-destructive/10 p-2 text-destructive">
                                <UserX className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{request.applicantName}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{request.applicantEmail || request.applicantPhone}</p>
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  {request.hiddenAt
                                    ? `Arquivado manualmente em ${new Date(request.hiddenAt).toLocaleString('pt-BR')}`
                                    : 'Arquivado automaticamente após 5 minutos'}
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground">
                                Arquivado
                              </span>
                              {request.hiddenAt && (
                                <button
                                  type="button"
                                  onClick={() => void restoreRejectedJoinRequest(request)}
                                  disabled={joinActionId !== null}
                                  aria-label={`Restaurar pedido de ${request.applicantName}`}
                                  title="Restaurar pedido à lista principal"
                                  className="rounded-lg border border-brand-border p-2 text-muted-foreground hover:border-brand-gold hover:text-brand-gold disabled:opacity-50"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                          <details className="mt-3 rounded-lg border border-brand-border bg-brand-bg/60">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground hover:text-brand-gold">
                              Histórico do pedido · {requestEvents.length} {requestEvents.length === 1 ? 'registro' : 'registros'}
                            </summary>
                            <ol className="space-y-3 border-t border-brand-border px-3 py-3">
                              {requestEvents.length === 0 ? (
                                <li className="text-xs text-muted-foreground">Nenhuma ação registrada ainda.</li>
                              ) : requestEvents.map(event => (
                                <li key={event.id} className="flex items-start gap-3">
                                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gold" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-foreground">
                                      {getJoinRequestEventLabel(event)}
                                      {event.actorName ? <span className="font-normal text-muted-foreground"> · {event.actorName}</span> : null}
                                    </p>
                                    <time dateTime={event.createdAt} className="mt-0.5 block text-[11px] text-muted-foreground">
                                      {new Date(event.createdAt).toLocaleString('pt-BR')}
                                    </time>
                                  </div>
                                  {isManager && (
                                    <button type="button" onClick={() => void deleteJoinRequestEvent(event)} className="rounded p-1.5 text-destructive hover:bg-destructive/10" aria-label="Excluir evento do histórico">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {isManager && invitations.length > 0 && (
        <section className="rounded-2xl border border-brand-border bg-brand-surface p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-foreground">Histórico de convites da equipe</h3>
              <FeatureInfo label="Histórico de convites">Novos convites são enviados por e-mail e expiram em até 30 dias. Convites antigos por telefone podem ser revogados ou removidos.</FeatureInfo>
            </div>
            <div className="flex items-center gap-2">
              {cleanableInvitations.length > 0 && (
                <AlertDialog open={cleanupDialogOpen} onOpenChange={open => !cleanupLoading && setCleanupDialogOpen(open)}>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      disabled={cleanupLoading || deletingInvitationId !== null}
                      className="flex items-center gap-2 rounded-lg border border-destructive/20 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Limpar {cleanableInvitations.length}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Limpar convites do histórico?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Serão removidos permanentemente {cleanableInvitations.length} convites expirados ou revogados. Convites aceitos e pendentes serão preservados. Esta ação não pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={cleanupLoading} className="bg-brand-bg border-brand-border">Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={cleanupLoading || cleanableInvitations.length === 0}
                        onClick={event => {
                          event.preventDefault();
                          void cleanupHistoricalInvitations();
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {cleanupLoading ? 'Limpando...' : 'Confirmar limpeza'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Mail className="h-5 w-5 text-brand-gold" />
            </div>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {invitations.map(invitation => {
              const professional = professionals.find(item => item.id === invitation.professionalId);
              const accepted = Boolean(invitation.acceptedAt);
              const revoked = Boolean(invitation.revokedAt);
              const expired = !accepted && !revoked && new Date(invitation.expiresAt).getTime() <= Date.now();
              const deliveryStatus = invitation.emailDeliveryStatus;
              const deliveryLabel = deliveryStatus === 'delivered'
                ? 'Entregue'
                : deliveryStatus === 'bounced'
                  ? 'Devolvido'
                  : deliveryStatus === 'failed'
                    ? 'Falha ou recusa'
                    : deliveryStatus === 'complained'
                      ? 'Marcado como spam'
                      : deliveryStatus === 'delayed'
                        ? 'Entrega atrasada'
                        : deliveryStatus === 'sent'
                          ? 'Enviado · aguardando confirmação'
                          : undefined;
              const deliveryTone = deliveryStatus === 'delivered'
                ? 'text-success'
                : deliveryStatus === 'bounced' || deliveryStatus === 'failed' || deliveryStatus === 'complained'
                  ? 'text-destructive'
                  : deliveryStatus === 'delayed'
                    ? 'text-warning'
                    : 'text-muted-foreground';
              return (
                <div key={invitation.id} data-testid="invitation-history-row" className="flex flex-col gap-3 rounded-xl border border-brand-border bg-brand-bg p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`rounded-lg p-2 ${accepted ? 'bg-success/10 text-success' : revoked || expired ? 'bg-muted text-muted-foreground' : 'bg-brand-gold/10 text-brand-gold'}`}>
                      {accepted ? <CheckCircle2 className="h-4 w-4" /> : revoked || expired ? <Ban className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                       <p className="truncate text-sm font-semibold">{professional?.name || (invitation.role === 'recepcao' ? 'Recepcionista' : 'Profissional removido')}</p>
                       <p className="truncate text-xs text-muted-foreground">{invitation.phone || invitation.email}</p>
                      {!invitation.email && invitation.phone && !accepted && !revoked && !expired && (
                        <p className="mt-1 text-xs text-warning">Convite por telefone desativado. Gere um novo convite por e-mail.</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span data-testid="invitation-created-by">Criado por {invitation.invitedByName || 'responsável não registrado'}</span>
                        {' · '}
                        <span data-testid="invitation-created-at">em {new Date(invitation.createdAt).toLocaleString('pt-BR')}</span>
                      </p>
                      {deliveryLabel && (
                        <p
                          className={`mt-1 text-xs ${deliveryTone}`}
                          data-testid="invitation-email-delivery-status"
                        >
                          E-mail: <strong>{deliveryLabel}</strong>
                          {invitation.emailDeliveryUpdatedAt && (
                            <> · atualizado em {new Date(invitation.emailDeliveryUpdatedAt).toLocaleString('pt-BR')}</>
                          )}
                        </p>
                      )}
                      {revoked && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span data-testid="invitation-revoked-by">Revogado por {invitation.revokedByName || 'responsável não registrado'}</span>
                          {' · '}
                          <span data-testid="invitation-revoked-at">em {new Date(invitation.revokedAt!).toLocaleString('pt-BR')}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${accepted ? 'bg-success/10 text-success' : revoked ? 'bg-muted text-muted-foreground' : expired ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
                      {accepted ? 'Aceito' : revoked ? 'Revogado' : expired ? 'Expirado' : 'Pendente'}
                    </span>
                    {!accepted && !revoked && !expired && (
                      <>
                        {professional && invitation.email && (
                          <button type="button" onClick={() => resendInvite(professional, invitation)} className="rounded-lg border border-brand-border p-2 text-muted-foreground hover:border-brand-gold hover:text-brand-gold" aria-label={`Reenviar convite para ${professional.name}`} title="Reenviar convite">
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        )}
                        {!professional && invitation.role === 'recepcao' && invitation.email && (
                          <button type="button" onClick={() => resendReceptionInvite(invitation)} className="rounded-lg border border-brand-border p-2 text-muted-foreground hover:border-brand-gold hover:text-brand-gold" aria-label="Gerar novo convite para recepcionista" title="Gerar novo convite">
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        )}
                        <button type="button" onClick={() => revokeInvite(invitation)} className="rounded-lg border border-destructive/20 p-2 text-destructive hover:bg-destructive/10" aria-label={`Revogar convite de ${invitation.email || invitation.phone || 'profissional'}`} title="Revogar convite">
                          <Ban className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          disabled={deletingInvitationId !== null}
                          aria-label={`Excluir convite de ${invitation.phone || invitation.email}`}
                          title="Excluir do histórico"
                          className="rounded-lg border border-destructive/20 p-2 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir convite de {invitation.phone || invitation.email}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            O registro será removido permanentemente do histórico. Se o convite ainda estiver pendente, o link deixará de funcionar. Essa ação não pode ser desfeita.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-brand-bg border-brand-border">Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={deletingInvitationId !== null}
                            onClick={() => void deleteInvite(invitation)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Excluir convite
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{Array.from({length: 6}).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}</div>
      ) : professionals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-brand-surface rounded-2xl border border-brand-border">
          <Users className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Nenhum profissional cadastrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {professionals.map(p => {
            const contact = contactsForProfessional(p.id);
            return (
            <div key={p.id} className={`bg-brand-surface border rounded-2xl p-5 flex flex-col ${!p.isActive ? 'border-brand-border/50 opacity-75' : 'border-brand-border hover:border-brand-gold/30'} transition-all ${recentlyAddedProfessionalIds.has(p.id) ? 'bm-list-item-enter' : ''}`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: p.color }}>
                    {p.initials}
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground text-lg leading-tight">{p.name}</h3>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-brand-bg border border-brand-border capitalize inline-block mt-1 text-muted-foreground">
                      {config.roles.find(role => role.key === p.role)?.label ?? p.role}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${p.isActive ? 'bg-success shadow-[0_0_8px_var(--color-success)]' : 'bg-muted-foreground'}`} title={p.isActive ? 'Ativo' : 'Inativo'} />
                </div>
              </div>

              {(contact.phone || contact.email) && (
                <div role="group" aria-label={`Contatos de ${p.name}`} className="mb-4 flex min-w-0 flex-col gap-2">
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
                      aria-label={`Telefone de ${p.name}: ${contact.phone}`}
                      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Phone aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{contact.phone}</span>
                    </a>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${encodeURIComponent(contact.email)}`}
                      aria-label={`E-mail de ${p.name}: ${contact.email}`}
                      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  )}
                </div>
              )}

              <div className="flex-1 bg-brand-bg rounded-xl p-3 border border-brand-border/50 mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Comissões Ativas</p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[11px] sm:text-[10px] bg-brand-gold/10 text-brand-gold px-2 py-1 rounded font-medium">
                    Serviço: {Math.round(PROFESSIONAL_SERVICE_COMMISSION_RATE * 100)}% profissional / 50% salão
                  </span>
                  {PROFESSIONAL_SALES_COMMISSION_FIELDS.filter(({ key }) => p.commissions[key] > 0).map(({ key, label }) => (
                    <span key={key} className="text-[11px] sm:text-[10px] bg-brand-gold/10 text-brand-gold px-2 py-1 rounded font-medium">
                      Venda de {label}: {Math.round(p.commissions[key] * 100)}%
                    </span>
                  ))}
                  {PROFESSIONAL_SALES_COMMISSION_FIELDS.every(({ key }) => p.commissions[key] === 0) && (
                    <span className="text-xs text-muted-foreground italic">Nenhuma comissão de venda configurada</span>
                  )}
                </div>
              </div>

              <div className="flex justify-between mt-auto pt-4 border-t border-brand-border">
                <button onClick={() => updateProfessional(p.id, { isActive: !p.isActive })} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  {p.isActive ? 'Desativar' : 'Reativar'}
                </button>
                 <div className="flex gap-2">
                   {isManager && !activeEmailInvitationFor(p.id) && (
                     <button onClick={() => openInvite(p)} aria-label={`Convidar ${p.name}`} title="Convidar para a equipe" className="p-2 text-brand-gold hover:bg-brand-gold/10 rounded-lg transition-all hover:scale-105"><UserPlus className="w-4 h-4" /></button>
                   )}
                  <button onClick={() => handleOpenEdit(p)} aria-label={`Editar ${p.name}`} className="p-2 text-muted-foreground hover:text-foreground hover:bg-brand-bg rounded-lg transition-all hover:scale-105"><Edit2 className="w-4 h-4" /></button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><button disabled={deletingId !== null} aria-label={`Excluir ${p.name}`} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-all hover:scale-105 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button></AlertDialogTrigger>
                    <AlertDialogContent className="bg-brand-surface border-brand-border text-foreground">
                      <AlertDialogHeader><AlertDialogTitle>Excluir {p.name}?</AlertDialogTitle><AlertDialogDescription>Atendimentos, vendas e valores serão preservados, mas ficarão sem profissional vinculado. O acesso da conta vinculada será desativado e os convites serão revogados. A exclusão não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel className="bg-brand-bg border-brand-border">Cancelar</AlertDialogCancel><AlertDialogAction disabled={deletingId !== null} onClick={() => void handleDelete(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir profissional</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="bg-brand-surface border-brand-border text-foreground max-w-lg">
          <DialogHeader><DialogTitle>{inviteRole === 'recepcao' ? 'Convidar Recepcionista' : `Convidar ${inviteProfessional?.name}`}</DialogTitle></DialogHeader>
          {!generatedLink ? (
            <form onSubmit={createInvite} className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                {inviteRole === 'recepcao'
                  ? 'A recepção terá acesso à Agenda, ao Controle Diário e aos Clientes, sem ser cadastrada como profissional.'
                  : 'O papel será definido pelo cargo cadastrado. A pessoa deverá usar o e-mail que recebeu o convite.'}
              </p>
              <div>
                <label htmlFor="invite-email" className="text-xs font-semibold text-muted-foreground uppercase">E-mail da pessoa convidada</label>
                <input id="invite-email" type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} autoComplete="email" placeholder="profissional@email.com" className="mt-1 w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-gold" />
              </div>
              <div className="rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5">
                <label className="flex gap-2 text-xs leading-5 text-muted-foreground">
                  <input type="checkbox" checked={inviteConsent} onChange={event => setInviteConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-brand-gold" />
                    <span>Confirmo que a pessoa autorizou o contato e que o convite será enviado para este e-mail.</span>
                </label>
              </div>
              <button type="submit" disabled={inviteLoading} className="w-full rounded-lg bg-brand-gold py-3 font-bold text-brand-bg disabled:opacity-60">
                {inviteLoading ? 'Criando e enviando...' : 'Criar e enviar convite'}
              </button>
            </form>
          ) : (
            <div className="space-y-4 pt-4">
              <div className={`rounded-xl border p-4 text-sm ${
                inviteDeliveryStatus === 'failed'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : inviteDeliveryStatus === 'sent'
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold'
              }`}>
                {inviteDeliveryStatus === 'sent'
                  ? `O Resend aceitou o envio para ${inviteEmail.trim()}. Peça ao profissional para conferir também o spam.`
                  : inviteDeliveryStatus === 'failed'
                    ? `Convite criado, mas o e-mail não foi enviado: ${inviteDeliveryError}`
                    : 'Criando o convite e enviando o e-mail...'}
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-bg p-2">
                <input readOnly value={generatedLink} aria-label="Link do convite" className="min-w-0 flex-1 bg-transparent px-2 text-xs text-muted-foreground outline-none" />
                <button type="button" onClick={() => navigator.clipboard.writeText(generatedLink).then(() => toast.success('Link copiado.')).catch(() => toast.error('Não foi possível copiar o link.'))} className="rounded-lg bg-brand-gold p-2 text-brand-bg" aria-label="Copiar link do convite" title="Copiar link">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              {inviteDeliveryStatus === 'failed' && (
                <button type="button" onClick={() => void sendInvitationEmail()} disabled={inviteSendLoading || !inviteConsent} className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-border py-3 text-sm font-semibold hover:border-brand-gold hover:text-brand-gold disabled:opacity-50">
                  <Mail className="h-4 w-4" /> {inviteSendLoading ? 'Enviando...' : 'Tentar enviar novamente'}
                </button>
              )}
              <FeatureInfo label="Compartilhar convite">Se o envio automático falhar, copie e compartilhe o link do convite manualmente.</FeatureInfo>
              <button type="button" onClick={() => setInviteOpen(false)} className="w-full rounded-lg border border-brand-border py-3 text-sm font-semibold hover:border-brand-gold hover:text-brand-gold">Fechar</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
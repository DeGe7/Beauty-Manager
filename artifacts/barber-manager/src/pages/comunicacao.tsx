import { useEffect, useMemo, useState } from 'react';
import { useStore, Client } from '@/data/store';
import { FeatureInfo } from '@/components/FeatureInfo';
import { api, CommunicationChannel, CommunicationSend } from '@/data/api';
import { useAuth } from '@/auth/auth';
import { toast } from 'sonner';
import { Megaphone, MessageSquare, Copy, Users, CalendarDays, Clock3, Mail, Send, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';

type CampaignId = 'anuncios' | 'churn' | 'aniversarios';

const CAMPAIGNS: { id: CampaignId; label: string; description: string; icon: typeof Megaphone }[] = [
  { id: 'anuncios', label: 'Leads de anúncio', description: 'Pessoas que chegaram por anúncio e ainda precisam de contato.', icon: Megaphone },
  { id: 'churn', label: 'Inativos há mais de 21 dias', description: 'Clientes que já vieram e estão sem retornar.', icon: Clock3 },
  { id: 'aniversarios', label: 'Aniversariantes da semana', description: 'Clientes que fazem aniversário entre segunda e domingo.', icon: CalendarDays },
];

const DEFAULT_MESSAGES: Record<CampaignId, string> = {
  anuncios: 'Olá, {nome}! Vi que você veio pelo nosso anúncio. Posso te ajudar a encontrar o melhor horário para conhecer a {empresa}?',
  churn: 'Olá, {nome}! Sentimos sua falta na {empresa}. Já faz um tempinho desde sua última visita. Que tal agendar seu próximo atendimento?',
  aniversarios: 'Olá, {nome}! A equipe da {empresa} deseja um feliz aniversário. Venha comemorar com a gente e aproveite para cuidar do seu visual!',
};

function dateAtMidnight(value: string) {
  return new Date(`${value}T00:00:00`);
}

function daysSinceLastVisit(client: Client, today: Date) {
  const lastVisit = client.visits.length
    ? [...client.visits].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;
  return lastVisit ? Math.floor((today.getTime() - dateAtMidnight(lastVisit).getTime()) / 86400000) : null;
}

function isBirthdayThisWeek(birthday: string | undefined, today: Date) {
  if (!birthday) return false;
  const birthdayDate = dateAtMidnight(birthday);
  const start = new Date(today);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const thisYearBirthday = new Date(today.getFullYear(), birthdayDate.getMonth(), birthdayDate.getDate());
  return thisYearBirthday >= start && thisYearBirthday <= end;
}

function channelLabel(channel: CommunicationChannel) {
  return channel === 'whatsapp' ? 'WhatsApp' : 'e-mail';
}

function recipientAddress(client: Client, channel: CommunicationChannel) {
  return channel === 'whatsapp' ? client.whatsapp.trim() : client.email.trim();
}

function isValidRecipient(client: Client, channel: CommunicationChannel) {
  const address = recipientAddress(client, channel);
  return channel === 'whatsapp'
    ? address.replace(/\D/g, '').length >= 10
    : /^\S+@\S+\.\S+$/.test(address);
}

function communicationUrl(channel: CommunicationChannel, address: string, message: string, subject: string) {
  if (channel === 'whatsapp') {
    const digits = address.replace(/\D/g, '');
    const phone = digits.startsWith('55') ? digits : `55${digits}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

function formatHistoryDate(value: string) {
  if (!value) return 'agora';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'agora' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function Comunicacao() {
  const { clients, config, isLoading } = useStore();
  const { profile, viewAsProfile } = useAuth();
  const isManager = (viewAsProfile ?? profile)?.role === 'gestor' || (viewAsProfile ?? profile)?.role === 'dev-admin';
  const [activeCampaign, setActiveCampaign] = useState<CampaignId>('anuncios');
  const [messages, setMessages] = useState(DEFAULT_MESSAGES);
  const [channel, setChannel] = useState<CommunicationChannel>('whatsapp');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<CommunicationSend[]>([]);
  const [historyError, setHistoryError] = useState('');

  const today = new Date();
  const companyName = config.name || 'nossa barbearia';

  const audiences = useMemo<Record<CampaignId, Client[]>>(() => ({
    anuncios: clients.filter(client => client.source === 'Anúncio' || client.sourceOther?.toLowerCase().includes('anúncio')),
    churn: clients.filter(client => {
      const days = daysSinceLastVisit(client, today);
      return days !== null && days > 21;
    }),
    aniversarios: clients.filter(client => isBirthdayThisWeek(client.birthday, today)),
  }), [clients]);

  const campaign = CAMPAIGNS.find(item => item.id === activeCampaign)!;
  const audience = audiences[activeCampaign];
  const message = messages[activeCampaign];
  const previewMessage = (client: Client) => message.replaceAll('{nome}', client.name).replaceAll('{empresa}', companyName);
  const eligibleAudience = useMemo(
    () => audience.filter(client => isValidRecipient(client, channel)),
    [audience, channel],
  );

  const deleteSend = async (item: CommunicationSend) => {
    if (!window.confirm(`Excluir o registro de envio para ${item.recipientName}?`)) return;
    try {
      const deleted = await api.history.deleteItem('communication_send', item.id);
      if (!deleted) throw new Error('Este registro não foi encontrado.');
      setHistory(current => current.filter(record => record.id !== item.id));
      toast.success('Registro de envio excluído.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível excluir o registro.');
    }
  };

  useEffect(() => {
    let cancelled = false;
    void api.communication.list()
      .then(records => {
        if (!cancelled) setHistory(records);
      })
      .catch(error => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Histórico indisponível.');
      });
    return () => { cancelled = true; };
  }, []);

  const copyBatch = async () => {
    const payload = {
      campaign: activeCampaign,
      campaignLabel: campaign.label,
      generatedAt: new Date().toISOString(),
      messageTemplate: message,
      recipients: audience.map(client => ({
        id: client.id,
        name: client.name,
        whatsapp: client.whatsapp,
        message: previewMessage(client),
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success(`${audience.length} destinatário(s) copiado(s) para o n8n`);
    } catch {
      toast.error('Não foi possível copiar o lote. Verifique a permissão do navegador.');
    }
  };

  const sendRecipient = async (client: Client, showToast = true) => {
    const address = recipientAddress(client, channel);
    if (!isValidRecipient(client, channel)) {
      if (showToast) toast.error(`${client.name} não tem ${channelLabel(channel)} válido cadastrado.`);
      return false;
    }

    let record: CommunicationSend;
    try {
      record = await api.communication.log({
        channel,
        kind: 'campaign',
        campaignId: activeCampaign,
        campaignLabel: campaign.label,
        recipientId: client.id,
        recipientName: client.name,
        recipientAddress: address,
        message: previewMessage(client),
        status: 'initiated',
      });
    } catch (error) {
      if (showToast) toast.error(error instanceof Error ? error.message : 'Não foi possível registrar o envio.');
      return false;
    }

    setHistory(current => [record, ...current.filter(item => item.id !== record.id)]);
    const opened = Boolean(window.open(
      communicationUrl(channel, address, previewMessage(client), `${campaign.label} — ${companyName}`),
      '_blank',
      'noopener,noreferrer',
    ));
    if (!opened) {
      const reason = 'O navegador bloqueou a abertura do canal de envio.';
      try {
        const failed = await api.communication.markFailed(record.id, reason);
        setHistory(current => current.map(item => item.id === failed.id ? failed : item));
      } catch {
        setHistory(current => current.map(item => item.id === record.id ? { ...item, status: 'failed', failureReason: reason } : item));
      }
      if (showToast) toast.error(`${channelLabel(channel)} bloqueado pelo navegador. Permita pop-ups e tente novamente.`);
      return false;
    }
    return true;
  };

  const sendCampaign = async () => {
    if (!consentConfirmed) {
      toast.error('Confirme o consentimento antes de iniciar o disparo.');
      return;
    }
    if (!eligibleAudience.length) {
      toast.error(`Nenhum contato tem ${channelLabel(channel)} válido cadastrado.`);
      return;
    }
    setIsSending(true);
    let started = 0;
    let failed = audience.length - eligibleAudience.length;
    try {
      for (const client of eligibleAudience) {
        if (await sendRecipient(client, false)) started += 1;
        else failed += 1;
      }
      if (failed) {
        toast.warning(`${started} envio(s) encaminhado(s) e ${failed} falha(s). Consulte o histórico.`);
      } else {
        toast.success(`${started} envio(s) encaminhado(s) por ${channelLabel(channel)}.`);
      }
      setConsentConfirmed(false);
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) return <div role="status" className="mx-auto max-w-7xl p-4 sm:p-5 md:p-8"><div className="h-8 w-48 animate-pulse rounded-lg bg-brand-border/50" /><div className="mt-5 grid gap-3 md:grid-cols-3">{CAMPAIGNS.map(item => <div key={item.id} className="h-28 animate-pulse rounded-2xl bg-brand-border/30" />)}</div><p className="sr-only">Carregando comunicação...</p></div>;

  return (
    <div className="p-4 sm:p-5 md:p-8 space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start gap-3 border-b border-brand-border pb-4 sm:gap-4 sm:pb-6">
        <div className="hidden sm:block p-3 rounded-xl bg-brand-surface border border-brand-border text-brand-gold"><MessageSquare className="w-6 h-6" /></div>
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-2xl font-bold">Disparos de Mensagens</h2>
            <FeatureInfo label="Disparos de mensagens">Prepare campanhas por público e encaminhe mensagens pelo WhatsApp ou e-mail.</FeatureInfo>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {CAMPAIGNS.map(item => {
          const Icon = item.icon;
          const selected = item.id === activeCampaign;
          return (
            <div key={item.id} className={`rounded-xl border p-4 transition-colors ${selected ? 'border-brand-gold bg-brand-gold/10' : 'border-brand-border bg-brand-surface hover:border-brand-gold/50'}`}>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setActiveCampaign(item.id)} aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-brand-gold' : 'text-muted-foreground'}`} />
                  <p className={`truncate font-bold ${selected ? 'text-brand-gold' : 'text-foreground'}`}>{item.label}</p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`text-2xl font-bold ${selected ? 'text-brand-gold' : 'text-foreground'}`}>{audiences[item.id].length}</span>
                  <FeatureInfo label={item.label}>{item.description}</FeatureInfo>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
        <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-lg font-bold">Mensagem da campanha</h3>
                <FeatureInfo label="Personalizar mensagem">Use {'{nome}'} e {'{empresa}'} para inserir automaticamente o nome do contato e o nome do estabelecimento.</FeatureInfo>
              </div>
            </div>
            <Megaphone className="w-5 h-5 text-brand-gold" />
          </div>
          <textarea value={message} onChange={event => setMessages(current => ({ ...current, [activeCampaign]: event.target.value }))} className="w-full min-h-36 resize-y bg-brand-bg border border-brand-border rounded-lg px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-brand-gold" />
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
            <div>
              <label htmlFor="campaign-channel" className="text-xs font-semibold text-muted-foreground uppercase">Canal</label>
              <select id="campaign-channel" value={channel} onChange={event => setChannel(event.target.value as CommunicationChannel)} className="mt-1 w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-brand-gold">
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>
            </div>
            <div className="flex items-end rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5">
              <label className="flex gap-2 text-xs leading-5 text-muted-foreground">
                <input type="checkbox" checked={consentConfirmed} onChange={event => setConsentConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-brand-gold" />
                <span>Confirmo que estes contatos autorizaram o recebimento desta comunicação.</span>
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={sendCampaign} disabled={isSending || !eligibleAudience.length || !consentConfirmed} className="flex items-center justify-center gap-2 bg-brand-gold text-brand-bg font-bold py-2.5 rounded-lg disabled:opacity-40">
              <Send className="w-4 h-4" /> {isSending ? 'Abrindo canais...' : `Enviar por ${channelLabel(channel)}`}
            </button>
            <button type="button" onClick={copyBatch} disabled={!audience.length} className="flex items-center justify-center gap-2 border border-brand-border text-foreground font-bold py-2.5 rounded-lg hover:border-brand-gold hover:text-brand-gold disabled:opacity-40">
              <Copy className="w-4 h-4" /> Copiar lote para o n8n
            </button>
          </div>
          <div className="flex justify-end">
            <FeatureInfo label="Envio da campanha">O Beauty Manager abre o WhatsApp ou o aplicativo de e-mail com a mensagem preenchida. Confirme o envio no canal aberto; o início e eventuais bloqueios ficam registrados.</FeatureInfo>
          </div>
        </section>

        <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-brand-border/50 pb-4">
            <div>
              <h3 className="text-lg font-bold">{campaign.label}</h3>
              <p className="text-xs text-muted-foreground mt-1">{audience.length} contato(s) encontrado(s) • {eligibleAudience.length} com {channelLabel(channel)} válido</p>
            </div>
            <Users className="w-5 h-5 text-brand-gold" />
          </div>
          {audience.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nenhum cliente encontrado para esta campanha.</div>
          ) : (
            <div className="max-h-[460px] overflow-y-auto space-y-2">
              {audience.map(client => (
                <div key={client.id} className="flex items-center gap-3 bg-brand-bg border border-brand-border rounded-lg p-3">
                  <div className="w-9 h-9 rounded-full bg-brand-gold/15 text-brand-gold flex items-center justify-center font-bold text-sm">{client.name.charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {recipientAddress(client, channel) || `Sem ${channelLabel(channel)} cadastrado`}
                      {recipientAddress(client, channel) && !isValidRecipient(client, channel) ? ' • inválido' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => sendRecipient(client)} disabled={isSending || !isValidRecipient(client, channel) || !consentConfirmed} className="rounded-lg p-2 text-brand-gold hover:bg-brand-gold/10 disabled:opacity-30" title={`Enviar por ${channelLabel(channel)}`} aria-label={`Enviar mensagem para ${client.name}`}>
                      <Send className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(previewMessage(client)).then(() => toast.success('Mensagem copiada')).catch(() => toast.error('Não foi possível copiar a mensagem.'))} className="p-2 text-muted-foreground hover:text-brand-gold" title="Copiar mensagem" aria-label={`Copiar mensagem para ${client.name}`}>
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="bg-brand-surface border border-brand-border rounded-2xl p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-brand-border/50 pb-4">
          <div>
              <div className="flex items-center gap-1">
                <h3 className="text-lg font-bold">Histórico de envios</h3>
                <FeatureInfo label="Histórico de envios">Registra quando o canal foi aberto e quando o navegador bloqueou a tentativa.</FeatureInfo>
              </div>
          </div>
          <Mail className="w-5 h-5 text-brand-gold" />
        </div>
        {historyError ? (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{historyError}</div>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum envio registrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {history.slice(0, 8).map(item => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border border-brand-border bg-brand-bg p-3">
                <div className={`rounded-lg p-2 ${item.status === 'initiated' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  {item.status === 'initiated' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.recipientName} <span className="font-normal text-muted-foreground">• {channelLabel(item.channel)}</span></p>
                  <p className="truncate text-xs text-muted-foreground">{item.status === 'initiated' ? 'Canal aberto para confirmação do envio' : item.failureReason || 'Falha ao abrir o canal'} • {formatHistoryDate(item.createdAt)}</p>
                </div>
                {isManager && (
                  <button type="button" onClick={() => void deleteSend(item)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={`Excluir histórico de envio para ${item.recipientName}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
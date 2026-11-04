import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import CaptchaChallenge, { captchaRequired } from '@/auth/captcha';
import { isAuthRateLimitError, useAuthRateLimit } from '@/auth/rate-limit';
import { CircleAlert, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { api, type PublicInvitationInfo } from '@/data/api';
import { BrandMark } from '@/components/BrandMark';

export default function Cadastro() {
  const [, setLocation] = useLocation();
  const { signUp, acceptInvitation } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('convite') || '';
  const [invitationInfo, setInvitationInfo] = useState<PublicInvitationInfo | null>(null);
  const [validatingInvitation, setValidatingInvitation] = useState(Boolean(inviteToken));
  const [invitationError, setInvitationError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const { isCoolingDown, remainingSeconds, startCooldown } = useAuthRateLimit();

  useEffect(() => {
    if (!inviteToken) {
      setInvitationInfo(null);
      setValidatingInvitation(false);
      return;
    }
    let active = true;
    setValidatingInvitation(true);
    setInvitationError('');
    api.invitations.preview(inviteToken)
      .then(info => {
        if (!active) return;
        setInvitationInfo(info);
        if (!info.valid) setInvitationError('Este convite é inválido, expirou, foi revogado ou já foi utilizado.');
      })
      .catch(error => {
        if (!active) return;
        setInvitationInfo(null);
        setInvitationError(error instanceof Error ? error.message : 'Não foi possível validar o convite.');
      })
      .finally(() => {
        if (active) setValidatingInvitation(false);
      });
    return () => { active = false; };
  }, [inviteToken]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password || !confirmation) {
      toast.error('Preencha todos os campos.');
      return;
    }
    if (name.trim().split(/\s+/).length < 2) {
      toast.error('Informe nome e sobrenome.');
      return;
    }
    if (password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmation) {
      toast.error('As senhas não coincidem.');
      return;
    }
    if (captchaRequired && !captchaToken) {
      toast.error('Conclua a verificação antiabuso.');
      return;
    }
    if (isCoolingDown) {
      toast.error(`Aguarde ${remainingSeconds}s antes de tentar novamente.`);
      return;
    }
    setLoading(true);
    try {
      const { needsEmailConfirmation } = await signUp(name, email, password, captchaToken, inviteToken);
      if (needsEmailConfirmation) {
        toast.success(inviteToken
          ? 'Conta criada. Confira seu e-mail para confirmar o cadastro.'
          : 'Conta criada. Confirme seu e-mail, entre e solicite acesso à equipe para aprovação.');
        setLocation(inviteToken ? `/login?convite=${encodeURIComponent(inviteToken)}` : '/login');
      } else {
        if (inviteToken) await acceptInvitation(inviteToken);
        toast.success('Conta criada com sucesso!');
        setLocation('/dashboard');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a conta.');
      if (isAuthRateLimitError(error)) startCooldown();
    } finally {
      setLoading(false);
    }
  };

  const loginHref = inviteToken
    ? `/login?convite=${encodeURIComponent(inviteToken)}`
    : '/login';

  if (!inviteToken) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-brand-border bg-brand-surface p-5 text-center shadow-2xl sm:p-8">
          <BrandMark className="mx-auto h-12 w-12" />
          <h1 className="text-2xl font-bold text-foreground">Cadastro somente por convite</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Para proteger a empresa, a criação de conta exige um convite válido. Profissionais novos podem solicitar autorização sem criar uma conta.
          </p>
          <Link href="/solicitar-acesso" className="inline-flex w-full justify-center rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg">
            Solicitar autorização
          </Link>
          <Link href="/login" className="inline-flex justify-center text-sm text-brand-gold hover:underline">Já tenho uma conta</Link>
        </div>
      </div>
    );
  }

  if (validatingInvitation) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg p-5 text-center text-sm text-muted-foreground">
        Validando o convite...
      </div>
    );
  }

  if (!invitationInfo?.valid || invitationInfo.channel === 'phone') {
    const legacyPhoneInvitation = invitationInfo?.channel === 'phone';
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-brand-border bg-brand-surface p-5 text-center shadow-2xl sm:p-8">
          <CircleAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Convite não disponível</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {legacyPhoneInvitation
              ? 'Convites por telefone foram desativados. Peça ao Gestor/Proprietário para gerar um novo convite pelo seu e-mail.'
              : invitationError || 'Este convite é inválido, expirou, foi revogado ou já foi utilizado.'}
          </p>
          <Link href="/login" className="inline-flex w-full justify-center rounded-lg border border-brand-border px-5 py-3 text-sm font-semibold text-foreground">
            Ir para o login
          </Link>
          <Link href="/solicitar-acesso" className="inline-flex justify-center text-sm text-brand-gold hover:underline">
            Solicitar autorização
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-4 py-8">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-gold/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="w-full max-w-md bg-brand-surface border border-brand-border rounded-2xl shadow-2xl overflow-hidden relative z-10">
        <div className="border-b border-brand-border bg-brand-bg/30 p-5 text-center sm:p-8">
          <BrandMark className="mx-auto mb-5 h-16 w-16" />
          <h1 className="text-2xl font-bold text-foreground">Criar sua conta</h1>
          <p className="text-sm text-muted-foreground mt-2">Comece a gerenciar seu estabelecimento</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
          {inviteToken && (
            <div className="rounded-lg border border-brand-gold/30 bg-brand-gold/10 p-3 text-sm text-brand-gold">
              Você está se cadastrando a partir de um convite para uma equipe existente.
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="signup-name" className="text-sm font-medium text-foreground">Nome e sobrenome</label>
            <input id="signup-name" type="text" value={name} onChange={event => setName(event.target.value)} autoComplete="name" required className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold text-foreground" placeholder="Seu nome completo" />
          </div>
          <div className="space-y-2">
            <label htmlFor="signup-email" className="flex items-center gap-2 text-sm font-medium text-foreground"><Mail className="h-4 w-4" /> E-mail</label>
            <input id="signup-email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold text-foreground" placeholder="seu@email.com" />
          </div>
          <div className="space-y-2">
            <label htmlFor="signup-password" className="text-sm font-medium text-foreground">Senha</label>
            <input id="signup-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold text-foreground" placeholder="Mínimo de 6 caracteres" />
          </div>
          <div className="space-y-2">
            <label htmlFor="signup-confirmation" className="text-sm font-medium text-foreground">Confirmar senha</label>
            <input id="signup-confirmation" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" required className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold text-foreground" placeholder="Repita sua senha" />
          </div>
          <CaptchaChallenge key={captchaKey} onTokenChange={setCaptchaToken} />
          <button type="submit" disabled={loading || isCoolingDown} className="w-full bg-brand-gold text-brand-bg font-bold py-3 px-4 rounded-lg hover:bg-brand-gold/90 transition-all disabled:opacity-50">{loading ? 'Cadastrando...' : isCoolingDown ? `Aguarde ${remainingSeconds}s` : 'Cadastrar'}</button>
          <p className="text-center text-sm text-muted-foreground pt-2">Já tem uma conta? <Link href={loginHref} className="text-brand-gold hover:underline">Entrar</Link></p>
        </form>
      </div>
    </div>
  );
}
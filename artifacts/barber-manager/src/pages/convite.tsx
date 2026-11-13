import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Building2, CheckCircle2, CircleAlert, Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth';
import { api } from '@/data/api';
import CaptchaChallenge, { captchaRequired } from '@/auth/captcha';
import { BrandMark } from '@/components/BrandMark';
import { isAuthRateLimitError, useAuthRateLimit } from '@/auth/rate-limit';

function invitationToken(): string {
  return decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
}

export default function Convite() {
  const [, setLocation] = useLocation();
  const { session, profile, acceptInvitation, signUp, signOut } = useAuth();
  const [status, setStatus] = useState<'validating' | 'ready' | 'accepting' | 'error'>('validating');
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'invitation' | 'account' | 'confirmation'>('invitation');
  const [invitationInfo, setInvitationInfo] = useState<Awaited<ReturnType<typeof api.invitations.preview>> | null>(null);
  const [password, setPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [showExistingAccountLogin, setShowExistingAccountLogin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const { isCoolingDown, remainingSeconds, startCooldown } = useAuthRateLimit();
  const token = invitationToken();
  const loginHref = `/login?convite=${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;
    api.invitations.preview(token)
      .then(info => {
        if (!active) return;
        if (!info.valid) {
          setError(info.status === 'expired'
            ? 'Este convite expirou. Peça ao gestor que gere um novo link.'
            : info.status === 'revoked'
              ? 'Este convite foi revogado. Peça ao gestor que gere um novo link.'
              : info.status === 'used'
                ? 'Este convite já foi utilizado.'
                : 'O convite não existe ou não é válido.');
          setStatus('error');
          return;
        }
        if (info.channel === 'phone') {
          setError('Este convite por telefone foi desativado. Peça ao Gestor/Proprietário para gerar um novo convite pelo seu e-mail.');
          setStatus('error');
          return;
        }
        if (!info.email || !info.organizationName || !info.professionalName) {
          setError('Não foi possível carregar os dados deste convite. Peça ao gestor para verificar a configuração e gerar um novo link.');
          setStatus('error');
          return;
        }
        setInvitationInfo(info);
        setStatus('ready');
      })
      .catch(previewError => {
        if (!active) return;
        setError(previewError instanceof Error ? previewError.message : 'Não foi possível validar o convite.');
        setStatus('error');
      });
    return () => { active = false; };
  }, [token]);

  const acceptAndEnter = async () => {
    setStatus('accepting');
    setError('');
    try {
      await acceptInvitation(token);
      toast.success('Convite aceito. Bem-vindo à equipe!');
      setLocation('/');
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Não foi possível aceitar o convite.');
      setStatus('error');
    }
  };

  const continueFromInvitation = async () => {
    if (!invitationInfo?.email) return;
    if (session) {
      if (!profile) {
        setError('Aguarde a validação do seu acesso e tente novamente.');
        setStatus('error');
        return;
      }
      if (session.user.email?.trim().toLowerCase() !== invitationInfo.email.trim().toLowerCase()) {
        setError('Você está conectado com outro e-mail. Saia da conta e abra o convite novamente.');
        setStatus('error');
        return;
      }
      await acceptAndEnter();
      return;
    }
    setSignupError('');
    setShowExistingAccountLogin(false);
    setStage('account');
  };

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invitationInfo?.email || !invitationInfo.professionalName) return;
    if (password.length < 6) {
      setSignupError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (captchaRequired && !captchaToken) {
      setSignupError('Conclua a verificação antiabuso.');
      return;
    }
    if (isCoolingDown) {
      setSignupError(`Aguarde ${remainingSeconds}s antes de tentar novamente.`);
      return;
    }

    setIsSubmitting(true);
    setSignupError('');
    try {
      const result = await signUp(
        invitationInfo.professionalName,
        invitationInfo.email,
        password,
        captchaToken,
        token,
      );
      if (result.needsEmailConfirmation) {
        setStage('confirmation');
        return;
      }
      await acceptInvitation(token);
      toast.success('Conta criada e convite aceito. Bem-vindo à equipe!');
      setLocation('/');
    } catch (signupFailure) {
      const message = signupFailure instanceof Error ? signupFailure.message : 'Não foi possível criar sua conta.';
      setSignupError(message);
      setShowExistingAccountLogin(/já possui uma conta|já está cadastrado/i.test(message));
      if (isAuthRateLimitError(signupFailure)) startCooldown();
      setCaptchaToken(null);
      setCaptchaKey(current => current + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOutAndRetry = async () => {
    try {
      await signOut();
      setError('');
      setStatus('ready');
    } catch {
      setError('Não foi possível sair da conta atual. Tente novamente.');
    }
  };

  if (status === 'validating' || status === 'accepting') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg p-5 text-center">
        <div className="space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-gold" />
          <h1 className="text-xl font-bold text-foreground">{status === 'accepting' ? 'Vinculando sua conta' : 'Validando convite'}</h1>
          <p className="text-sm text-muted-foreground">{status === 'accepting' ? 'Confirmando o acesso à equipe...' : 'Verificando se o link ainda está válido...'}</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
        <div className="w-full max-w-md space-y-5 rounded-2xl border border-brand-border bg-brand-surface p-5 text-center sm:p-8">
          <CircleAlert className="mx-auto h-12 w-12 text-destructive" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Convite não disponível</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
          {session && /outro e-mail/i.test(error) ? (
            <button type="button" onClick={() => void signOutAndRetry()} className="inline-flex rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg">
              Sair e continuar
            </button>
          ) : (
            <Link href={loginHref} className="inline-flex rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg" data-testid="link-invitation-login">
              Ir para o login
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (stage === 'confirmation' && invitationInfo) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
        <section className="w-full max-w-md space-y-5 rounded-2xl border border-brand-border bg-brand-surface p-5 text-center sm:p-8">
          <Mail className="mx-auto h-12 w-12 text-brand-gold" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-gold">Beauty Manager</p>
            <h1 className="mt-3 text-2xl font-bold text-foreground">Confirme seu e-mail</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Enviamos a confirmação para <span className="font-medium text-foreground">{invitationInfo.email}</span>.
              Depois de confirmar, continue pelo link do convite para entrar em {invitationInfo.organizationName}.
            </p>
          </div>
          <Link href={loginHref} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-brand-border px-4 py-3 text-sm font-semibold text-foreground hover:border-brand-gold" data-testid="link-existing-account-login">
            Já tenho conta? Entrar
          </Link>
        </section>
      </div>
    );
  }

  if (stage === 'account' && invitationInfo) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-4 py-8">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,hsl(var(--brand-gold)/0.08),transparent_55%)]" />
        <section className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-2xl">
          <header className="border-b border-brand-border bg-brand-bg/30 p-5 text-center sm:p-8">
            <BrandMark className="mx-auto mb-4 h-16 w-16" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-gold">Beauty Manager</p>
            <h1 className="mt-2 text-2xl font-bold text-foreground">Criar seu acesso</h1>
            <p className="mt-2 text-sm text-muted-foreground">Convite para entrar em</p>
            <p className="mt-1 text-lg font-semibold text-brand-gold" data-testid="text-invited-company">{invitationInfo.organizationName}</p>
          </header>
          <form onSubmit={createAccount} className="space-y-4 p-5 sm:p-6">
            <button type="button" onClick={() => { setStage('invitation'); setSignupError(''); }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-gold" data-testid="button-back-to-invitation">
              <ArrowLeft className="h-4 w-4" /> Voltar ao convite
            </button>
            <div className="space-y-2">
              <label htmlFor="invitation-email" className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Mail className="h-4 w-4" /> E-mail do convite
              </label>
              <input
                id="invitation-email"
                name="email"
                type="email"
                value={invitationInfo.email}
                readOnly
                autoComplete="email"
                className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm text-muted-foreground"
                data-testid="input-invitation-email"
              />
              <p className="text-xs text-muted-foreground">Este e-mail foi autorizado pelo gestor e não pode ser alterado.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="invitation-password" className="text-sm font-medium text-foreground">Crie uma senha</label>
              <input
                id="invitation-password"
                name="password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                placeholder="Mínimo de 6 caracteres"
                className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm text-foreground outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                data-testid="input-invitation-password"
              />
            </div>
            <CaptchaChallenge key={captchaKey} onTokenChange={setCaptchaToken} />
            {signupError && (
              <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="alert-invitation-signup">
                <p>{signupError}</p>
                {showExistingAccountLogin && (
                  <Link href={loginHref} className="inline-flex font-semibold underline underline-offset-4" data-testid="link-login-existing-invitation">
                    Entrar com a conta existente
                  </Link>
                )}
              </div>
            )}
            <button
              type="submit"
              disabled={isSubmitting || isCoolingDown || (captchaRequired && !captchaToken)}
              className="min-h-12 w-full rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-brand-bg transition hover:bg-brand-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="button-create-invitation-account"
            >
              {isSubmitting ? 'Criando seu acesso...' : isCoolingDown ? `Aguarde ${remainingSeconds}s` : 'Criar conta e entrar'}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Já possui conta com este e-mail?{' '}
              <Link href={loginHref} className="font-medium text-brand-gold hover:underline" data-testid="link-login-from-invitation">
                Entre com sua senha atual
              </Link>
            </p>
          </form>
        </section>
      </div>
    );
  }

  if (!invitationInfo) return null;

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-4 py-8">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,hsl(var(--brand-gold)/0.08),transparent_55%)]" />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-brand-border bg-brand-surface shadow-2xl overflow-hidden">
        <div className="border-b border-brand-border bg-brand-bg/30 p-5 text-center sm:p-8">
          <BrandMark className="mx-auto mb-5 h-16 w-16" />
          <h1 className="text-2xl font-bold text-foreground">Convite para a equipe</h1>
          <p className="mt-2 text-sm text-muted-foreground">Você recebeu um convite para entrar em</p>
          <p className="mt-1 text-lg font-semibold text-brand-gold" data-testid="text-invitation-company">{invitationInfo.organizationName}</p>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex gap-3 rounded-xl border border-brand-border bg-brand-bg/60 p-4">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              O convite foi enviado para <span className="font-medium text-foreground">{invitationInfo.email}</span>. Use esse e-mail para criar seu acesso.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void continueFromInvitation()}
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-brand-bg transition hover:bg-brand-gold/90"
            data-testid="button-enter-invited-company"
          >
            Entrar em {invitationInfo.organizationName}
          </button>
          <p className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" /> O convite define seu papel com segurança.
          </p>
        </div>
      </div>
    </div>
  );
}
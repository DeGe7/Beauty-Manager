import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import CaptchaChallenge, { captchaRequired } from '@/auth/captcha';
import { isAuthRateLimitError, useAuthRateLimit } from '@/auth/rate-limit';
import { toast } from 'sonner';
import { BrandMark } from '@/components/BrandMark';

export default function Login() {
  const [, setLocation] = useLocation();
  const { signIn, acceptInvitation } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('convite') || '';
  const isLegacyPhoneInvitation = params.get('canal') === 'telefone';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { isCoolingDown, remainingSeconds, startCooldown } = useAuthRateLimit();
  const forgotParams = new URLSearchParams();
  if (inviteToken) forgotParams.set('convite', inviteToken);
  const forgotHref = forgotParams.toString() ? `/esqueci-senha?${forgotParams.toString()}` : '/esqueci-senha';
  const forgotLabel = inviteToken ? 'Criar ou recuperar minha senha' : 'Esqueci minha senha';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error('Preencha e-mail e senha.');
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
    setErrorMessage('');
    try {
      await signIn(identifier, password, captchaToken);
      if (inviteToken) await acceptInvitation(inviteToken);
      toast.success('Bem-vindo de volta!');
      setLocation('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível entrar.';
      setErrorMessage(message);
      toast.error(message);
      if (isAuthRateLimitError(error)) startCooldown();
    } finally {
      setLoading(false);
    }
  };

  if (isLegacyPhoneInvitation) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
        <section className="w-full max-w-md space-y-4 rounded-2xl border border-brand-border bg-brand-surface p-5 text-center shadow-2xl sm:p-8">
          <BrandMark className="mx-auto h-12 w-12" />
          <h1 className="text-2xl font-bold text-foreground">Convite por telefone desativado</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Peça ao Gestor/Proprietário para gerar um novo convite usando seu e-mail.
          </p>
          <Link href="/login" className="inline-flex w-full justify-center rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg">
            Voltar ao login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-4 py-8">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-gold/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md bg-brand-surface border border-brand-border rounded-2xl shadow-2xl overflow-hidden flex flex-col relative z-10">
        <div className="border-b border-brand-border bg-brand-bg/30 p-5 text-center sm:p-8">
          <BrandMark className="mx-auto mb-5 h-16 w-16" />
          <h1 className="text-2xl font-bold text-foreground">Beauty Manager</h1>
          <p className="text-sm text-muted-foreground mt-2">Sistema profissional de gestão</p>
        </div>
        
        <div className="p-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {inviteToken && (
              <div className="rounded-lg border border-brand-gold/30 bg-brand-gold/10 p-3 text-sm text-brand-gold">
                Convite por e-mail encontrado. Use o e-mail que recebeu o convite.
              </div>
            )}
            {errorMessage && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {errorMessage}
              </p>
            )}
            <div className="space-y-2">
              <label htmlFor="login-identifier" className="text-sm font-medium text-foreground">E-mail</label>
              <input 
                id="login-identifier"
                name="email"
                type="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="email"
                required
                className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
                placeholder="seu@email.com"
              />
            </div>
            
            <div className="space-y-2">
               <label htmlFor="password" className="text-sm font-medium text-foreground">Senha</label>
              <input 
                id="password"
                name="password"
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all"
                placeholder="••••••••"
              />
               <Link href={forgotHref} className="inline-block text-xs text-brand-gold hover:underline">{forgotLabel}</Link>
            </div>

            <CaptchaChallenge onTokenChange={setCaptchaToken} />
            <button 
              type="submit" 
              disabled={loading || isCoolingDown}
              className="w-full bg-brand-gold text-brand-bg font-bold py-3 px-4 rounded-lg hover:bg-brand-gold/90 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4 shadow-[0_0_15px_rgba(201,168,76,0.2)]"
            >
              {loading ? 'Entrando...' : isCoolingDown ? `Aguarde ${remainingSeconds}s` : 'Entrar'}
            </button>
          </form>
          <p className="text-center text-sm text-muted-foreground mt-6">
            {inviteToken ? (
              <>
                Ainda não tem uma conta?{' '}
                  <Link href={`/convite/${encodeURIComponent(inviteToken)}`} className="text-brand-gold hover:underline">
                    Criar meu acesso
                </Link>
                {' '}para aceitar o convite.
              </>
            ) : (
              <>
                É um novo profissional?{' '}
                <Link href="/solicitar-acesso" className="text-brand-gold hover:underline">
                  Solicite autorização
                </Link>
                {' '}e aguarde o convite para criar sua conta.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

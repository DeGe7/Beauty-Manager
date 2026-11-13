import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import CaptchaChallenge, { captchaRequired } from '@/auth/captcha';
import { isAuthRateLimitError, useAuthRateLimit } from '@/auth/rate-limit';
import { toast } from 'sonner';
import { BrandMark } from '@/components/BrandMark';

export default function EsqueciSenha() {
  const [, setLocation] = useLocation();
  const { requestPasswordReset } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('convite') || '';
  const loginHref = inviteToken
    ? `/login?convite=${encodeURIComponent(inviteToken)}`
    : '/login';
  const [email, setEmail] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { isCoolingDown, remainingSeconds, startCooldown } = useAuthRateLimit();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      toast.error('Informe seu e-mail.');
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
      await requestPasswordReset(email.trim(), captchaToken, inviteToken);
      setSent(true);
      toast.success('Se o e-mail estiver cadastrado, você receberá as instruções.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar a recuperação.');
      if (isAuthRateLimitError(error)) startCooldown();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-4 py-8">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-gold/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="w-full max-w-md bg-brand-surface border border-brand-border rounded-2xl shadow-2xl overflow-hidden relative z-10">
        <div className="border-b border-brand-border bg-brand-bg/30 p-5 text-center sm:p-8">
          <BrandMark className="mx-auto mb-5 h-16 w-16" />
          <h1 className="text-2xl font-bold text-foreground">Recuperar acesso</h1>
          <p className="text-sm text-muted-foreground mt-2">Enviaremos um link para criar uma nova senha.</p>
        </div>

        <div className="p-5 sm:p-6">
          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-brand-gold/30 bg-brand-gold/10 p-4 text-sm text-foreground">
                 {inviteToken
                   ? 'Se o endereço informado estiver cadastrado, enviaremos um link para criar ou redefinir a senha. Depois, o convite será retomado automaticamente. Confira também a pasta de spam.'
                   : 'Se o endereço informado estiver cadastrado, enviaremos um link de recuperação. Confira também a pasta de spam.'}
              </div>
              <button
                type="button"
                onClick={() => setLocation(loginHref)}
                className="w-full bg-brand-gold text-brand-bg font-bold py-3 px-4 rounded-lg hover:bg-brand-gold/90 transition-all"
              >
                Voltar para o login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="recovery-email" className="text-sm font-medium text-foreground">E-mail da conta</label>
                <input id="recovery-email" name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required className="w-full bg-brand-bg border border-brand-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold text-foreground placeholder:text-muted-foreground transition-all" placeholder="seu@email.com" />
              </div>
              <CaptchaChallenge key={captchaKey} onTokenChange={setCaptchaToken} />
              <button
                type="submit"
                disabled={loading || isCoolingDown}
                className="w-full bg-brand-gold text-brand-bg font-bold py-3 px-4 rounded-lg hover:bg-brand-gold/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                 {loading
                   ? 'Enviando...'
                   : isCoolingDown
                     ? `Aguarde ${remainingSeconds}s`
                     : inviteToken
                       ? 'Enviar link para criar ou redefinir senha'
                       : 'Enviar link de recuperação'}
              </button>
            </form>
          )}
          <p className="text-center text-sm text-muted-foreground mt-6">
            <Link href={loginHref} className="text-brand-gold hover:underline">Voltar para o login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
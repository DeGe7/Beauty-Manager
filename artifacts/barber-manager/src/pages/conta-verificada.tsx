import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { BadgeCheck, CircleAlert, LoaderCircle } from 'lucide-react';
import { useAuth } from '@/auth/auth';
import { supabase } from '@/services/supabaseClient';
import { BrandMark } from '@/components/BrandMark';

type ConfirmationState = 'checking' | 'verified' | 'error';

function readCallbackParams() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const get = (key: string) => query.get(key) || hash.get(key) || '';

  return {
    isSignupConfirmation: query.get('confirmacao') === 'email',
    invitationToken: query.get('convite') || '',
    hasCallbackError: Boolean(get('error') || get('error_code') || get('error_description')),
  };
}

export default function ContaVerificada() {
  const { loading, session } = useAuth();
  const [callback] = useState(readCallbackParams);
  const [state, setState] = useState<ConfirmationState>('checking');

  useEffect(() => {
    if (loading) return;

    let active = true;
    const fail = () => {
      if (active) setState('error');
    };

    if (!callback.isSignupConfirmation || callback.hasCallbackError || !session || !supabase) {
      fail();
      return () => {
        active = false;
      };
    }

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      const isVerified = Boolean(data.user?.email_confirmed_at || data.user?.confirmed_at);
      setState(!error && isVerified ? 'verified' : 'error');
    }).catch(fail);

    return () => {
      active = false;
    };
  }, [callback, loading, session]);

  const loginHref = callback.invitationToken
    ? `/login?convite=${encodeURIComponent(callback.invitationToken)}`
    : '/login';
  const continueHref = callback.invitationToken
    ? `/convite/${encodeURIComponent(callback.invitationToken)}`
    : loginHref;

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-brand-bg px-5 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,hsl(var(--brand-gold)/0.12),transparent_48%)]" />
      <section
        aria-live="polite"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-2xl sm:rounded-3xl"
      >
        <div className="border-b border-brand-border bg-brand-bg/30 px-5 py-6 text-center sm:px-7 sm:py-8">
          <BrandMark className="mx-auto mb-4 h-14 w-14" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-gold">Beauty Manager</p>
        </div>

        <div className="space-y-5 px-5 py-6 text-center sm:px-9 sm:py-8">
          {state === 'checking' && (
            <>
              <LoaderCircle aria-hidden="true" className="mx-auto h-12 w-12 animate-spin text-brand-gold" />
              <h1 className="text-2xl font-bold text-foreground">Validando sua conta</h1>
              <p className="text-sm leading-6 text-muted-foreground">Aguarde enquanto confirmamos seu e-mail.</p>
            </>
          )}

          {state === 'verified' && (
            <>
              <BadgeCheck aria-hidden="true" className="mx-auto h-14 w-14 text-success" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Conta verificada</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Seu e-mail foi confirmado. Você já pode fechar esta aba e voltar ao aplicativo.
                </p>
              </div>
              <Link
                href={continueHref}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg transition hover:bg-brand-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-surface"
              >
                {callback.invitationToken ? 'Continuar para o convite' : 'Ir para o login'}
              </Link>
            </>
          )}

          {state === 'error' && (
            <>
              <CircleAlert aria-hidden="true" className="mx-auto h-14 w-14 text-destructive" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Não foi possível verificar</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Este link pode ter expirado ou já ter sido usado. Solicite um novo e-mail de confirmação e tente novamente.
                </p>
              </div>
              <Link
                href={loginHref}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-brand-border bg-brand-bg px-5 py-3 text-sm font-semibold text-foreground transition hover:border-brand-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold"
              >
                Voltar ao login
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

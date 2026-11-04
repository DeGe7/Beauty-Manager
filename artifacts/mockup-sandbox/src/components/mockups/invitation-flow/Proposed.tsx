import { useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, Mail, Scissors } from 'lucide-react';
import './_group.css';

export function Proposed() {
  const [step, setStep] = useState<'welcome' | 'account'>('welcome');
  const [password, setPassword] = useState('');

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-bg p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--brand-gold)/0.08),transparent_55%)]" />
      <section className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-2xl">
        <header className="border-b border-brand-border bg-brand-bg/30 p-8 text-center">
          <div className="mx-auto mb-5 inline-flex rounded-xl border border-brand-gold/20 bg-brand-gold/10 p-4 text-brand-gold">
            <Scissors className="h-8 w-8" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-gold">Beauty Manager</p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            {step === 'welcome' ? 'Convite para a equipe' : 'Criar seu acesso'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === 'welcome' ? 'Você recebeu um convite para entrar em' : 'Defina a senha da sua conta para'}
          </p>
          <p className="mt-1 text-lg font-semibold text-brand-gold">Barbearia Exemplo</p>
        </header>

        {step === 'welcome' ? (
          <div className="space-y-5 p-6">
            <div className="flex gap-3 rounded-xl border border-brand-border bg-brand-bg/60 p-4">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
              <p className="text-sm leading-relaxed text-muted-foreground">
                O convite foi enviado para <span className="font-medium text-foreground">profissional@barbearia.com.br</span>. Use esse e-mail para criar seu acesso.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep('account')}
              className="min-h-12 w-full rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-brand-bg transition hover:bg-brand-gold/90"
            >
              Entrar em Barbearia Exemplo
            </button>
            <p className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Acesso vinculado ao perfil autorizado pela empresa.
            </p>
          </div>
        ) : (
          <form className="space-y-4 p-6" onSubmit={event => event.preventDefault()}>
            <button
              type="button"
              onClick={() => setStep('welcome')}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-gold"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao convite
            </button>
            <div className="space-y-2">
              <label htmlFor="invite-email" className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Mail className="h-4 w-4" /> E-mail do convite
              </label>
              <input
                id="invite-email"
                type="email"
                readOnly
                value="profissional@barbearia.com.br"
                className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">Este e-mail não pode ser alterado.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="invite-password" className="text-sm font-medium text-foreground">Crie uma senha</label>
              <input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Mínimo de 6 caracteres"
                className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm text-foreground outline-none focus:border-brand-gold"
              />
            </div>
            <button type="submit" className="min-h-12 w-full rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-brand-bg">
              Criar conta e entrar
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Já tem conta com esse e-mail? <span className="font-medium text-brand-gold">Entre com sua senha atual.</span>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

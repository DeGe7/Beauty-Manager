import { Building2, CheckCircle2, CircleAlert, Scissors } from 'lucide-react';
import './_group.css';

export function Current() {
  const valid = true;

  if (!valid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-bg p-6">
        <section className="w-full max-w-md space-y-5 rounded-2xl border border-brand-border bg-brand-surface p-8 text-center">
          <CircleAlert className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-2xl font-bold text-foreground">Convite não disponível</h1>
          <p className="text-sm text-muted-foreground">Este convite expirou, foi revogado ou já foi utilizado.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-bg p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,hsl(var(--brand-gold)/0.08),transparent_55%)]" />
      <section className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-brand-border bg-brand-surface shadow-2xl">
        <header className="border-b border-brand-border bg-brand-bg/30 p-8 text-center">
          <div className="mx-auto mb-5 inline-flex rounded-xl border border-brand-gold/20 bg-brand-gold/10 p-4 text-brand-gold">
            <Scissors className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Convite para a equipe</h1>
          <p className="mt-2 text-sm text-muted-foreground">Você recebeu acesso a um estabelecimento no Beauty Manager.</p>
        </header>
        <div className="space-y-4 p-6">
          <div className="flex gap-3 rounded-xl border border-brand-border bg-brand-bg/60 p-4">
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Use o mesmo e-mail que recebeu o convite. Se sua conta já existe, mas você nunca definiu uma senha ou não lembra dela, escolha a opção para criar ou recuperar a senha.
            </p>
          </div>
          <button className="w-full rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-brand-bg">Já tenho uma senha</button>
          <button className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm font-bold text-foreground">Ainda não tenho conta</button>
          <button className="w-full rounded-lg px-4 py-2 text-sm font-medium text-brand-gold">Criar ou recuperar minha senha</button>
          <p className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" /> O convite define seu papel com segurança.
          </p>
        </div>
      </section>
    </main>
  );
}

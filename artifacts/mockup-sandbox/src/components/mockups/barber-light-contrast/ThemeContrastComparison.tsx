import { CalendarDays, CircleAlert, CreditCard, Scissors } from 'lucide-react';
import { StatsCard } from './StatsCard';
import './_group.css';

const payments = [
  { name: 'Débito', value: 'R$ 300,00', current: 'text-sky-400', improved: 'text-sky-700' },
  { name: 'Crédito', value: 'R$ 200,00', current: 'text-violet-400', improved: 'text-violet-700' },
  { name: 'Pix', value: 'R$ 520,00', current: 'text-emerald-400', improved: 'text-emerald-700' },
  { name: 'Dinheiro', value: 'R$ 0,00', current: 'text-amber-400', improved: 'text-amber-700' },
];

function ThemePanel({ improved = false }: { improved?: boolean }) {
  const themeClass = improved ? 'theme-improved' : 'theme-current';

  return (
    <section className={`${themeClass} min-w-0 rounded-2xl border border-brand-border bg-background p-5 text-foreground`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {improved ? 'Contraste reforçado' : 'Tema atual'}
          </p>
          <h2 className="mt-1 text-lg font-bold">Visão geral</h2>
        </div>
        <span className="rounded-full border border-brand-border bg-brand-surface px-3 py-1 text-xs font-medium text-muted-foreground">
          Tema claro
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatsCard
          label="Faturamento hoje"
          value={1020}
          format={value => `R$ ${Math.round(value).toLocaleString('pt-BR')},00`}
          colorClass="text-brand-gold"
          icon={<CalendarDays className="h-5 w-5 text-brand-gold" />}
        />
        <div className="rounded-2xl border border-brand-border bg-brand-surface p-5">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-brand-gold" />
            <h3 className="text-sm font-semibold">Entradas por pagamento</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {payments.map(payment => (
              <div
                key={payment.name}
                className={`rounded-lg border p-3 ${improved ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-slate-50'}`}
              >
                <p className="text-xs text-muted-foreground">{payment.name}</p>
                <strong className={`mt-1 block text-sm font-bold tabular-nums ${improved ? payment.improved : payment.current}`}>
                  {payment.value}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-brand-border bg-brand-surface p-5">
        <label className="block text-sm font-semibold" htmlFor={improved ? 'improved-email' : 'current-email'}>
          E-mail do profissional
        </label>
        <input
          id={improved ? 'improved-email' : 'current-email'}
          className="mt-2 w-full rounded-lg border border-brand-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground"
          value="profissional@barbearia.com"
          readOnly
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-bold text-brand-bg">
            Lançar atendimento
          </button>
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${improved ? 'text-warning' : 'text-warning'}`}>
            <CircleAlert className="h-4 w-4" />
            Conferir estoque
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Scissors className="h-4 w-4 text-brand-gold" />
        Beauty Manager
      </div>
    </section>
  );
}

export function ThemeContrastComparison() {
  return (
    <main className="min-h-screen bg-[#f4f1eb] p-4 text-[#29251f] md:p-7">
      <header className="mx-auto mb-6 max-w-7xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#675c48]">Beauty Manager</p>
        <h1 className="mt-1 text-2xl font-bold">Comparação do tema claro</h1>
        <p className="mt-2 max-w-3xl text-sm text-[#5c554a]">
          Mesmos componentes e dados. Compare a legibilidade dos textos, valores, limites dos campos e botão principal.
        </p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-2">
        <ThemePanel />
        <ThemePanel improved />
      </div>
    </main>
  );
}

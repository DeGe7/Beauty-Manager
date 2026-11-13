import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api } from '@/data/api';

export default function SolicitarAcesso() {
  const organizationId = new URLSearchParams(window.location.search).get('organization') || '';
  const [organizationName, setOrganizationName] = useState('');
  const [loadingOrganization, setLoadingOrganization] = useState(Boolean(organizationId));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    api.joinRequests.publicOrganizationName(organizationId)
      .then(name => {
        if (active) setOrganizationName(name);
      })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Link de acesso inválido.');
      })
      .finally(() => {
        if (active) setLoadingOrganization(false);
      });
    return () => { active = false; };
  }, [organizationId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().split(/\s+/).length < 2) {
      setError('Informe seu nome e sobrenome.');
      return;
    }
    if (!email.trim()) {
      setError('Informe seu e-mail.');
      return;
    }
    if (!organizationId || !organizationName) {
      setError('Peça ao salão o link próprio para solicitar acesso.');
      return;
    }

    setSubmitting(true);
    try {
      await api.joinRequests.create({
        organizationId,
        applicantName: name,
        email,
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível enviar o pedido.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-brand-bg px-4 py-8">
      <section className="w-full max-w-lg rounded-2xl border border-brand-border bg-brand-surface p-5 shadow-2xl sm:p-6 md:p-8">
        <Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-brand-gold">
          <ArrowLeft className="h-4 w-4" /> Voltar ao login
        </Link>
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-gold/20 bg-brand-gold/10 text-brand-gold">
          <ShieldCheck className="h-7 w-7" />
        </div>
        {submitted ? (
          <div role="status" className="space-y-4">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <h1 className="text-2xl font-bold text-foreground">Pedido enviado</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              O Gestor/Proprietário vai revisar seu pedido. Se aprovado, você receberá um convite para criar sua conta.
              Não é necessário criar uma conta antes da aprovação.
            </p>
            <Link href="/login" className="inline-flex rounded-lg bg-brand-gold px-5 py-3 text-sm font-bold text-brand-bg">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-foreground">Solicitar autorização</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {loadingOrganization
                ? 'Verificando o salão deste link...'
                : organizationName
                  ? <>Pedido para <strong className="text-foreground">{organizationName}</strong>. O gestor escolherá seu perfil e, se aprovar, enviará um convite.</>
                  : 'Este pedido precisa do link específico do salão. Peça-o ao Gestor/Proprietário.'}
            </p>
            {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

            {organizationId && organizationName && (
            <form onSubmit={event => void handleSubmit(event)} className="mt-6 space-y-4">
              <div className="space-y-2">
                <label htmlFor="join-request-name" className="text-sm font-medium text-foreground">Nome e sobrenome</label>
                <input
                  id="join-request-name"
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  required
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-2.5 text-sm text-foreground focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
                  placeholder="Seu nome completo"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="join-request-email" className="text-sm font-medium text-foreground">E-mail para receber o convite</label>
                <input
                  id="join-request-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-brand-border bg-brand-bg px-4 py-2.5 text-sm text-foreground focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold"
                  placeholder="voce@exemplo.com"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || loadingOrganization || !organizationName}
                className="w-full rounded-lg bg-brand-gold px-4 py-3 font-bold text-brand-bg hover:bg-brand-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Enviando pedido...' : 'Enviar pedido ao gestor'}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                O pedido não cria uma conta nem libera acesso aos dados da empresa.
              </p>
            </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';
import { api } from '@/data/api';
import { Building2, ShieldCheck, Link as LinkIcon, LogIn, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { profile, accessError, completeOnboarding, acceptInvitation } = useAuth();
  const [organizationName, setOrganizationName] = useState('');
  const [invitationToken, setInvitationToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [options, setOptions] = useState<{ canCreateOrganization: boolean; canRequestAccess: boolean } | null>(null);
  const [optionsError, setOptionsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.auth.getOnboardingOptions()
      .then(result => {
        if (!cancelled) setOptions(result);
      })
      .catch(error => {
        if (!cancelled) setOptionsError(error instanceof Error ? error.message : 'Não foi possível carregar as opções de entrada.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) {
    setLocation('/login');
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationName.trim()) {
      toast.error('Informe o nome do estabelecimento.');
      return;
    }

    setIsSaving(true);
    try {
      await completeOnboarding(organizationName);
      toast.success('Estabelecimento criado com sucesso.');
      setLocation('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir o cadastro.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAcceptInvitation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invitationToken.trim()) {
      toast.error('Cole o código ou link do convite.');
      return;
    }
    setIsAccepting(true);
    try {
      const token = invitationToken.includes('/convite/')
        ? invitationToken.split('/convite/').pop()?.split(/[?#]/)[0] || ''
        : invitationToken.trim();
      await acceptInvitation(decodeURIComponent(token));
      toast.success('Convite aceito. Bem-vindo à equipe!');
      setLocation('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível aceitar o convite.');
    } finally {
      setIsAccepting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-brand-bg px-4 py-8 sm:p-6">
      <div className="w-full max-w-xl space-y-6 sm:space-y-8">
        {accessError && (
          <p role="alert" className="rounded-xl border border-brand-border bg-brand-surface p-4 text-sm text-foreground">
            {accessError}
          </p>
        )}
        <div className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-brand-surface border border-brand-border text-brand-gold flex items-center justify-center">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">
            {options?.canRequestAccess ? 'Solicitar acesso à equipe' : 'Acesso controlado'}
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            {options?.canRequestAccess
              ? `${profile.name}, envie seus dados sem criar uma conta. Se o Gestor/Proprietário aprovar, você receberá um convite para cadastro.`
              : `${profile.name}, a criação de empresas está desativada nesta aplicação. Solicite ao Gestor/Proprietário um convite válido para entrar.`}
          </p>
        </div>

         {optionsError ? (
           <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
             {optionsError}
           </div>
         ) : options === null ? (
           <div role="status" className="rounded-2xl border border-brand-border bg-brand-surface p-6 text-sm text-muted-foreground">
             Verificando as opções de entrada...
           </div>
         ) : options.canCreateOrganization ? (
            <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-brand-border bg-brand-surface p-5 sm:space-y-6 sm:p-6 md:p-8">
            <div>
              <label htmlFor="organization-name" className="block text-sm font-semibold mb-2">Nome do estabelecimento</label>
              <input
                id="organization-name"
                value={organizationName}
                onChange={event => setOrganizationName(event.target.value)}
                placeholder="Ex.: Barbearia Carvalho"
                autoComplete="organization"
                autoFocus
                className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-brand-gold"
              />
            </div>

            <div className="flex gap-3 rounded-xl border border-brand-border bg-brand-bg/60 p-4">
              <ShieldCheck className="w-5 h-5 shrink-0 text-brand-gold mt-0.5" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                A primeira conta se torna Gestor / Proprietário. A empresa poderá ser criada uma única vez neste aplicativo.
              </p>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-lg bg-brand-gold py-3 font-bold text-brand-bg hover:bg-brand-gold/90 disabled:opacity-60"
            >
              {isSaving ? 'Criando estabelecimento...' : 'Continuar'}
            </button>
          </form>
         ) : options.canRequestAccess ? (
            <section className="rounded-2xl border border-brand-gold/30 bg-brand-surface p-5 sm:p-6 md:p-8">
             <div className="flex items-start gap-3">
               <UserRoundCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
               <div>
                 <h2 className="font-bold text-foreground">Solicitar acesso à empresa</h2>
                 <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Envie seu nome e um contato. O Gestor/Proprietário escolherá seu perfil profissional e, se aprovar, emitirá um convite para cadastro.
                 </p>
               </div>
             </div>
             <button type="button" onClick={() => setLocation('/solicitar-acesso')} className="mt-5 w-full rounded-lg bg-brand-gold py-3 font-bold text-brand-bg hover:bg-brand-gold/90">
               Continuar para o pedido
             </button>
           </section>
         ) : (
           <div role="alert" className="rounded-2xl border border-warning/30 bg-warning/10 p-5 text-sm text-foreground">
              Não é possível criar empresas nem abrir um pedido de acesso neste momento. Peça um convite válido ao Gestor/Proprietário.
           </div>
         )}

         <div className="relative flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
           <span className="h-px flex-1 bg-brand-border" />
           <span>ou</span>
           <span className="h-px flex-1 bg-brand-border" />
         </div>

          <form onSubmit={handleAcceptInvitation} className="space-y-5 rounded-2xl border border-brand-gold/30 bg-brand-surface p-5 sm:p-6 md:p-8">
           <div className="flex items-start gap-3">
             <LinkIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold" />
             <div>
               <h2 className="font-bold text-foreground">Entrar por convite</h2>
               <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Use o link recebido do gestor. Sua conta será vinculada à empresa existente, sem criar uma nova.</p>
             </div>
           </div>
           <input
             value={invitationToken}
             onChange={event => setInvitationToken(event.target.value)}
             placeholder="Cole aqui o link do convite"
             className="w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-brand-gold"
           />
           <button type="submit" disabled={isAccepting} className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-gold py-3 font-bold text-brand-gold hover:bg-brand-gold/10 disabled:opacity-60">
             <LogIn className="h-4 w-4" />
             {isAccepting ? 'Validando convite...' : 'Aceitar convite'}
           </button>
         </form>
      </div>
    </div>
  );
}
import { Link } from 'wouter';
import { ShieldAlert } from 'lucide-react';

export default function NoAccess() {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-5 text-center sm:p-8">
      <div className="mb-5 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-destructive">
        <ShieldAlert className="w-12 h-12" />
      </div>
      <h1 className="mb-3 text-2xl font-bold text-foreground sm:text-3xl">Acesso Restrito</h1>
      <p className="mb-6 max-w-md text-base leading-relaxed text-muted-foreground sm:mb-8 sm:text-lg">
        O seu perfil atual não tem as permissões necessárias para acessar esta área do sistema.
      </p>
      <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand-gold px-6 py-3 font-bold text-brand-bg transition-all hover:bg-brand-gold/90 sm:px-8">
        Voltar ao Painel Principal
      </Link>
    </div>
  );
}

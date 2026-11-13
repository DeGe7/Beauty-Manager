import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-brand-bg px-4 py-8">
      <Card className="w-full max-w-md border-brand-border bg-brand-surface text-foreground">
        <CardContent className="p-5 pt-6 sm:p-8">
          <div className="mb-4 flex items-start gap-3">
            <AlertCircle className="h-8 w-8 shrink-0 text-brand-gold" />
            <h1 className="text-2xl font-bold text-foreground">
              Página não encontrada
            </h1>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Este endereço não corresponde a uma tela disponível.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

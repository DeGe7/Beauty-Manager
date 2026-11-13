import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FeatureInfoProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function FeatureInfo({ label, children, className = '' }: FeatureInfoProps) {
  const testId = label
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver explicação de ${label}`}
          data-testid={`feature-info-${testId}`}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-brand-gold/10 hover:text-brand-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold ${className}`}
        >
          <Info aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="max-h-[min(70vh,24rem)] w-[calc(100vw-2rem)] max-w-80 overflow-y-auto border-brand-border bg-brand-surface text-foreground"
      >
        <p className="text-sm font-semibold">{label}</p>
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

import { BrandMark } from '@/components/BrandMark';

type SplashScreenProps = {
  message?: string;
  overlay?: boolean;
};

export function SplashScreen({
  message = 'Preparando seu espaço...',
  overlay = false,
}: SplashScreenProps) {
  return (
    <div
      className={`bm-loading-screen fixed inset-0 z-[100] grid place-items-center overflow-hidden px-4 py-8 ${
        overlay ? 'bg-brand-bg/55 backdrop-blur-md' : 'bg-brand-bg'
      }`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={message}
      data-testid="loading-screen"
    >
      <div className="bm-loading-glow bm-loading-glow-gold" aria-hidden="true" />
      <div className="bm-loading-glow bm-loading-glow-green" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-sm rounded-3xl border border-brand-border bg-brand-surface/90 px-6 py-7 text-center shadow-2xl shadow-black/40 backdrop-blur-xl sm:px-9 sm:py-8">
        <div className="mx-auto grid h-36 w-36 place-items-center">
          <BrandMark className="bm-loading-logo h-full w-full" />
        </div>

        <p className="mt-5 text-lg font-bold tracking-wide text-foreground">Beauty Manager</p>
        <p className="mt-2 min-h-5 text-sm text-muted-foreground">{message}</p>
        <div className="mx-auto mt-5 h-1 w-36 overflow-hidden rounded-full bg-brand-border" aria-hidden="true">
          <div className="bm-loading-progress h-full w-1/2 rounded-full bg-brand-gold" />
        </div>
      </div>
    </div>
  );
}

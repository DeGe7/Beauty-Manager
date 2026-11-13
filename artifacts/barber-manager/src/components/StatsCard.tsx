import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

interface StatsCardProps {
  label: string;
  value: number;
  format?: (n: number) => string;
  className?: string;
  icon?: React.ReactNode;
  colorClass?: string;
  duration?: number;
}

function useCountUp(target: number, duration = 600) {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(0);
  const prevTarget = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = prevTarget.current;
    prevTarget.current = target;
    if (reduceMotion) {
      cancelAnimationFrame(rafRef.current);
      setCount(target);
      return;
    }
    let startTime: number | null = null;

    // Cancel any in-flight animation before starting a new one
    cancelAnimationFrame(rafRef.current);

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(from + (target - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setCount(target);
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, reduceMotion]);

  return count;
}

export function StatsCard({ label, value, format, className = '', icon, colorClass = 'text-foreground', duration = 600 }: StatsCardProps) {
  const reduceMotion = useReducedMotion();
  const animated = useCountUp(value, duration);
  const display = format ? format(animated) : Math.round(animated).toString();

  return (
    <motion.div
      className={`min-w-0 bg-brand-surface border border-brand-border rounded-2xl p-3 sm:p-4 md:p-6 flex flex-col gap-3 relative overflow-hidden group ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
    >
      <div className="flex min-w-0 items-center justify-between">
        <h3 className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere] sm:text-sm sm:tracking-wider">{label}</h3>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      <p className={`min-w-0 break-words text-xl font-bold tabular-nums [overflow-wrap:anywhere] sm:mt-2 sm:text-3xl ${colorClass}`}>{display}</p>
    </motion.div>
  );
}

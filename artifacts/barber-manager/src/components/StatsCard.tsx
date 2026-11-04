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
      className={`bg-brand-surface border border-brand-border rounded-2xl p-6 flex flex-col gap-3 relative overflow-hidden group ${className}`}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      <p className={`text-3xl font-bold mt-2 tabular-nums ${colorClass}`}>{display}</p>
    </motion.div>
  );
}

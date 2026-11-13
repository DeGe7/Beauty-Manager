import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/auth/auth';

const FORM_DRAFT_TTL_MS = 60_000;

type DraftEntry = {
  module: string;
  value: unknown;
  expiresAt?: number;
  timer?: number;
};

type DraftStore = {
  read: <T>(key: string, module: string) => T | undefined;
  write: <T>(key: string, module: string, value: T) => void;
  clear: (key: string) => void;
};

const FormDraftContext = createContext<DraftStore | null>(null);

function routeModule(location: string) {
  const route = location.split('?')[0].split('/').filter(Boolean);
  if (route[0] === 'configuracoes') return 'configuracoes';
  return route[0] || 'dashboard';
}

export function FormDraftProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { session, profile } = useAuth();
  const entries = useRef(new Map<string, DraftEntry>());
  const scope = session?.user.id && profile?.organizationId
    ? `${session.user.id}:${profile.organizationId}`
    : '';
  const currentModule = routeModule(location);
  const previousModule = useRef(currentModule);
  const scopeRef = useRef(scope);

  const clearEntry = useCallback((key: string) => {
    const entry = entries.current.get(key);
    if (entry?.timer !== undefined) window.clearTimeout(entry.timer);
    entries.current.delete(key);
  }, []);

  useEffect(() => {
    if (scopeRef.current === scope) return;
    entries.current.forEach(entry => {
      if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    });
    entries.current.clear();
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    if (!scope) {
      entries.current.forEach(entry => {
        if (entry.timer !== undefined) window.clearTimeout(entry.timer);
      });
      entries.current.clear();
      previousModule.current = currentModule;
      return;
    }

    const departedModule = previousModule.current;
    if (departedModule !== currentModule) {
      const expiresAt = Date.now() + FORM_DRAFT_TTL_MS;
      entries.current.forEach((entry, key) => {
        if (entry.module !== departedModule) return;
        if (entry.timer !== undefined) window.clearTimeout(entry.timer);
        entry.expiresAt = expiresAt;
        entry.timer = window.setTimeout(() => {
          const latest = entries.current.get(key);
          if (latest?.expiresAt === expiresAt) entries.current.delete(key);
        }, FORM_DRAFT_TTL_MS);
      });
    }

    entries.current.forEach(entry => {
      if (entry.module !== currentModule) return;
      if (entry.timer !== undefined) window.clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.expiresAt = undefined;
    });
    previousModule.current = currentModule;
  }, [currentModule, scope]);

  useEffect(() => () => {
    entries.current.forEach(entry => {
      if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    });
    entries.current.clear();
  }, []);

  const read = useCallback(<T,>(key: string, module: string): T | undefined => {
    const entry = entries.current.get(key);
    if (!entry || entry.module !== module) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      clearEntry(key);
      return undefined;
    }
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.expiresAt = undefined;
    return entry.value as T;
  }, [clearEntry]);

  const write = useCallback(<T,>(key: string, module: string, value: T) => {
    const existing = entries.current.get(key);
    if (existing?.timer !== undefined) window.clearTimeout(existing.timer);
    entries.current.set(key, { module, value });
  }, []);

  const store = useMemo(() => ({ read, write, clear: clearEntry }), [read, write, clearEntry]);
  return <FormDraftContext.Provider value={store}>{children}</FormDraftContext.Provider>;
}

export function useTemporaryFormState<T>(
  key: string,
  module: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>, () => void, () => void] {
  const store = useContext(FormDraftContext);
  if (!store) throw new Error('useTemporaryFormState precisa estar dentro de FormDraftProvider.');

  const [local, setLocal] = useState<{ key: string; value: T }>(() => ({
    key,
    value: store.read<T>(key, module) ?? initialValue,
  }));
  const value = local.key === key
    ? local.value
    : store.read<T>(key, module) ?? initialValue;
  const latest = useRef({ key, value });
  latest.current = { key, value };

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(nextValue => {
    const currentValue = latest.current.key === key
      ? latest.current.value
      : store.read<T>(key, module) ?? initialValue;
    const resolvedValue = typeof nextValue === 'function'
      ? (nextValue as (previous: T) => T)(currentValue)
      : nextValue;
    const nextState = { key, value: resolvedValue };
    latest.current = nextState;
    store.write(key, module, resolvedValue);
    setLocal(nextState);
  }, [initialValue, key, module, store]);

  const clear = useCallback(() => {
    store.clear(key);
    setLocal({ key, value: initialValue });
  }, [initialValue, key, store]);

  const forget = useCallback(() => store.clear(key), [key, store]);

  return [value, setValue, clear, forget];
}

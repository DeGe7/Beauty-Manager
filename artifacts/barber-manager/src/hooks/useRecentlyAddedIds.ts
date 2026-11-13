import { useEffect, useRef, useState } from 'react';

type Identifiable = { id: string };

const ANIMATION_DURATION_MS = 240;

export function useRecentlyAddedIds(items: readonly Identifiable[], isLoading: boolean) {
  const knownIds = useRef<Set<string> | null>(null);
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (isLoading) {
      knownIds.current = null;
      setRecentlyAddedIds(current => current.size ? new Set() : current);
      return;
    }

    const currentIds = new Set(items.map(item => item.id));
    if (knownIds.current === null) {
      knownIds.current = currentIds;
      return;
    }

    const addedIds = [...currentIds].filter(id => !knownIds.current?.has(id));
    knownIds.current = currentIds;
    if (addedIds.length > 0) {
      setRecentlyAddedIds(current => new Set([...current, ...addedIds]));
    }
  }, [items, isLoading]);

  useEffect(() => {
    if (recentlyAddedIds.size === 0) return;
    const timeout = window.setTimeout(() => setRecentlyAddedIds(new Set()), ANIMATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [recentlyAddedIds]);

  return recentlyAddedIds;
}

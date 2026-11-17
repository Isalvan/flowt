import { useCallback, useEffect, useState } from 'react';

const EVENT_NAME = 'flowt:wrapped-seen-change';

export const wrappedSeenStorageKey = (uid?: string | null): string =>
  `flowt:wrapped-seen:${uid && uid.trim() ? uid.trim() : 'demo'}`;

export function readWrappedSeen(uid?: string | null): string[] {
  try {
    const raw = localStorage.getItem(wrappedSeenStorageKey(uid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function writeWrappedSeen(uid: string | null | undefined, key: string): string[] {
  const current = readWrappedSeen(uid);
  const next = current.includes(key) ? current : [...current, key];
  try {
    localStorage.setItem(wrappedSeenStorageKey(uid), JSON.stringify(next));
  } catch {
    // Storage may be unavailable or full; callers keep working with in-memory state.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { uid: uid || 'demo', key } }));
  }
  return next;
}

export function useWrappedSeen(uid?: string | null) {
  const normalizedUid = uid && uid.trim() ? uid.trim() : 'demo';
  const [state, setState] = useState<{ uid: string; keys: string[] }>(() => ({
    uid: normalizedUid,
    keys: readWrappedSeen(normalizedUid),
  }));

  const seen = state.uid === normalizedUid ? state.keys : readWrappedSeen(normalizedUid);

  useEffect(() => {
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; key?: string }>).detail;
      if (detail?.uid && detail.uid !== normalizedUid) return;
      setState(prev => {
        const fromStorage = readWrappedSeen(normalizedUid);
        const base = prev.uid === normalizedUid ? prev.keys : [];
        const merged = [...new Set([...base, ...fromStorage, ...(detail?.key ? [detail.key] : [])])];
        return { uid: normalizedUid, keys: merged };
      });
    };
    window.addEventListener(EVENT_NAME, handleSync);
    return () => window.removeEventListener(EVENT_NAME, handleSync);
  }, [normalizedUid]);

  const markSeen = useCallback((key: string) => {
    setState(prev => {
      const base = prev.uid === normalizedUid ? prev.keys : readWrappedSeen(normalizedUid);
      const next = base.includes(key) ? base : [...base, key];
      writeWrappedSeen(normalizedUid, key);
      return { uid: normalizedUid, keys: next };
    });
  }, [normalizedUid]);

  return { seen, markSeen };
}

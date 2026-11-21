import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Movimiento } from '../../types';

interface OlderMovementsOptions {
  uid: string | undefined;
  isFirebaseConfigured: boolean;
  isLocked: boolean;
  forceDemo: boolean;
  /** Movements from this date on already arrive in real time. */
  windowStart: Date;
  showToast: (message: string, type?: 'error' | 'success') => void;
}

/** Movements older than the real-time window, loaded only when someone asks for them. */
export const useOlderMovements = ({ uid, isFirebaseConfigured, isLocked, forceDemo, windowStart, showToast }: OlderMovementsOptions) => {
  // Each unlocked user session owns its older-movements listener.
  const olderSession = useMemo(() => ({ uid, isFirebaseConfigured, isLocked, forceDemo, windowStart }), [uid, isFirebaseConfigured, isLocked, forceDemo, windowStart]);
  const [olderState, setOlderState] = useState<{
    session: typeof olderSession;
    movements: Movimiento[];
    status: 'loading' | 'loaded' | 'error';
    attempt: number;
  } | null>(null);
  const currentOlderState = olderState?.session === olderSession ? olderState : null;
  const olderMovements = currentOlderState?.movements ?? [];
  const olderMovementsLoading = currentOlderState?.status === 'loading';
  const olderMovementsLoaded = !isFirebaseConfigured || forceDemo || currentOlderState?.status === 'loaded';
  const olderMovementsError = currentOlderState?.status === 'error';
  const olderRequest = currentOlderState && currentOlderState.status !== 'error' ? currentOlderState.attempt : 0;

  const loadOlderMovements = useCallback(async () => {
    if (!uid || !isFirebaseConfigured || forceDemo || isLocked) return;
    setOlderState(state => {
      const current = state?.session === olderSession ? state : null;
      if (current && current.status !== 'error') return state;
      return { session: olderSession, movements: current?.movements ?? [], status: 'loading', attempt: (current?.attempt ?? 0) + 1 };
    });
  }, [uid, isFirebaseConfigured, forceDemo, isLocked, olderSession]);

  useEffect(() => {
    const { uid, isFirebaseConfigured, forceDemo, isLocked } = olderSession;
    if (!olderRequest || !uid || !isFirebaseConfigured || forceDemo || isLocked) return;
    // Cleanup invalidates callbacks from this attempt, including StrictMode replays.
    let cancelled = false;
    const handleError = (error: unknown) => {
      if (cancelled) return;
      console.error('Error loading older movements:', error);
      setOlderState(state => state?.session === olderSession && state.attempt === olderRequest ? { ...state, status: 'error' } : state);
      showToast('No se pudieron cargar los movimientos históricos.');
    };
    try {
      const unsubscribe = onSnapshot(query(
        collection(db, 'movimientos'),
        where('id_propietario', '==', uid),
        where('fecha_operacion', '<', windowStart),
        orderBy('fecha_operacion', 'desc'),
      ), snapshot => {
        if (cancelled) return;
        setOlderState(state => state?.session === olderSession && state.attempt === olderRequest ? {
          ...state,
          movements: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Movimiento)),
          status: 'loaded',
        } : state);
      }, handleError);
      return () => { cancelled = true; unsubscribe(); };
    } catch (error) {
      handleError(error);
      return () => { cancelled = true; };
    }
  }, [olderSession, olderRequest, windowStart, showToast]);

  return { olderMovements, olderMovementsLoading, olderMovementsLoaded, olderMovementsError, loadOlderMovements };
};

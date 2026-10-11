/* eslint-disable react-hooks/exhaustive-deps -- Context supplies the original setters and callbacks; preserve the existing dependency arrays across this extraction. */
import { useCallback } from 'react';
import type { Auth, User } from 'firebase/auth';
import { useEffect, useRef } from 'react';
import { auth, db } from '../../firebase';
import { query, collection, where, orderBy, limit, onSnapshot, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { type Movimiento, type Hucha, type Suscripcion, type PendingEmail, type CorreoHistorico } from '../../types';
import { parseMovimientoDate } from '../../utils/periodStats';
import type { FinanceContext } from './context';


// Keep session mutations in ordinary callbacks, outside the hook's immutable context boundary.
const createOlderSessionCallbacks = (context: Pick<
  FinanceContext,
  | 'olderSession'
  | 'setOlderState'
>) => {
  const { olderSession, setOlderState } = context;
  const sessionEffect = () => {
    olderSession.active = true;
    setOlderState(state => state?.session === olderSession ? state : null);
    return () => { olderSession.active = false; };
  };
  return { sessionEffect };
};

export const useOlderSessionEffect = (context: Pick<
  FinanceContext,
  | 'olderSession'
  | 'setOlderState'
>) => {
  const { olderSession } = context;
  const { sessionEffect } = createOlderSessionCallbacks(context);
  useEffect(sessionEffect, [olderSession]);
};

const createOlderMovementCallbacks = (context: Pick<
  FinanceContext,
  | 'uid'
  | 'olderSession'
  | 'setOlderState'
  | 'isFirebaseConfigured'
  | 'forceDemo'
  | 'isLocked'
  | 'windowStart'
  | 'showToast'
>) => {
  const {
    uid,
    olderSession,
    setOlderState,
    isFirebaseConfigured,
    forceDemo,
    isLocked,
    windowStart,
    showToast,
  } = context;
  const loadOlderCallback = async () => {
    if (!uid || !isFirebaseConfigured || forceDemo || isLocked || !olderSession.active || olderSession.requested) return;
    olderSession.requested = true;
    setOlderState({ session: olderSession, movements: [], status: 'loading' });
    try {
      const snapshot = await getDocs(query(
        collection(db, 'movimientos'),
        where('id_propietario', '==', uid),
        where('fecha_operacion', '<', windowStart),
        orderBy('fecha_operacion', 'desc'),
      ));
      if (!olderSession.active) return;
      setOlderState({
        session: olderSession,
        movements: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Movimiento)),
        status: 'loaded',
      });
    } catch (error) {
      console.error('Error loading older movements:', error);
      if (!olderSession.active) return;
      olderSession.requested = false;
      setOlderState({ session: olderSession, movements: [], status: 'error' });
      showToast('No se pudieron cargar los movimientos históricos.');
    }
  };
  return { loadOlderCallback };
};

export const useFinanceListeners = (context: Pick<
  FinanceContext,
  | 'uid'
  | 'olderSession'
  | 'setOlderState'
  | 'forceDemo'
  | 'setIsFirebaseConfigured'
  | 'isLocked'
  | 'setMovimientos'
  | 'setChartMovements'
  | 'setHuchas'
  | 'setSuscripciones'
  | 'setPendingEmails'
  | 'setHistoricoCorreos'
  | 'setUserStats'
  | 'setLoading'
  | 'loadDemoData'
  | 'setUser'
  | 'isFirebaseConfigured'
  | 'setChartMovementsLoading'
  | 'user'
  | 'windowStart'
  | 'showToast'
  | 'loading'
  | 'userStats'
>) => {
  const {
    uid,
    olderSession,
    forceDemo,
    setIsFirebaseConfigured,
    isLocked,
    setMovimientos,
    setChartMovements,
    setHuchas,
    setSuscripciones,
    setPendingEmails,
    setHistoricoCorreos,
    setUserStats,
    setLoading,
    loadDemoData,
    setUser,
    isFirebaseConfigured,
    setChartMovementsLoading,
    user,
    windowStart,
    showToast,
    loading,
    userStats,
  } = context;



  const { loadOlderCallback } = createOlderMovementCallbacks(context);

  const loadOlderMovements = useCallback(() => loadOlderCallback(), [uid, isFirebaseConfigured, forceDemo, isLocked, olderSession, windowStart, showToast]);

  // Check if Firebase is available (or forceDemo overrides it)
  useEffect(() => {
    if (forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY) {
      setIsFirebaseConfigured(false);
      if (isLocked) {
        setMovimientos([]);
        setChartMovements([]);
        setHuchas([]);
        setSuscripciones([]);
        setPendingEmails([]);
        setHistoricoCorreos([]);
        setUserStats(null);
        setLoading(false);
      } else {
        loadDemoData();
      }
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [forceDemo, isLocked]);

  // Firebase Real-time subscriptions
  useEffect(() => {
    if (forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY || !isFirebaseConfigured) return;

    setChartMovementsLoading(true);
    if (!user || isLocked) {
      // Clear data states when locked or signed out to prevent network & memory exposure
      setMovimientos([]);
      setChartMovements([]);
      setHuchas([]);
      setSuscripciones([]);
      setPendingEmails([]);
      setHistoricoCorreos([]);
      setUserStats(null);
      return;
    }

    // Load recent movements (last 10 for dashboard)
    const qMov = query(
      collection(db, 'movimientos'),
      where('id_propietario', '==', user.uid),
      orderBy('fecha_operacion', 'desc'),
      limit(10)
    );

    const unsubMov = onSnapshot(qMov, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Movimiento));
      const sorted = [...docs].sort((a, b) => {
        const dA = parseMovimientoDate(a.fecha_operacion)?.getTime() || 0;
        const dB = parseMovimientoDate(b.fecha_operacion)?.getTime() || 0;
        return dB - dA;
      });
      setMovimientos(sorted);
    });

    // Load the complete date-bounded dashboard window
    const qChart = query(
      collection(db, 'movimientos'),
      where('id_propietario', '==', user.uid),
      where('fecha_operacion', '>=', windowStart),
      orderBy('fecha_operacion', 'desc')
    );

    const unsubChart = onSnapshot(qChart, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Movimiento));
      const sorted = [...docs].sort((a, b) => {
        const dA = parseMovimientoDate(a.fecha_operacion)?.getTime() || 0;
        const dB = parseMovimientoDate(b.fecha_operacion)?.getTime() || 0;
        return dB - dA;
      });
      setChartMovements(sorted);
      setChartMovementsLoading(false);
    }, (error) => {
      // Without this a failed listener would leave the dashboard loading for ever.
      console.error('Error loading dashboard movements:', error);
      setChartMovementsLoading(false);
      showToast('No se pudieron cargar los movimientos.');
    });

    // Load huchas ordered
    const qHuchas = query(
      collection(db, 'huchas'),
      where('id_propietario', '==', user.uid),
      orderBy('orden', 'asc')
    );

    const unsubHuchas = onSnapshot(qHuchas, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Hucha));
      setHuchas(docs);
    });

    // Load stats
    const unsubStats = onSnapshot(doc(db, 'stats', user.uid), async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setUserStats({
          total_ingresos: data.total_ingresos ?? 0,
          total_gastos: data.total_gastos ?? 0,
        });
      } else {
        // One-time stats builder fallback for old users
        const allMovSnapshot = await getDocs(
          query(collection(db, 'movimientos'), where('id_propietario', '==', user.uid))
        );
        let total_ingresos = 0;
        let total_gastos = 0;
        
        for (const d of allMovSnapshot.docs) {
          const m = d.data() as Movimiento;
          if (m.es_interno || m.transfer_id) continue;
          const importe = m.importe ?? 0;
          if (m.tipo === 'ingreso') total_ingresos += importe;
          else total_gastos += importe;
        }

        await setDoc(doc(db, 'stats', user.uid), {
          total_ingresos,
          total_gastos,
          updated_at: serverTimestamp(),
        });
      }
    });

    // Load subscriptions
    const qSuscripciones = query(
      collection(db, 'suscripciones'),
      where('id_propietario', '==', user.uid),
      orderBy('created_at', 'asc')
    );

    const unsubSuscripciones = onSnapshot(qSuscripciones, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Suscripcion));
      setSuscripciones(docs);
    });

    // Load pending review emails
    const qPending = query(
      collection(db, 'correos_pendientes'),
      where('id_propietario', '==', user.uid),
      where('procesado', '==', false)
    );

    const unsubPending = onSnapshot(qPending, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as unknown as PendingEmail));
      setPendingEmails(docs);
    });

    // Load historico correos
    const qHistorico = query(
      collection(db, 'correos_historico'),
      where('id_propietario', '==', user.uid),
      orderBy('created_at', 'desc'),
      limit(50) // Adjust limit as needed
    );

    const unsubHistorico = onSnapshot(qHistorico, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as CorreoHistorico));
      setHistoricoCorreos(docs);
    });

    return () => {
      unsubMov();
      unsubChart();
      unsubHuchas();
      unsubStats();
      unsubSuscripciones();
      unsubPending();
      unsubHistorico();
    };
  }, [user, isFirebaseConfigured, isLocked, forceDemo, windowStart, showToast]);

  const hasRepairedStats = useRef(false);

  // Autorepair stats mathematical mismatches (Global rebuild)
  useEffect(() => {
    if (loading || !user || !isFirebaseConfigured || !userStats || hasRepairedStats.current) return;

    const checkAndRepairStats = async () => {
      try {
        hasRepairedStats.current = true;
        const allMovSnapshot = await getDocs(
          query(collection(db, 'movimientos'), where('id_propietario', '==', user.uid))
        );

        let grossGastos = 0;
        let grossIngresos = 0;

        allMovSnapshot.docs.forEach(d => {
          const m = d.data() as Movimiento;
          if (m.es_interno || m.transfer_id) return;
          if (m.tipo === 'gasto') {
            grossGastos += m.importe;
          } else if (m.tipo === 'ingreso') {
            grossIngresos += m.importe;
          }
        });

        if (Math.abs(userStats.total_ingresos - grossIngresos) > 0.05 || Math.abs(userStats.total_gastos - grossGastos) > 0.05) {
          console.log('Stats mismatch detected, updating locally...', { grossIngresos, grossGastos, userStats });
          setUserStats(prev => prev ? { ...prev, total_ingresos: grossIngresos, total_gastos: grossGastos } : null);
        }
      } catch (error) {
        console.error('Error in auto-repair:', error);
      }
    };

    checkAndRepairStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, isFirebaseConfigured, userStats]);
  return { loadOlderMovements };
};

function onAuthStateChanged(auth: Pick<Auth, 'onAuthStateChanged'>, callback: (user: User | null) => void) {
  // Symmetrical dummy auth listener
  return auth.onAuthStateChanged ? auth.onAuthStateChanged(callback) : () => {};
}

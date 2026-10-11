import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { type User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  doc,
  serverTimestamp,
  runTransaction,
  getDocs,
  setDoc,
  deleteField,
  arrayUnion,
  writeBatch,
  type WriteBatch,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { type Movimiento, type Hucha, type Suscripcion, type PendingEmail, type CorreoHistorico } from '../types';
import { usePrivacy } from '../context/PrivacyContext';
import { crearRetiradaEfectivo, cuentaEnEstadisticas } from '../utils/movements';
import { getMovementWindowStart, groupMovementsByMonth, typicalMonthlyIncome, parseMovimientoDate } from '../utils/periodStats';
import { usePreferences } from '../context/PreferencesContext';
import { payrollDates, periodOf, previousPeriod } from '../utils/periods';
import { splitIncome, reverseIncome, applySplit, recordedSplit, explicitIncomeSplit, cappedWalletCredit, roundMoney, isIncomeSplitError, type IncomeSplit } from '../utils/incomeSplit';
import { sanitizeConcepto } from '../utils/sanitize';
import { tryEditReviewedMovement } from '../utils/reviewApi';
import { compensationUpdates, unlinkCompensationUpdates, validCategory as validCatalogCategory } from '../utils/movementSuggestions';
import {
  getMonthlySubscriptionAmount,
  getNextSubscriptionChargeDate,
  isCancellationExpired,
  toLocalDateKey,
} from '../utils/subscriptions';

export { parseMovimientoDate } from '../utils/periodStats';

// Standard fallback configurations and options
export const SUBSCRIPTION_COLORS = [
  '#8b5cf6', '#ec4899', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#6366f1',
];

export const FRECUENCIA_OPTIONS = [
  { value: 'mensual', label: 'Mensual', divisor: 1 },
  { value: 'trimestral', label: 'Trimestral', divisor: 3 },
  { value: 'semestral', label: 'Semestral', divisor: 6 },
  { value: 'anual', label: 'Anual', divisor: 12 },
];

export const CATEGORIA_OPTIONS = [
  { value: 'streaming', label: 'Streaming' },
  { value: 'musica', label: 'Música' },
  { value: 'software', label: 'Software' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'noticias', label: 'Noticias' },
  { value: 'otros', label: 'Otros' },
];

export const calcMensual = (s: Suscripcion): number => {
  return getMonthlySubscriptionAmount(s);
};

/** Wallet that gets an expense's money back: its own, or the default one when that is archived or gone. */
const refundHuchaId = (huchaId: string | null | undefined, wallets: Hucha[]): string | undefined => {
  const own = wallets.find(h => h.id === huchaId);
  if (own && own.activa !== false) return own.id;
  return wallets.find(h => h.es_principal && h.activa !== false)?.id || wallets.find(h => h.activa !== false)?.id;
};

const linkedMovementIds = (m: Movimiento): string[] => Array.from(new Set(m.tipo === 'gasto'
  ? [...(m.compensado_por || []), ...(m.compensado_por_detalles || []).map(d => d.ingreso_id)]
  : [...(m.compensa_movimiento_id ? [m.compensa_movimiento_id] : []), ...(m.compensaciones_destinos || []).map(d => d.gasto_id)]));

// Initial Mock Data for outstanding user experience in Demo Mode
const MOCK_HUCHAS: Hucha[] = [
  { id: 'h-1', nombre: 'Fondo de Emergencia', saldo_acumulado: 4500, objetivo: 8000, tipo_aportacion: 'resto', orden: 1, es_principal: true, tope_objetivo: false },
  { id: 'h-2', nombre: 'Viaje a Japón', saldo_acumulado: 1200, objetivo: 4000, tipo_aportacion: 'porcentaje', valor_aportacion: 15, orden: 2, es_principal: false, tope_objetivo: true },
  { id: 'h-3', nombre: 'Suscripciones', saldo_acumulado: 45.97, objetivo: 45.97, tipo_aportacion: 'flat', valor_aportacion: 45.97, orden: 3, es_principal: false, es_suscripciones: true, tope_objetivo: true },
  { id: 'h-4', nombre: 'Inversiones', saldo_acumulado: 850, objetivo: 5000, tipo_aportacion: 'porcentaje', valor_aportacion: 20, orden: 4, es_principal: false, tope_objetivo: false },
];

const MOCK_SUSCRIPCIONES: Suscripcion[] = [
  { id: 's-1', nombre: 'Netflix Premium', importe: 17.99, frecuencia: 'mensual', dia_pago: 12, categoria: 'streaming', color: '#ef4444', activa: true, hucha_id: 'h-3' },
  { id: 's-2', nombre: 'Spotify Duo', importe: 14.99, frecuencia: 'mensual', dia_pago: 20, categoria: 'musica', color: '#22c55e', activa: true, hucha_id: 'h-3', mi_parte: 7.50 },
  { id: 's-3', nombre: 'Amazon Prime', importe: 49.90, frecuencia: 'anual', dia_pago: 5, categoria: 'streaming', color: '#0ea5e9', activa: true, hucha_id: 'h-3' },
  { id: 's-4', nombre: 'Gimnasio', importe: 29.99, frecuencia: 'mensual', dia_pago: 2, categoria: 'fitness', color: '#f97316', activa: false },
];

const MOCK_MOVIMIENTOS: Movimiento[] = [
  { id: 'm-1', tipo: 'ingreso', concepto: 'Nómina Abril', importe: 2450.00, fecha_operacion: new Date(2026, 3, 30) },
  { id: 'm-2', tipo: 'gasto', concepto: 'Súper Mercadona', importe: 84.50, fecha_operacion: new Date(2026, 4, 2), hucha_id: 'h-1' },
  { id: 'm-3', tipo: 'gasto', concepto: 'Netflix (Mensual)', importe: 17.99, fecha_operacion: new Date(2026, 4, 12), hucha_id: 'h-3' },
  { id: 'm-4', tipo: 'ingreso', concepto: 'Bizum: Cena de ayer (Compensación)', importe: 22.50, fecha_operacion: new Date(2026, 4, 16), compensa_movimiento_id: 'm-5' },
  { id: 'm-5', tipo: 'gasto', concepto: 'Cena Amigos Restaurante', importe: 45.00, fecha_operacion: new Date(2026, 4, 15), hucha_id: 'h-1', compensado_por: ['m-4'], importe_neto: 22.50 },
  { id: 'm-6', tipo: 'ingreso', concepto: 'Venta Wallapop', importe: 120.00, fecha_operacion: new Date(2026, 4, 18) },
];

const MOCK_PENDING_EMAILS: PendingEmail[] = [
  {
    id: 'pend-1',
    email_id: 'gmail-101',
    cuerpo: `Asunto: Notificación de cargo\nEstimado cliente,\nLe informamos de un cargo de 24,99 EUR en su tarjeta con fecha 22/05/2026 en el comercio DISCORD*NITRO.\nGracias por su confianza.`,
    fecha_envio: 'Sat, 22 May 2026 14:32:00 +0200',
    motivo: 'Fallo total en extracción automática',
    procesado: false,
    created_at: new Date()
  },
  {
    id: 'pend-2',
    email_id: 'gmail-102',
    cuerpo: `Asunto: Abono recibido\nHola! Te enviaron un Bizum de 12,00 EUR el 23/05/2026. Concepto: Cena de ayer.\nQue tengas un buen día!`,
    fecha_envio: 'Sun, 23 May 2026 09:15:00 +0200',
    motivo: 'Fallo total en extracción automática',
    procesado: false,
    created_at: new Date()
  }
];

export const useFinanceData = (forceDemo = false) => {
  const { inicioPeriodo } = usePreferences();
  const { isLocked } = usePrivacy();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFirebaseConfigured, setIsFirebaseConfigured] = useState(true);
  
  // Real-time states
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [chartMovements, setChartMovements] = useState<Movimiento[]>([]);
  const [huchas, setHuchas] = useState<Hucha[]>([]);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [pendingEmails, setPendingEmails] = useState<PendingEmail[]>([]);
  const [historicoCorreos, setHistoricoCorreos] = useState<CorreoHistorico[]>([]);
  const [userStats, setUserStats] = useState<{ total_ingresos: number; total_gastos: number } | null>(null);

  const [windowAnchor] = useState(() => new Date());
  const windowStart = useMemo(() => {
    // Payroll dates are not loaded yet: include one extra month to retain the boundary payroll.
    if (inicioPeriodo === 'nomina') return new Date(windowAnchor.getFullYear(), windowAnchor.getMonth() - 13, 1);
    return getMovementWindowStart(windowAnchor, { inicioPeriodo, nominas: [] });
  }, [windowAnchor, inicioPeriodo]);
  const [chartMovementsLoading, setChartMovementsLoading] = useState(true);
  const uid = user?.uid;
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

  // Global toasts & confirms
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

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

  /** Helper: loads demo data from localStorage or falls back to mocks */
  const loadDemoData = () => {
    setIsFirebaseConfigured(false);
    const localMovs = localStorage.getItem('flowt-demo-movimientos');
    const localHuchas = localStorage.getItem('flowt-demo-huchas');
    const localSubs = localStorage.getItem('flowt-demo-suscripciones');
    const localStats = localStorage.getItem('flowt-demo-stats');
    const localPending = localStorage.getItem('flowt-demo-pending');

    if (localMovs && localHuchas && localSubs && localStats && localPending) {
      setMovimientos(JSON.parse(localMovs));
      setChartMovements(JSON.parse(localMovs));
      setHuchas(JSON.parse(localHuchas));
      setSuscripciones(JSON.parse(localSubs));
      setUserStats(JSON.parse(localStats));
      setPendingEmails(JSON.parse(localPending));
    } else {
      setMovimientos(MOCK_MOVIMIENTOS);
      setChartMovements(MOCK_MOVIMIENTOS);
      setHuchas(MOCK_HUCHAS);
      setSuscripciones(MOCK_SUSCRIPCIONES);
      setPendingEmails(MOCK_PENDING_EMAILS);
      const initialStats = { total_ingresos: 2592.50, total_gastos: 147.49 };
      setUserStats(initialStats);
      localStorage.setItem('flowt-demo-movimientos', JSON.stringify(MOCK_MOVIMIENTOS));
      localStorage.setItem('flowt-demo-huchas', JSON.stringify(MOCK_HUCHAS));
      localStorage.setItem('flowt-demo-suscripciones', JSON.stringify(MOCK_SUSCRIPCIONES));
      localStorage.setItem('flowt-demo-stats', JSON.stringify(initialStats));
      localStorage.setItem('flowt-demo-pending', JSON.stringify(MOCK_PENDING_EMAILS));
    }
    setChartMovementsLoading(false);
    setLoading(false);
  };

  // Check if Firebase is available (or forceDemo overrides it)
  useEffect(() => {
    if (forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY) {
      // Demo storage is an external source loaded when this subscription mode changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

    // This flag follows the lifecycle of the Firestore listener below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Save Demo helper
  const saveDemoState = (
    newMovs: Movimiento[], 
    newHuchas: Hucha[], 
    newSubs: Suscripcion[], 
    newStats: { total_ingresos: number, total_gastos: number },
    newPending?: PendingEmail[]
  ) => {
    setMovimientos(newMovs);
    setChartMovements(newMovs);
    setHuchas(newHuchas);
    setSuscripciones(newSubs);
    setUserStats(newStats);
    
    const currentPending = newPending !== undefined ? newPending : pendingEmails;
    setPendingEmails(currentPending);
    localStorage.setItem('flowt-demo-pending', JSON.stringify(currentPending));
    
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify(newMovs));
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(newHuchas));
    localStorage.setItem('flowt-demo-suscripciones', JSON.stringify(newSubs));
    localStorage.setItem('flowt-demo-stats', JSON.stringify(newStats));
  };

  // Read rules and balances before planning any transaction writes.
  const readHuchas = async (transaction: Transaction, extraIds: string[] = []): Promise<Hucha[]> => {
    const current: Hucha[] = [];
    for (const id of new Set([...huchas.map(h => h.id), ...extraIds])) {
      const snap = await transaction.get(doc(db, 'huchas', id));
      if (snap.exists()) {
        if (snap.data().id_propietario !== user?.uid) throw new Error('Hucha no válida');
        current.push({ ...snap.data(), id } as Hucha);
      }
    }
    return current;
  };

  const writeSplit = (transaction: Transaction, current: Hucha[], split: IncomeSplit) => {
    for (const h of applySplit(current, split)) {
      if (!split.saldos[h.id] && !split.deudas[h.id]) continue;
      transaction.update(doc(db, 'huchas', h.id), {
        saldo_acumulado: h.saldo_acumulado,
        ...(split.deudas[h.id] ? { deuda_pendiente: h.deuda_pendiente, deuda_con: h.deuda_con || deleteField() } : {}),
        updated_at: serverTimestamp(),
      });
    }
  };

  // ----------------------------------------------------
  // Operations & Actions (Symmetrical Firebase & Demo)
  // ----------------------------------------------------

  const handleCreateOrUpdateHucha = async (newHucha: Omit<Hucha, 'id' | 'saldo_acumulado' | 'orden'>, editingId: string | null) => {
    // Loan settings ("subsanar"). A caller that does not send them leaves the stored ones untouched.
    const loanSettings = {
      ...(newHucha.subsanar_hasta !== undefined ? { subsanar_hasta: Number(newHucha.subsanar_hasta) || 0 } : {}),
      ...(newHucha.subsanar_con !== undefined ? { subsanar_con: newHucha.subsanar_con || null } : {}),
    };

    if (!isFirebaseConfigured) {
      let updatedHuchas = [...huchas];
      if (editingId) {
        updatedHuchas = huchas.map(h => {
          if (h.id === editingId) {
            return {
              ...h,
              nombre: newHucha.nombre,
              tipo_aportacion: newHucha.tipo_aportacion,
              valor_aportacion: newHucha.valor_aportacion,
              objetivo: newHucha.objetivo,
              es_principal: newHucha.es_principal,
              tope_objetivo: newHucha.objetivo && newHucha.objetivo > 0 ? !!newHucha.tope_objetivo : false,
              ...loanSettings,
            };
          }
          // If this hucha is being set as principal, reset other ones
          if (newHucha.es_principal && h.es_principal) {
            return { ...h, es_principal: false };
          }
          if (newHucha.tipo_aportacion === 'resto' && h.tipo_aportacion === 'resto') {
            return { ...h, tipo_aportacion: 'flat', valor_aportacion: 0 };
          }
          return h;
        });
      } else {
        const id = 'h-' + Math.random().toString(36).substr(2, 9);
        const addedHucha: Hucha = {
          id,
          nombre: newHucha.nombre,
          tipo_aportacion: newHucha.tipo_aportacion,
          valor_aportacion: newHucha.valor_aportacion,
          objetivo: newHucha.objetivo,
          es_principal: newHucha.es_principal,
          tope_objetivo: newHucha.objetivo && newHucha.objetivo > 0 ? !!newHucha.tope_objetivo : false,
          ...loanSettings,
          activa: true,
          saldo_acumulado: 0,
          orden: huchas.length + 1
        };
        // Reset principal / resto if selected on other ones
        updatedHuchas = updatedHuchas.map(h => {
          if (newHucha.es_principal && h.es_principal) return { ...h, es_principal: false };
          if (newHucha.tipo_aportacion === 'resto' && h.tipo_aportacion === 'resto') return { ...h, tipo_aportacion: 'flat', valor_aportacion: 0 };
          return h;
        });
        updatedHuchas.push(addedHucha);
      }
      saveDemoState(movimientos, updatedHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast(editingId ? 'Cartera actualizada' : 'Cartera creada', 'success');
      return;
    }

    if (!user) return;
    const huchaData = {
      id_propietario: user.uid,
      nombre: newHucha.nombre,
      tipo_aportacion: newHucha.tipo_aportacion,
      valor_aportacion: Number(newHucha.valor_aportacion),
      objetivo: newHucha.objetivo && newHucha.objetivo > 0 ? Number(newHucha.objetivo) : null,
      es_principal: !!newHucha.es_principal,
      tope_objetivo: newHucha.objetivo && newHucha.objetivo > 0 ? !!newHucha.tope_objetivo : false,
      ...loanSettings,
      activa: true,
      updated_at: serverTimestamp()
    };

    try {
      await runTransaction(db, async (transaction) => {
        // Read fresh huchas directly from DB inside transaction using docRefs to avoid race conditions
        const huchasRefs = huchas.map(h => doc(db, 'huchas', h.id));
        const huchasSnaps = await Promise.all(huchasRefs.map(ref => transaction.get(ref)));
        const freshHuchas = huchasSnaps.filter(s => s.exists()).map(s => ({ id: s.id, ...(s.data() as any) }));

        if (huchaData.es_principal) {
          const otherPrincipals = freshHuchas.filter((h: any) => h.es_principal && h.id !== editingId);
          for (const h of otherPrincipals) {
            transaction.update(doc(db, 'huchas', h.id), { es_principal: false, updated_at: serverTimestamp() });
          }
        }
        if (huchaData.tipo_aportacion === 'resto') {
          const otherRestos = freshHuchas.filter((h: any) => h.tipo_aportacion === 'resto' && h.id !== editingId);
          for (const h of otherRestos) {
            transaction.update(doc(db, 'huchas', h.id), { tipo_aportacion: 'flat', valor_aportacion: 0, updated_at: serverTimestamp() });
          }
        }

        if (editingId) {
          transaction.update(doc(db, 'huchas', editingId), huchaData);
        } else {
          const newDocRef = doc(collection(db, 'huchas'));
          transaction.set(newDocRef, {
            ...huchaData,
            saldo_acumulado: 0,
            orden: huchas.length + 1,
            created_at: serverTimestamp()
          });
        }
      });
      showToast(editingId ? 'Cartera actualizada' : 'Cartera creada', 'success');
    } catch (error) {
      console.error('Error al procesar hucha:', error);
      showToast('Error al procesar la hucha. Revisa la consola.');
    }
  };

  const handleDeleteHucha = async (hucha: Hucha, deleteMode?: 'auto' | 'manual' | 'debt', manualDistributions?: Record<string, number>, debtAssignedTo?: string) => {
    if (hucha.es_suscripciones) {
      showToast('Esta cartera es gestionada automáticamente por tus suscripciones.');
      return;
    }
    if (huchas.length === 1) {
      showToast('No puedes eliminar tu única cartera. Crea otra primero.');
      return;
    }

    if (hucha.saldo_acumulado <= 0) {
      setConfirmModal({
        title: 'Eliminar Cartera',
        message: `¿Estás seguro de que quieres eliminar la cartera "${hucha.nombre}"?`,
        onConfirm: async () => {
          if (!isFirebaseConfigured) {
            const updated = huchas.map(h => h.id === hucha.id ? { ...h, activa: false, saldo_acumulado: 0 } : h);
            saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
            showToast('Cartera eliminada', 'success');
            setConfirmModal(null);
            return;
          }
          try {
            await setDoc(doc(db, 'huchas', hucha.id), { activa: false, saldo_acumulado: 0, updated_at: serverTimestamp() }, { merge: true });
            showToast('Cartera eliminada', 'success');
          } catch (error) {
            console.error('Error al eliminar hucha:', error);
            showToast('Error al eliminar la hucha');
          }
          setConfirmModal(null);
        }
      });
      return;
    }

    // Handled with funds redistribution
    if (!deleteMode) return;

    if (!isFirebaseConfigured) {
      const remainingHuchas = huchas.filter(h => h.id !== hucha.id && h.activa !== false);
      let dists: Record<string, number> = {};

      if (deleteMode === 'auto') {
        dists = splitIncome(hucha.saldo_acumulado, remainingHuchas, { plain: true }).saldos;
      } else {
        dists = manualDistributions || {};
      }

      let updated = applySplit(huchas, { saldos: dists, deudas: {} })
        .map(h => h.id === hucha.id ? { ...h, activa: false, saldo_acumulado: 0 } : h);

      if (deleteMode === 'debt' && debtAssignedTo) {
        if (debtAssignedTo === hucha.deuda_con) {
          // Debt is just cancelled because it goes back to the lender
        } else {
          // Transfer debt to another wallet
          const assignee = huchas.find(h => h.id === debtAssignedTo);
          if (assignee) {
            dists[assignee.id] = 0; // Trigger update map
            updated = updated.map(h => {
              if (h.id === assignee.id) {
                return {
                  ...h,
                  deuda_pendiente: roundMoney((h.deuda_pendiente || 0) + (hucha.deuda_pendiente || 0)),
                  deuda_con: hucha.deuda_con
                };
              }
              return h;
            });
          }
        }
      }

      saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Cartera eliminada y fondos repartidos', 'success');
      return;
    }

    // Symmetrical for Firebase
    try {
      await runTransaction(db, async (transaction) => {
        const currentHuchas = await readHuchas(transaction, [hucha.id, ...(debtAssignedTo ? [debtAssignedTo] : [])]);
        const current = currentHuchas.find(h => h.id === hucha.id);
        if (!current) throw new Error('Hucha no válida');
        const remainingHuchas = currentHuchas.filter(h => h.id !== hucha.id && h.activa !== false);
        const dists = deleteMode === 'auto'
          ? splitIncome(current.saldo_acumulado, remainingHuchas, { plain: true }).saldos
          : manualDistributions || {};

        transaction.update(doc(db, 'huchas', hucha.id), { activa: false, saldo_acumulado: 0, updated_at: serverTimestamp() });
        if (deleteMode === 'debt' && debtAssignedTo) {
          const assignee = remainingHuchas.find(h => h.id === debtAssignedTo);
          if (debtAssignedTo !== current.deuda_con && assignee) {
            transaction.update(doc(db, 'huchas', assignee.id), {
              deuda_pendiente: roundMoney((assignee.deuda_pendiente || 0) + (current.deuda_pendiente || 0)),
              deuda_con: current.deuda_con,
              updated_at: serverTimestamp(),
            });
          }
        } else {
          writeSplit(transaction, remainingHuchas, { saldos: dists, deudas: {} });
        }
      });
      showToast(deleteMode === 'debt' ? 'Cartera eliminada y deuda transferida' : 'Cartera eliminada y fondos repartidos', 'success');
    } catch (error: any) {
      if (isIncomeSplitError(error)) throw error;
      console.error('Error distribuyendo hucha:', error);
      showToast(error.message || 'Error al eliminar la hucha.');
    }
  };

  const handleRestoreHucha = async (huchaId: string) => {
    if (!isFirebaseConfigured) {
      const updated = huchas.map(h => h.id === huchaId ? { ...h, activa: true } : h);
      saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Cartera restaurada', 'success');
      return;
    }
    try {
      await setDoc(doc(db, 'huchas', huchaId), { activa: true, updated_at: serverTimestamp() }, { merge: true });
      showToast('Cartera restaurada', 'success');
    } catch (error) {
      console.error('Error restaurando hucha:', error);
      showToast('Error al restaurar cartera');
    }
  };

  const handleTransfer = async (fromHuchaId: string, toHuchaId: string, amount: number) => {
    if (fromHuchaId === toHuchaId) {
      showToast('Debes seleccionar carteras distintas.');
      return;
    }

    const { adjusted: transferDeltas, overflow: transferOverflow, restoId: transferRestoId } =
      cappedWalletCredit(toHuchaId, amount, huchas);

    if (transferRestoId && transferRestoId === fromHuchaId) {
      showToast('La hucha destino está llena y el rebote sería al origen.');
      return;
    }

    if (!isFirebaseConfigured) {
      const updated = huchas.map(h => {
        if (h.id === fromHuchaId) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado - amount).toFixed(2)) };
        }
        let delta = transferDeltas[h.id] || 0;
        return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
      });
      if (transferOverflow > 0.01) {
        showToast(`${transferOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Transferencia completada', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const fromRef = doc(db, 'huchas', fromHuchaId);
        const toRef = doc(db, 'huchas', toHuchaId);
        const restoRef = transferRestoId && transferRestoId !== toHuchaId ? doc(db, 'huchas', transferRestoId) : null;

        const fromDoc = await transaction.get(fromRef);
        const toDoc = await transaction.get(toRef);
        const restoDoc = restoRef ? await transaction.get(restoRef) : null;

        if (!fromDoc.exists() || !toDoc.exists()) throw new Error('Una de las huchas no existe');

        const fromBalance = fromDoc.data().saldo_acumulado || 0;
        if (fromBalance < amount) {
          throw new Error('Saldo insuficiente en la cartera de origen');
        }

        transaction.update(fromRef, { saldo_acumulado: roundMoney(fromBalance - amount), updated_at: serverTimestamp() });
        const toDelta = transferDeltas[toHuchaId] ?? 0;
        if (toDelta > 0) {
          transaction.update(toRef, { saldo_acumulado: roundMoney((toDoc.data().saldo_acumulado || 0) + toDelta), updated_at: serverTimestamp() });
        }
        if (restoRef && restoDoc?.exists()) {
          const restoDelta = transferDeltas[transferRestoId!] ?? 0;
          if (restoDelta > 0) {
            transaction.update(restoRef, { saldo_acumulado: roundMoney((restoDoc.data().saldo_acumulado || 0) + restoDelta), updated_at: serverTimestamp() });
          }
        }
      });
      if (transferOverflow > 0.01) {
        showToast(`${transferOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      showToast('Transferencia completada', 'success');
    } catch (error: any) {
      console.error('Error en la transferencia:', error);
      showToast(error.message || 'Error al transferir fondos.');
    }
  };

  const handleSubsanarHucha = async (hucha: Hucha) => {
    if (hucha.saldo_acumulado >= (hucha.subsanar_hasta || 0)) {
      showToast('Esta cartera no necesita ser subsanada.');
      return;
    }

    const amount = (hucha.subsanar_hasta || 0) - hucha.saldo_acumulado;
    
    // Determine the fallback/lender wallet
    let lenderHuchaId = hucha.subsanar_con;
    if (!lenderHuchaId) {
      const activeHuchas = huchas.filter(h => h.activa !== false && h.id !== hucha.id);
      const restoCandidate = activeHuchas.find(h => h.tipo_aportacion === 'resto') 
                        || activeHuchas.find(h => h.es_principal)
                        || activeHuchas[0];
      if (restoCandidate) {
        lenderHuchaId = restoCandidate.id;
      }
    }

    if (!lenderHuchaId) {
      showToast('No se encontró una cartera prestamista.');
      return;
    }

    const lender = huchas.find(h => h.id === lenderHuchaId);
    if (!lender) {
      showToast('La cartera prestamista ya no existe.');
      return;
    }

    if (!isFirebaseConfigured) {
      const updated = huchas.map(h => {
        if (h.id === lenderHuchaId) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado - amount).toFixed(2)) };
        }
        if (h.id === hucha.id) {
          return { 
            ...h, 
            saldo_acumulado: Number((h.saldo_acumulado + amount).toFixed(2)),
            deuda_pendiente: (h.deuda_pendiente || 0) + amount,
            deuda_con: lenderHuchaId
          };
        }
        return h;
      });

      // Add mockup movements
      const movIdGasto = 'm-' + Math.random().toString(36).substr(2, 9);
      const movIdIngreso = 'm-' + Math.random().toString(36).substr(2, 9);
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newMovs: Movimiento[] = [
        {
          id: movIdGasto,
          tipo: 'gasto',
          concepto: `Préstamo a ${hucha.nombre}`,
          importe: amount,
          fecha_operacion: new Date(),
          hucha_id: lenderHuchaId,
          es_interno: true,
          transfer_id: transferId
        },
        {
          id: movIdIngreso,
          tipo: 'ingreso',
          concepto: `Subsanación desde ${lender.nombre}`,
          importe: amount,
          fecha_operacion: new Date(),
          hucha_id: hucha.id,
          es_interno: true,
          transfer_id: transferId
        }
      ];

      saveDemoState([...newMovs, ...movimientos], updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Subsanación completada', 'success');
      return;
    }

    try {
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await runTransaction(db, async (transaction) => {
        const fromRef = doc(db, 'huchas', lenderHuchaId!);
        const toRef = doc(db, 'huchas', hucha.id);
        
        const fromDoc = await transaction.get(fromRef);
        const toDoc = await transaction.get(toRef);

        if (!fromDoc.exists() || !toDoc.exists()) throw new Error('Una de las carteras no existe');
        
        const fromBalance = fromDoc.data().saldo_acumulado || 0;
        const toBalance = toDoc.data().saldo_acumulado || 0;

        transaction.update(fromRef, { saldo_acumulado: fromBalance - amount, updated_at: serverTimestamp() });
        transaction.update(toRef, { 
          saldo_acumulado: toBalance + amount,
          deuda_pendiente: (toDoc.data().deuda_pendiente || 0) + amount,
          deuda_con: lenderHuchaId,
          updated_at: serverTimestamp() 
        });

        const newMovGastoRef = doc(collection(db, 'movimientos'));
        transaction.set(newMovGastoRef, {
          id_propietario: user?.uid,
          tipo: 'gasto',
          concepto: `Préstamo a ${hucha.nombre}`,
          importe: amount,
          hucha_id: lenderHuchaId,
          es_interno: true,
          transfer_id: transferId,
          fecha_operacion: serverTimestamp(),
          created_at: serverTimestamp()
        });

        const newMovIngresoRef = doc(collection(db, 'movimientos'));
        transaction.set(newMovIngresoRef, {
          id_propietario: user?.uid,
          tipo: 'ingreso',
          concepto: `Subsanación desde ${lender.nombre}`,
          importe: amount,
          hucha_id: hucha.id,
          es_interno: true,
          transfer_id: transferId,
          fecha_operacion: serverTimestamp(),
          created_at: serverTimestamp()
        });

      });
      showToast('Subsanación completada', 'success');
    } catch (error: any) {
      console.error('Error en la subsanación:', error);
      showToast(error.message || 'Error al subsanar la cartera.');
    }
  };

  const handleRevertirDeuda = async (hucha: Hucha) => {
    const deuda = hucha.deuda_pendiente;
    const lenderHuchaId = hucha.deuda_con;
    if (!deuda || !lenderHuchaId) return;

    const lender = huchas.find(h => h.id === lenderHuchaId);
    if (!lender) {
      showToast('No se puede revertir: la cartera prestamista ya no existe.', 'error');
      return;
    }

    if (forceDemo || !isFirebaseConfigured) {
      let updated = huchas.map(h => {
        if (h.id === lenderHuchaId) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + deuda).toFixed(2)) };
        }
        if (h.id === hucha.id) {
          const rest = { ...h };
          delete rest.deuda_pendiente;
          delete rest.deuda_con;
          return {
            ...rest,
            saldo_acumulado: Number((rest.saldo_acumulado - deuda).toFixed(2))
          };
        }
        return h;
      });

      const movIdGasto = 'm-' + Math.random().toString(36).substr(2, 9);
      const movIdIngreso = 'm-' + Math.random().toString(36).substr(2, 9);
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newMovs: Movimiento[] = [
        {
          id: movIdGasto,
          tipo: 'gasto',
          concepto: `Reversión de subsanación (devuelto a ${lender.nombre})`,
          importe: deuda,
          fecha_operacion: new Date(),
          hucha_id: hucha.id,
          es_interno: true,
          transfer_id: transferId
        },
        {
          id: movIdIngreso,
          tipo: 'ingreso',
          concepto: `Reversión de préstamo (recuperado de ${hucha.nombre})`,
          importe: deuda,
          fecha_operacion: new Date(),
          hucha_id: lenderHuchaId,
          es_interno: true,
          transfer_id: transferId
        }
      ];

      saveDemoState([...newMovs, ...movimientos], updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Deuda revertida', 'success');
      return;
    }

    try {
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await runTransaction(db, async (transaction) => {
        const fromRef = doc(db, 'huchas', hucha.id);
        const toRef = doc(db, 'huchas', lenderHuchaId);
        
        const fromDoc = await transaction.get(fromRef);
        const toDoc = await transaction.get(toRef);

        if (!fromDoc.exists() || !toDoc.exists()) throw new Error('Una de las carteras no existe');
        
        const fromBalance = fromDoc.data().saldo_acumulado || 0;
        const toBalance = toDoc.data().saldo_acumulado || 0;

        transaction.update(toRef, { saldo_acumulado: toBalance + deuda, updated_at: serverTimestamp() });
        transaction.update(fromRef, { 
          saldo_acumulado: fromBalance - deuda,
          deuda_pendiente: deleteField(),
          deuda_con: deleteField(),
          updated_at: serverTimestamp() 
        });

        const newMovGastoRef = doc(collection(db, 'movimientos'));
        transaction.set(newMovGastoRef, {
          id_propietario: user?.uid,
          tipo: 'gasto',
          concepto: `Reversión de subsanación (devuelto a ${lender.nombre})`,
          importe: deuda,
          hucha_id: hucha.id,
          es_interno: true,
          transfer_id: transferId,
          fecha_operacion: serverTimestamp(),
          created_at: serverTimestamp()
        });

        const newMovIngresoRef = doc(collection(db, 'movimientos'));
        transaction.set(newMovIngresoRef, {
          id_propietario: user?.uid,
          tipo: 'ingreso',
          concepto: `Reversión de préstamo (recuperado de ${hucha.nombre})`,
          importe: deuda,
          hucha_id: lenderHuchaId,
          es_interno: true,
          transfer_id: transferId,
          fecha_operacion: serverTimestamp(),
          created_at: serverTimestamp()
        });
      });
      showToast('Deuda revertida', 'success');
    } catch (error: any) {
      console.error('Error al revertir la deuda:', error);
      showToast(error.message || 'Error al revertir la deuda.');
    }
  };

  const handleUpdateMovimientoConcepto = async (movId: string, newConcepto: string) => {
    const cleanConcepto = sanitizeConcepto(newConcepto, 200);
    if (!cleanConcepto) return;
    
    if (!isFirebaseConfigured) {
      const updated = movimientos.map(m => m.id === movId ? { ...m, concepto: cleanConcepto, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'concepto'])) } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Concepto actualizado', 'success');
      return;
    }

    try {
      if (await tryEditReviewedMovement(movId, { name: cleanConcepto })) {
        showToast('Concepto actualizado', 'success');
        return;
      }
      const movRef = doc(db, 'movimientos', movId);
      await runTransaction(db, async (transaction) => {
        transaction.update(movRef, { concepto: cleanConcepto, review_protected_fields: arrayUnion('concepto'), updated_at: serverTimestamp() });
      });
      showToast('Concepto actualizado', 'success');
    } catch (error) {
      console.error('Error al actualizar concepto:', error);
      showToast('Error al actualizar el nombre');
    }
  };

  // Convert row type for split converters
  type ConvertRow = {
    huchaId: string;
    tipoAportacion: 'flat' | 'porcentaje' | 'resto';
    value: number;
  };

  const handleConvertMovimiento = async (mov: Movimiento, rows?: ConvertRow[], targetHuchaId?: string) => {
    const amount = roundMoney(mov.importe);
    // Hand the expense back before measuring the room left under goals.
    const conversion = (current: Movimiento, wallets: Hucha[]) => {
      if (current.tipo === 'gasto') {
        const refundId = refundHuchaId(current.hucha_id, wallets);
        const refunded = applySplit(wallets, { saldos: refundId ? { [refundId]: amount } : {}, deudas: {} });
        const split = rows?.length ? explicitIncomeSplit(amount, wallets, rows) : splitIncome(amount, refunded);
        return { split: { ...split, saldos: { ...split.saldos, ...(refundId ? { [refundId]: roundMoney((split.saldos[refundId] || 0) + amount) } : {}) } }, recorded: recordedSplit(split) };
      }
      if (!wallets.some(h => h.id === targetHuchaId && h.activa !== false)) throw new Error('Hucha no válida');
      const split = reverseIncome(current, wallets);
      return { split: { ...split, saldos: { ...split.saldos, [targetHuchaId!]: roundMoney((split.saldos[targetHuchaId!] || 0) - amount) } }, recorded: null };
    };

    if (mov.tipo === 'ingreso' && !targetHuchaId) return;
    if (!isFirebaseConfigured) {
      const current = movimientos.find(m => m.id === mov.id);
      if (!current || current.tipo !== mov.tipo || current.importe !== mov.importe) throw new Error('Movimiento no válido para convertir');
      const plan = conversion(current, huchas);
      const updatedHuchas = applySplit(huchas, plan.split);
      const updatedStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (cuentaEnEstadisticas(current)) {
        if (current.tipo === 'gasto') {
          updatedStats.total_ingresos += amount;
          updatedStats.total_gastos = Math.max(0, updatedStats.total_gastos - amount);
        } else {
          updatedStats.total_ingresos = Math.max(0, updatedStats.total_ingresos - amount);
          updatedStats.total_gastos += amount;
        }
      }
      const updatedMovs = movimientos.map(m => m.id === mov.id ? {
        ...m, tipo: mov.tipo === 'gasto' ? 'ingreso' as const : 'gasto' as const,
        hucha_id: mov.tipo === 'gasto' ? undefined : targetHuchaId,
        reparto_aplicado: plan.recorded,
        categoria: undefined, categoria_sugerida: undefined, categoria_confianza: undefined,
      } : m);
      saveDemoState(updatedMovs, updatedHuchas, suscripciones, updatedStats);
      showToast(mov.tipo === 'gasto' ? 'Movimiento convertido a ingreso' : 'Movimiento convertido a gasto', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const snapshot = await transaction.get(movRef);
        const data = snapshot.data();
        if (!data || data.id_propietario !== user?.uid || data.tipo !== mov.tipo || Number(data.importe) !== mov.importe) throw new Error('Movimiento no válido para convertir');
        const current = { ...data, id: mov.id } as Movimiento;
        const wallets = await readHuchas(transaction, [
          ...(rows?.map(r => r.huchaId) || []), ...(current.hucha_id ? [current.hucha_id] : []),
          ...(targetHuchaId ? [targetHuchaId] : []),
          ...Object.keys(current.reparto_aplicado?.saldos || {}), ...Object.keys(current.reparto_aplicado?.deudas || {}),
        ]);
        const plan = conversion(current, wallets);
        writeSplit(transaction, wallets, plan.split);
        transaction.update(movRef, {
          tipo: mov.tipo === 'gasto' ? 'ingreso' : 'gasto',
          hucha_id: mov.tipo === 'gasto' ? deleteField() : targetHuchaId,
          reparto_aplicado: plan.recorded || deleteField(),
          categoria: deleteField(), categoria_sugerida: deleteField(), categoria_confianza: deleteField(),
          review_protected_fields: arrayUnion('hucha_id', 'categoria'),
        });
      });
      showToast(mov.tipo === 'gasto' ? 'Movimiento convertido a ingreso' : 'Movimiento convertido a gasto', 'success');
    } catch (error) {
      if (isIncomeSplitError(error)) throw error;
      console.error('Error convirtiendo movimiento:', error);
      showToast('Error al convertir el movimiento');
    }
  };

  const handleUpdateMovimientoCategoria = async (movId: string, categoria: string) => {
    try {
      if (!isFirebaseConfigured) {
        const movimiento = movimientos.find(m => m.id === movId);
        const custom = JSON.parse(localStorage.getItem('flowt-demo-categories') ?? '[]');
        if (!movimiento || !validCatalogCategory(categoria, movimiento.tipo, custom)) throw new Error('Categoría no válida');
        saveDemoState(movimientos.map(m => m.id === movId ? { ...m, categoria, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'categoria'])) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        if (await tryEditReviewedMovement(movId, { category: categoria })) {
          showToast('Categoría confirmada', 'success');
          return;
        }
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'movimientos', movId);
          const snap = await transaction.get(ref);
          if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('Movimiento no válido');
          if (!validCatalogCategory(categoria, snap.data().tipo)) {
            if (!/^custom_[a-f0-9]{64}$/.test(categoria)) throw new Error('Categoría no válida');
            const category = await transaction.get(doc(db, 'categorias', user.uid, 'items', categoria));
            if (!category.exists() || ![snap.data().tipo, 'ambos'].includes(category.data().tipo)) throw new Error('Categoría no válida');
          }
          transaction.update(ref, { categoria, review_protected_fields: arrayUnion('categoria'), updated_at: serverTimestamp() });
        });
      }
      showToast('Categoría confirmada', 'success');
    } catch (error) {
      showToast('No se ha podido guardar la categoría', 'error');
      throw error;
    }
  };

  const dismissDuplicate = async (aId: string, bId: string) => {
    if (aId === bId) throw new Error('Selecciona dos movimientos distintos');
    if (!isFirebaseConfigured) {
      if (![aId, bId].every(id => movimientos.some(m => m.id === id))) throw new Error('El movimiento no está disponible');
      const updated = movimientos.map(m => m.id === aId || m.id === bId ? {
        ...m, duplicados_descartados: Array.from(new Set([...(m.duplicados_descartados ?? []), m.id === aId ? bId : aId])),
      } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }
    if (!user) throw new Error('Inicia sesión para guardar');
    await runTransaction(db, async transaction => {
      const aRef = doc(db, 'movimientos', aId), bRef = doc(db, 'movimientos', bId);
      const a = await transaction.get(aRef), b = await transaction.get(bRef);
      if (!a.exists() || !b.exists() || a.data().id_propietario !== user.uid || b.data().id_propietario !== user.uid) throw new Error('El movimiento no está disponible');
      transaction.update(aRef, { duplicados_descartados: arrayUnion(bId), updated_at: serverTimestamp() });
      transaction.update(bRef, { duplicados_descartados: arrayUnion(aId), updated_at: serverTimestamp() });
    });
  };

  const handleDismissCompensation = async (ingresoId: string, gastoId: string) => {
    if (!isFirebaseConfigured) {
      const updated = movimientos.map(m => m.id === ingresoId ? { ...m, compensaciones_descartadas: Array.from(new Set([...(m.compensaciones_descartadas || []), gastoId])) } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }
    if (!user) throw new Error('Inicia sesión para guardar');
    await runTransaction(db, async transaction => {
      const ref = doc(db, 'movimientos', ingresoId);
      const snap = await transaction.get(ref);
      if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('El ingreso no está disponible');
      const descartadas = snap.data().compensaciones_descartadas || [];
      if (descartadas.length >= 200 && !descartadas.includes(gastoId)) throw new Error('Se ha alcanzado el límite de propuestas descartadas para este ingreso');
      transaction.update(ref, { compensaciones_descartadas: Array.from(new Set([...descartadas, gastoId])), updated_at: serverTimestamp() });
    });
  };

  const handleLinkMovimiento = async (baseMov: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => {
    try {
      if (!isFirebaseConfigured) {
        const base = movimientos.find(m => m.id === baseMov.id);
        if (!base) throw new Error('El movimiento no está disponible');
        const currentAllocations = allocations.map(a => {
          const mov = movimientos.find(m => m.id === a.mov.id);
          if (!mov) throw new Error('Un movimiento no está disponible');
          return { mov, importe: a.importe };
        });
        const updates = compensationUpdates(base, currentAllocations);
        saveDemoState(movimientos.map(m => updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        await runTransaction(db, async transaction => {
          const refs = [doc(db, 'movimientos', baseMov.id), ...allocations.map(a => doc(db, 'movimientos', a.mov.id))];
          const snaps = await Promise.all(refs.map(ref => transaction.get(ref)));
          const current = snaps.map(snap => {
            if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('Un movimiento no está disponible');
            return { ...snap.data(), id: snap.id } as Movimiento;
          });
          const updates = compensationUpdates(current[0], allocations.map((a, i) => ({ mov: current[i + 1], importe: a.importe })));
          for (const [id, update] of updates) transaction.update(doc(db, 'movimientos', id), { ...update, updated_at: serverTimestamp() });
        });
      }
      showToast('Compensación registrada correctamente', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error al vincular', 'error');
      throw error;
    }
  };

  const handleUnlinkMovimiento = async (base: Movimiento, target?: Movimiento) => {
    const relatedIds = (m: Movimiento) => target ? [target.id] : linkedMovementIds(m);
    try {
      if (!isFirebaseConfigured) {
        const current = movimientos.find(m => m.id === base.id);
        if (!current) throw new Error('El movimiento no está disponible');
        const ids = relatedIds(current);
        const updates = unlinkCompensationUpdates(current, movimientos.filter(m => ids.includes(m.id)));
        saveDemoState(movimientos.map(m => updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'movimientos', base.id);
          const snap = await transaction.get(ref);
          if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('El movimiento no está disponible');
          const current = { ...snap.data(), id: snap.id } as Movimiento;
          const relatedSnaps = await Promise.all(relatedIds(current).map(id => transaction.get(doc(db, 'movimientos', id))));
          const related = relatedSnaps.filter(s => s.exists()).map(s => {
            if (s.data().id_propietario !== user.uid) throw new Error('Un movimiento no está disponible');
            return { ...s.data(), id: s.id } as Movimiento;
          });
          const updates = unlinkCompensationUpdates(current, related);
          for (const [id, update] of updates) {
            const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value === undefined ? deleteField() : value]));
            transaction.update(doc(db, 'movimientos', id), { ...fields, updated_at: serverTimestamp() });
          }
        });
      }
      showToast('Compensación deshecha', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error al desvincular', 'error');
    }
  };

  const handleChangeMovimientoHucha = async (mov: Movimiento, newHuchaId: string) => {
    if (!newHuchaId || mov.hucha_id === newHuchaId) return;
    const oldHuchaId = mov.hucha_id;

    // La hucha antigua recibe +importe (revertir el gasto). Pasar por el tope.
    const { adjusted: changeDeltas, overflow: changeOverflow } =
      cappedWalletCredit(oldHuchaId, mov.importe, huchas);

    if (!isFirebaseConfigured) {
      const updatedHuchas = huchas.map(h => {
        let bal = h.saldo_acumulado;
        if (h.id === newHuchaId) {
          bal = bal - mov.importe;
        }
        const delta = changeDeltas[h.id] || 0;
        return { ...h, saldo_acumulado: Number((bal + delta).toFixed(2)) };
      });

      const updatedMovs = movimientos.map(m => m.id === mov.id ? { ...m, hucha_id: newHuchaId, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'hucha_id'])) } : m);
      saveDemoState(updatedMovs, updatedHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      if (changeOverflow > 0.01) {
        showToast(`${changeOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      showToast('Gasto reasignado', 'success');
      return;
    }

    try {
      if (await tryEditReviewedMovement(mov.id, { hucha_id: newHuchaId })) {
        showToast('Gasto reasignado', 'success');
        return;
      }
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const movementSnapshot = await transaction.get(movRef);
        const current = movementSnapshot.data();
        if (!current || current.id_propietario !== user?.uid || current.tipo !== 'gasto' || current.es_interno || current.es_metalico) throw new Error('Movimiento no válido para reasignar');
        if (current.hucha_id === newHuchaId) return;
        const ids = Array.from(new Set([...huchas.map(h => h.id), newHuchaId, current.hucha_id].filter(Boolean))) as string[];
        const currentHuchas: Hucha[] = [];
        for (const id of ids) {
          const snapshot = await transaction.get(doc(db, 'huchas', id));
          if (snapshot.exists()) {
            if (snapshot.data().id_propietario !== user?.uid) throw new Error('Hucha no válida');
            currentHuchas.push({ ...snapshot.data(), id } as Hucha);
          }
        }
        const target = currentHuchas.find(h => h.id === newHuchaId);
        if (!target || target.activa === false || target.es_metalico || target.es_interno) throw new Error('Elige una hucha activa');
        if (!current.hucha_id || !currentHuchas.some(h => h.id === current.hucha_id)) throw new Error('La hucha original ya no está disponible');
        const { adjusted } = cappedWalletCredit(current.hucha_id, Number(current.importe), currentHuchas);
        adjusted[newHuchaId] = (adjusted[newHuchaId] ?? 0) - Number(current.importe);
        if (Math.abs(Object.values(adjusted).reduce((total, amount) => total + amount, 0)) > 0.005) throw new Error('No hay capacidad para reasignar sin perder saldo');
        for (const hucha of currentHuchas) {
          const delta = adjusted[hucha.id] ?? 0;
          if (delta) transaction.update(doc(db, 'huchas', hucha.id), {
            saldo_acumulado: Number((Number(hucha.saldo_acumulado || 0) + delta).toFixed(2)),
            updated_at: serverTimestamp(),
          });
        }

        transaction.update(movRef, {
          hucha_id: newHuchaId,
          review_protected_fields: arrayUnion('hucha_id'),
          updated_at: serverTimestamp(),
        });
      });
      if (changeOverflow > 0.01) {
        showToast(`${changeOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      showToast('Gasto reasignado', 'success');
    } catch (error) {
      console.error('Error cambiando hucha del movimiento:', error);
      showToast('Error al reasignar el gasto');
    }
  };

  const getRoundedSubscriptionTotal = (updatedList: Suscripcion[], systemHuchaId?: string): number => {
    const totalMensual = updatedList
      .filter(s => s.activa && (!systemHuchaId || !s.hucha_id || s.hucha_id === systemHuchaId))
      .reduce((sum, s) => sum + calcMensual(s), 0);
    return Math.round(totalMensual * 100) / 100;
  };

  const queueSuscripcionesHuchaSync = (
    batch: WriteBatch,
    updatedList: Suscripcion[],
    currentHuchas: Hucha[],
    preferredRef?: DocumentReference,
  ): DocumentReference | null => {
    if (!user) return null;
    const current = currentHuchas.find(h => h.es_suscripciones);
    const targetRef = current
      ? doc(db, 'huchas', current.id)
      : preferredRef ?? (updatedList.some(s => s.activa) ? doc(collection(db, 'huchas')) : null);

    if (!targetRef) return null;
    const rounded = getRoundedSubscriptionTotal(updatedList, targetRef.id);
    if (current) {
      batch.update(targetRef, {
        objetivo: rounded > 0 ? rounded : null,
        valor_aportacion: rounded,
        tipo_aportacion: 'flat',
        tope_objetivo: false,
        updated_at: serverTimestamp(),
      });
    } else {
      batch.set(targetRef, {
        id_propietario: user.uid,
        nombre: 'Suscripciones',
        tipo_aportacion: 'flat',
        valor_aportacion: rounded,
        objetivo: rounded > 0 ? rounded : null,
        saldo_acumulado: 0,
        orden: currentHuchas.length + 1,
        es_principal: false,
        es_suscripciones: true,
        activa: true,
        tope_objetivo: false,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
    return targetRef;
  };

  const syncSuscripcionesHucha = async (updatedList: Suscripcion[], localHuchasState?: Hucha[]): Promise<Hucha[] | undefined> => {
    const currentHuchas = localHuchasState || huchas;
    const suscripcionesHucha = currentHuchas.find(h => h.es_suscripciones);
    const rounded = getRoundedSubscriptionTotal(updatedList, suscripcionesHucha?.id || 'h-susc');

    if (!isFirebaseConfigured) {
      let nextHuchas = [...currentHuchas];
      if (suscripcionesHucha) {
        nextHuchas = currentHuchas.map(h => {
          if (h.es_suscripciones) {
            return { ...h, objetivo: rounded > 0 ? rounded : null, valor_aportacion: rounded, tope_objetivo: false };
          }
          return h;
        });
      } else if (rounded > 0) {
        nextHuchas.push({
          id: 'h-susc',
          nombre: 'Suscripciones',
          saldo_acumulado: 0,
          objetivo: rounded,
          tipo_aportacion: 'flat',
          valor_aportacion: rounded,
          orden: currentHuchas.length + 1,
          es_suscripciones: true,
          tope_objetivo: false,
        });
      }
      return nextHuchas;
    }

    if (!user) return;
    const batch = writeBatch(db);
    const queued = queueSuscripcionesHuchaSync(batch, updatedList, currentHuchas);
    if (queued) await batch.commit();
  };

  const handleCreateOrUpdateSuscripcion = async (newSub: Omit<Suscripcion, 'id' | 'created_at'>, editingSubId: string | null) => {
    if (!isFirebaseConfigured) {
      let updatedSubs = [...suscripciones];
      const fallbackHuchaId = huchas.find(h => h.es_suscripciones)?.id || 'h-susc';
      const demoSub = {
        ...newSub,
        fecha_inicio: newSub.fecha_inicio || toLocalDateKey(new Date()),
        hucha_id: newSub.hucha_id || fallbackHuchaId,
      };
      if (editingSubId) {
        updatedSubs = suscripciones.map(s => s.id === editingSubId ? { ...s, ...demoSub } : s);
      } else {
        const id = 's-' + Math.random().toString(36).substr(2, 9);
        updatedSubs.push({ id, ...demoSub });
      }
      const nextHuchas = await syncSuscripcionesHucha(updatedSubs);
      saveDemoState(movimientos, nextHuchas || huchas, updatedSubs, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast(editingSubId ? 'Suscripción actualizada' : 'Suscripción creada', 'success');
      return;
    }

    if (!user) return;
    const existingSystemHucha = huchas.find(h => h.es_suscripciones);
    const newSystemHuchaRef = existingSystemHucha ? undefined : doc(collection(db, 'huchas'));
    const resolvedHuchaId = newSub.hucha_id || existingSystemHucha?.id || newSystemHuchaRef?.id || null;
    const data = {
      id_propietario: user.uid,
      nombre: newSub.nombre.trim(),
      importe: Number(newSub.importe),
      frecuencia: newSub.frecuencia,
      fecha_inicio: newSub.fecha_inicio || toLocalDateKey(new Date()),
      dia_pago: Number(newSub.dia_pago),
      categoria: newSub.categoria,
      color: newSub.color,
      activa: newSub.activa,
      hucha_id: resolvedHuchaId,
      mi_parte: newSub.mi_parte ?? null,
      updated_at: serverTimestamp(),
    };

    if (!Number.isFinite(data.importe) || data.importe <= 0 ||
        (data.mi_parte !== null &&
         (!Number.isFinite(Number(data.mi_parte)) || Number(data.mi_parte) <= 0 || Number(data.mi_parte) > data.importe))) {
      showToast('La parte propia debe estar entre 0 y el importe total.');
      return;
    }

    try {
      let updatedList: Suscripcion[];
      const batch = writeBatch(db);
      if (editingSubId) {
        batch.update(doc(db, 'suscripciones', editingSubId), data);
        updatedList = suscripciones.map(s => s.id === editingSubId ? { ...s, ...data } : s);
      } else {
        const newDocRef = doc(collection(db, 'suscripciones'));
        batch.set(newDocRef, { ...data, created_at: serverTimestamp() });
        updatedList = [...suscripciones, { id: newDocRef.id, ...data } as unknown as Suscripcion];
      }

      queueSuscripcionesHuchaSync(batch, updatedList, huchas, newSystemHuchaRef);
      await batch.commit();
      showToast(editingSubId ? 'Suscripción actualizada' : 'Suscripción creada', 'success');
    } catch (error) {
      console.error('Error al guardar suscripción:', error);
      showToast('Error al guardar la suscripción');
    }
  };

  const handleDeleteSuscripcion = async (s: Suscripcion) => {
    setConfirmModal({
      title: 'Eliminar Suscripción',
      message: `¿Eliminar "${s.nombre}"? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        if (!isFirebaseConfigured) {
          const updated = suscripciones.filter(sub => sub.id !== s.id);
          const nextHuchas = await syncSuscripcionesHucha(updated);
          saveDemoState(movimientos, nextHuchas || huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
          showToast('Suscripción eliminada', 'success');
          setConfirmModal(null);
          return;
        }
        try {
          const updatedList = suscripciones.filter(sub => sub.id !== s.id);
          const batch = writeBatch(db);
          batch.delete(doc(db, 'suscripciones', s.id));
          queueSuscripcionesHuchaSync(batch, updatedList, huchas);
          await batch.commit();
          showToast('Suscripción eliminada', 'success');
        } catch (error) {
          console.error('Error al eliminar suscripción:', error);
          showToast('Error al eliminar la suscripción');
        }
        setConfirmModal(null);
      }
    });
  };

  const handleToggleSuscripcion = async (s: Suscripcion) => {
    if (!isFirebaseConfigured) {
      const updated = suscripciones.map(sub => sub.id === s.id ? { ...sub, activa: !sub.activa } : sub);
      const nextHuchas = await syncSuscripcionesHucha(updated);
      saveDemoState(movimientos, nextHuchas || huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }

    if (!user) return;
    try {
      const updatedList = suscripciones.map(sub => sub.id === s.id ? { ...sub, activa: !sub.activa } : sub);
      const batch = writeBatch(db);
      batch.update(doc(db, 'suscripciones', s.id), { activa: !s.activa, updated_at: serverTimestamp() });
      queueSuscripcionesHuchaSync(batch, updatedList, huchas);
      await batch.commit();
    } catch (error) {
      console.error('Error al cambiar estado suscripción:', error);
      showToast('Error al actualizar la suscripción');
    }
  };

  const handleCancelSuscripcion = (s: Suscripcion) => {
    const nextDate = getNextSubscriptionChargeDate(s, new Date(), false);
    const cancelAt = toLocalDateKey(nextDate);
    const label = nextDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    setConfirmModal({
      title: 'Cancelar Suscripción',
      message: `"${s.nombre}" se eliminará automáticamente el ${label} (próximo cobro). Hasta entonces sigue activa.`,
      confirmLabel: 'Cancelar',
      onConfirm: async () => {
        if (!isFirebaseConfigured) {
          const updated = suscripciones.map(sub => sub.id === s.id ? { ...sub, cancelando: true, cancel_at: cancelAt } : sub);
          saveDemoState(movimientos, huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
          showToast(`${s.nombre} se cancelará el ${label}`, 'success');
          setConfirmModal(null);
          return;
        }
        try {
          await runTransaction(db, async (transaction) => {
            transaction.update(doc(db, 'suscripciones', s.id), {
              cancelando: true,
              cancel_at: cancelAt,
              updated_at: serverTimestamp(),
            });
          });
          showToast(`${s.nombre} se cancelará el ${label}`, 'success');
        } catch (error) {
          console.error('Error al cancelar suscripción:', error);
          showToast('Error al cancelar la suscripción');
        }
        setConfirmModal(null);
      }
    });
  };

  const handleUndoCancelSuscripcion = async (s: Suscripcion) => {
    if (!isFirebaseConfigured) {
      const updated = suscripciones.map(sub => sub.id === s.id ? { ...sub, cancelando: false, cancel_at: null } : sub);
      saveDemoState(movimientos, huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast(`${s.nombre} reactivada`, 'success');
      return;
    }

    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'suscripciones', s.id), {
          cancelando: false,
          cancel_at: null,
          updated_at: serverTimestamp(),
        });
      });
      showToast(`${s.nombre} reactivada`, 'success');
    } catch (error) {
      console.error('Error al reactivar suscripción:', error);
      showToast('Error al reactivar la suscripción');
    }
  };

  const handleApprovePendingEmail = async (
    emailId: string, 
    movData: { tipo: 'ingreso' | 'gasto', concepto: string, importe: number, fecha_operacion: string, hucha_id?: string }
  ) => {
    const amt = roundMoney(Number(movData.importe));
    const isIngreso = movData.tipo === 'ingreso';

    if (!isFirebaseConfigured) {
      // Demo Mode Approval
      const id = 'm-' + Math.random().toString(36).substr(2, 9);
      const newMov: Movimiento = {
        id,
        tipo: movData.tipo,
        concepto: movData.concepto,
        importe: amt,
        fecha_operacion: new Date(movData.fecha_operacion),
        hucha_id: movData.hucha_id
      };

      let nextHuchas = [...huchas];
      if (!isIngreso) {
        const hid = movData.hucha_id || huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id;
        nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
      } else {
        const hid = movData.hucha_id;
        if (hid) {
          nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
        } else {
          const split = splitIncome(amt, huchas);
          nextHuchas = applySplit(huchas, split);
          newMov.reparto_aplicado = recordedSplit(split);
        }
      }

      const nextMovs = [newMov, ...movimientos];
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (isIngreso) nextStats.total_ingresos += amt;
      else nextStats.total_gastos += amt;

      const nextPending = pendingEmails.filter(p => p.id !== emailId);

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats, nextPending);
      showToast('Movimiento aprobado y registrado', 'success');
      return;
    }

    // Firebase Mode Approval
    try {
      await runTransaction(db, async (transaction) => {
        const emailRef = doc(db, 'correos_pendientes', emailId);

        // 1. Idempotency Check: Fetch pending email doc inside transaction
        const emailSnap = await transaction.get(emailRef);
        if (!emailSnap.exists() || emailSnap.data()?.procesado === true) {
          throw new Error('EMAIL_ALREADY_PROCESSED');
        }

        const movRef = doc(collection(db, 'movimientos'));
        const statsRef = doc(db, 'stats', user!.uid);
        const statsSnap = await transaction.get(statsRef);

        // Get selected hucha (or principal)
        let targetHuchaId = movData.hucha_id;
        if (!isIngreso && !targetHuchaId) {
          targetHuchaId = huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id;
        }

        let incomeRecord: Movimiento['reparto_aplicado'];

        if (!isIngreso) {
          // Expense
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: roundMoney(bal - amt), updated_at: serverTimestamp() });
            }
          }
        } else {
          // Income distribution
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: roundMoney(bal + amt), updated_at: serverTimestamp() });
            }
          } else {
            const currentHuchas = await readHuchas(transaction);
            const split = splitIncome(amt, currentHuchas);
            incomeRecord = recordedSplit(split);
            writeSplit(transaction, currentHuchas, split);
          }
        }

        // Create movement document
        transaction.set(movRef, {
          id_propietario: user!.uid,
          tipo: movData.tipo,
          concepto: sanitizeConcepto(movData.concepto, 200),
          importe: amt,
          fecha_operacion: new Date(movData.fecha_operacion),
          hucha_id: targetHuchaId || null,
          ...(incomeRecord ? { reparto_aplicado: incomeRecord } : {}),
          id_correo_origen: emailSnap.data().email_id,
          review_protected_fields: movData.hucha_id ? ['concepto', 'hucha_id'] : ['concepto'],
          created_at: serverTimestamp()
        });

        // Durable handoff is committed together with the approved movement.
        // The synchronizer publishes it only after validating initial processing.
        transaction.set(doc(db, 'review_handoffs', movRef.id), {
          id_propietario: user!.uid,
          movement_id: movRef.id,
          email_id: emailSnap.data().email_id,
          created_at: serverTimestamp(),
        });

        const currentStats = statsSnap.exists() ? statsSnap.data() : {};
        transaction.set(statsRef, {
          total_ingresos: Number(currentStats.total_ingresos || 0) + (isIngreso ? amt : 0),
          total_gastos: Number(currentStats.total_gastos || 0) + (isIngreso ? 0 : amt),
          updated_at: serverTimestamp(),
        }, { merge: true });

        // Delete pending email from manual queue
        transaction.delete(emailRef);
      });

      showToast('Movimiento aprobado y registrado', 'success');
    } catch (error: any) {
      if (isIncomeSplitError(error)) throw error;
      if (error?.message === 'EMAIL_ALREADY_PROCESSED') {
        showToast('Este correo ya fue procesado o descartado en otra sesión.');
        return;
      }
      console.error('Error approving pending email:', error);
      showToast('Error al registrar el movimiento.');
    }
  };

  const handleDiscardPendingEmail = async (emailId: string) => {
    if (!isFirebaseConfigured) {
      const nextPending = pendingEmails.filter(p => p.id !== emailId);
      saveDemoState(movimientos, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 }, nextPending);
      showToast('Correo descartado', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const emailRef = doc(db, 'correos_pendientes', emailId);
        const emailSnap = await transaction.get(emailRef);
        if (!emailSnap.exists()) {
          throw new Error('EMAIL_ALREADY_PROCESSED');
        }
        transaction.delete(emailRef);
      });
      showToast('Correo descartado', 'success');
    } catch (error: any) {
      if (error?.message === 'EMAIL_ALREADY_PROCESSED') {
        showToast('Este correo ya fue procesado o descartado en otra sesión.');
        return;
      }
      console.error('Error discarding email:', error);
      showToast('Error al descartar el correo.');
    }
  };

  const handleCreateManualMovimiento = async (movData: {
    tipo: 'gasto' | 'ingreso';
    concepto: string;
    importe: number;
    fecha_operacion: string;
    hucha_id?: string;
    es_metalico?: boolean;
    es_interno?: boolean;
    es_retirada_efectivo?: boolean;
    hucha_origen_id?: string;
  }) => {
    const amt = roundMoney(Number(movData.importe));
    const isIngreso = movData.tipo === 'ingreso';
    const isMetalico = !!movData.es_metalico;
    const isCashWithdrawal = !!movData.es_retirada_efectivo;
    const isInternal = !!movData.es_interno || isCashWithdrawal;

    if (isCashWithdrawal && (!isIngreso || !movData.hucha_origen_id)) {
      showToast('Selecciona la cartera bancaria de origen para la retirada.');
      return;
    }

    if (!isFirebaseConfigured) {
      // 1. MODO DEMO
      let nextHuchas = [...huchas];
      let targetHuchaId = movData.hucha_id;

      // Provisionar hucha de Efectivo si es metálico y no existe
      if (isMetalico) {
        let cashHucha = nextHuchas.find(h => h.activa !== false && (h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo')));
        if (!cashHucha) {
          const cashId = 'h-efectivo-' + Math.random().toString(36).substr(2, 9);
          cashHucha = {
            id: cashId,
            nombre: 'Efectivo',
            saldo_acumulado: 0,
            objetivo: null,
            tipo_aportacion: 'flat',
            valor_aportacion: 0,
            orden: nextHuchas.length + 1,
            es_metalico: true,
            es_principal: false
          };
          nextHuchas.push(cashHucha);
        }
        targetHuchaId = cashHucha.id;
      }

      const id = 'm-manual-' + Math.random().toString(36).substr(2, 9);
      const newMov: Movimiento = {
        id,
        tipo: movData.tipo,
        concepto: movData.concepto,
        importe: amt,
        fecha_operacion: new Date(movData.fecha_operacion),
        hucha_id: targetHuchaId,
        es_metalico: isMetalico,
        es_interno: isInternal,
      };

      if (isCashWithdrawal) {
        const [salida, entrada] = crearRetiradaEfectivo({
          gasto_id: `${id}-salida`,
          ingreso_id: `${id}-entrada`,
          transfer_id: `transfer-${id}`,
          concepto: movData.concepto.trim(),
          importe: amt,
          fecha_operacion: new Date(movData.fecha_operacion),
          hucha_origen_id: movData.hucha_origen_id!,
          hucha_efectivo_id: targetHuchaId!,
        });
        nextHuchas = nextHuchas.map(h => {
          if (h.id === movData.hucha_origen_id) return { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) };
          if (h.id === targetHuchaId) return { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) };
          return h;
        });
        saveDemoState([salida, entrada, ...movimientos], nextHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
        showToast('Retirada de efectivo registrada como transferencia interna', 'success');
        return;
      }

      if (!isIngreso) {
        // Gasto
        const hid = targetHuchaId || nextHuchas.find(h => h.es_principal && h.activa !== false)?.id || nextHuchas.find(h => h.activa !== false)?.id;
        nextHuchas = nextHuchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
      } else {
        // Ingreso
        if (targetHuchaId) {
          nextHuchas = nextHuchas.map(h => h.id === targetHuchaId ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
        } else {
          const split = splitIncome(amt, nextHuchas);
          nextHuchas = applySplit(nextHuchas, split);
          newMov.reparto_aplicado = recordedSplit(split);
        }
      }

      const nextMovs = [newMov, ...movimientos];
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (cuentaEnEstadisticas(newMov)) {
        if (isIngreso) nextStats.total_ingresos += amt;
        else nextStats.total_gastos += amt;
      }

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
      showToast('Movimiento registrado correctamente', 'success');
      return;
    }

    // 2. MODO FIREBASE
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        let targetHuchaId = movData.hucha_id;
        let createdCashHuchaId: string | null = null;
        let createdCashHuchaData: Record<string, unknown> | null = null;
        let nextHuchasState = [...huchas];

        // Provisionar hucha de Efectivo si es metálico y no existe
        if (isMetalico) {
          let cashHucha = nextHuchasState.find(h => h.activa !== false && (h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo')));
          if (!cashHucha) {
            const newHuchaRef = doc(collection(db, 'huchas'));
            const cashData = {
              id_propietario: user.uid,
              nombre: 'Efectivo',
              tipo_aportacion: 'flat',
              valor_aportacion: 0,
              objetivo: null,
              saldo_acumulado: 0,
              orden: nextHuchasState.length + 1,
              es_metalico: true,
              es_principal: false,
              activa: true,
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            };
            createdCashHuchaId = newHuchaRef.id;
            createdCashHuchaData = cashData;
            targetHuchaId = newHuchaRef.id;
            
            // Añadir al estado local temporal
            nextHuchasState.push({ id: newHuchaRef.id, ...cashData } as unknown as Hucha);
          } else {
            targetHuchaId = cashHucha.id;
          }
        }

        if (isCashWithdrawal) {
          if (targetHuchaId === movData.hucha_origen_id) throw new Error('La cartera de origen y Efectivo deben ser distintas');

          // Todas las lecturas se realizan antes de cualquier escritura: es un
          // requisito de las transacciones Firestore.
          const originRef = doc(db, 'huchas', movData.hucha_origen_id!);
          const cashRef = doc(db, 'huchas', targetHuchaId!);
          const originSnap = await transaction.get(originRef);
          const cashSnap = targetHuchaId === createdCashHuchaId ? null : await transaction.get(cashRef);
          if (!originSnap.exists()) throw new Error('La cartera de origen no existe');
          if (cashSnap && !cashSnap.exists()) throw new Error('La cartera de Efectivo no existe');
          const originBalance = originSnap.data().saldo_acumulado || 0;
          if (originBalance < amt) throw new Error('Saldo insuficiente en la cartera de origen');

          transaction.update(originRef, { saldo_acumulado: roundMoney(originBalance - amt), updated_at: serverTimestamp() });
          if (targetHuchaId === createdCashHuchaId) {
            transaction.set(cashRef, { ...createdCashHuchaData!, saldo_acumulado: amt, updated_at: serverTimestamp() });
          } else {
            transaction.update(cashRef, { saldo_acumulado: roundMoney((cashSnap!.data().saldo_acumulado || 0) + amt), updated_at: serverTimestamp() });
          }

          const movementBase = {
            id_propietario: user.uid,
            created_at: serverTimestamp(),
          };
          const [salida, entrada] = crearRetiradaEfectivo({
            gasto_id: doc(collection(db, 'movimientos')).id,
            ingreso_id: doc(collection(db, 'movimientos')).id,
            transfer_id: `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            concepto: movData.concepto.trim(),
            importe: amt,
            fecha_operacion: new Date(movData.fecha_operacion),
            hucha_origen_id: movData.hucha_origen_id!,
            hucha_efectivo_id: targetHuchaId!,
          });
          transaction.set(doc(db, 'movimientos', salida.id), { ...movementBase, ...salida });
          transaction.set(doc(db, 'movimientos', entrada.id), { ...movementBase, ...entrada });
          return;
        }

        let incomeRecord: Movimiento['reparto_aplicado'];
        if (!isIngreso) {
          // Gasto
          const hid = targetHuchaId || nextHuchasState.find(h => h.es_principal && h.activa !== false)?.id || nextHuchasState.find(h => h.activa !== false)?.id;
          if (hid) {
            const huchaRef = doc(db, 'huchas', hid);
            if (hid === createdCashHuchaId) {
              transaction.set(huchaRef, { ...createdCashHuchaData!, saldo_acumulado: -amt, updated_at: serverTimestamp() });
            } else {
              const huchaSnap = await transaction.get(huchaRef);
              if (!huchaSnap.exists()) throw new Error('La cartera seleccionada no existe');
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: roundMoney(bal - amt), updated_at: serverTimestamp() });
            }
          }
        } else {
          // Ingreso
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            if (targetHuchaId === createdCashHuchaId) {
              transaction.set(huchaRef, { ...createdCashHuchaData!, saldo_acumulado: amt, updated_at: serverTimestamp() });
            } else {
              const huchaSnap = await transaction.get(huchaRef);
              if (!huchaSnap.exists()) throw new Error('La cartera seleccionada no existe');
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: roundMoney(bal + amt), updated_at: serverTimestamp() });
            }
          } else {
            const currentHuchas = await readHuchas(transaction);
            const split = splitIncome(amt, currentHuchas);
            incomeRecord = recordedSplit(split);
            writeSplit(transaction, currentHuchas, split);
          }
        }

        // Crear documento del movimiento
        const movRef = doc(collection(db, 'movimientos'));
        transaction.set(movRef, {
          id_propietario: user.uid,
          tipo: movData.tipo,
          concepto: movData.concepto.trim(),
          importe: amt,
          fecha_operacion: new Date(movData.fecha_operacion),
          hucha_id: targetHuchaId || null,
          ...(incomeRecord ? { reparto_aplicado: incomeRecord } : {}),
          es_metalico: isMetalico,
          es_interno: isInternal,
          created_at: serverTimestamp()
        });
      });

      showToast('Movimiento registrado correctamente', 'success');
    } catch (error) {
      if (isIncomeSplitError(error)) throw error;
      console.error('Error creating manual movement:', error);
      showToast('Error al registrar el movimiento.');
    }
  };

  const handleDeleteMovimiento = async (mov: Movimiento) => {
    // Las patas de una transferencia interna forman una única operación:
    // eliminarlas por separado desajusta los saldos de las carteras.
    if (mov.transfer_id) {
      const vinculados = movimientos.filter(m => m.transfer_id === mov.transfer_id && m.id !== mov.id);
      if (vinculados.length === 0) {
        showToast('No se puede eliminar una transferencia sin su movimiento vinculado.');
        return;
      }

      const transferencia = [mov, ...vinculados];
      if (transferencia.some(m => !m.hucha_id)) {
        showToast('La transferencia no tiene carteras válidas para poder revertirse.');
        return;
      }
      const deltasPorHucha = transferencia.reduce<Record<string, number>>((deltas, m) => {
        const delta = m.tipo === 'gasto' ? m.importe : -m.importe;
        deltas[m.hucha_id!] = (deltas[m.hucha_id!] || 0) + delta;
        return deltas;
      }, {});

      if (!isFirebaseConfigured) {
        const nextHuchas = huchas.map(h => ({
          ...h,
          saldo_acumulado: Number((h.saldo_acumulado + (deltasPorHucha[h.id] || 0)).toFixed(2)),
        }));
        const ids = new Set(transferencia.map(m => m.id));
        saveDemoState(movimientos.filter(m => !ids.has(m.id)), nextHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
        showToast('Transferencia interna eliminada', 'success');
        return;
      }

      if (!user) return;
      try {
        await runTransaction(db, async (transaction) => {
          const huchaRefs = Object.keys(deltasPorHucha).map(id => doc(db, 'huchas', id));
          const huchaSnaps = await Promise.all(huchaRefs.map(ref => transaction.get(ref)));
          if (huchaSnaps.some(snap => !snap.exists())) throw new Error('Una cartera de la transferencia ya no existe');

          huchaSnaps.forEach(snap => {
            const balance = snap.data()!.saldo_acumulado || 0;
            transaction.update(snap.ref, { saldo_acumulado: roundMoney(balance + (deltasPorHucha[snap.id] || 0)), updated_at: serverTimestamp() });
          });
          transferencia.forEach(m => transaction.delete(doc(db, 'movimientos', m.id)));
        });
        showToast('Transferencia interna eliminada', 'success');
      } catch (error) {
        console.error('Error deleting internal transfer:', error);
        showToast('Error al eliminar la transferencia interna.');
      }
      return;
    }

    const amt = roundMoney(Number(mov.importe));
    const isIngreso = mov.tipo === 'ingreso';

    if (!isFirebaseConfigured) {
      // 1. MODO DEMO
      let nextHuchas = [...huchas];

      if (!isIngreso) {
        // Gasto: revertir sumando de vuelta
        const hid = refundHuchaId(mov.hucha_id, huchas);
        nextHuchas = nextHuchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
      } else {
        nextHuchas = applySplit(nextHuchas, reverseIncome(mov, nextHuchas));
      }

      const relatedIds = linkedMovementIds(mov);
      const unlinked = unlinkCompensationUpdates(mov, movimientos.filter(m => relatedIds.includes(m.id)));
      const nextMovs = movimientos.filter(m => m.id !== mov.id).map(m => unlinked.has(m.id) ? { ...m, ...unlinked.get(m.id) } : m);
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (cuentaEnEstadisticas(mov)) {
        if (isIngreso) nextStats.total_ingresos = Math.max(0, nextStats.total_ingresos - amt);
        else nextStats.total_gastos = Math.max(0, nextStats.total_gastos - amt);
      }

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
      showToast('Movimiento eliminado', 'success');
      return;
    }

    // 2. MODO FIREBASE
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const snapshot = await transaction.get(movRef);
        if (!snapshot.exists() || snapshot.data().id_propietario !== user.uid) throw new Error('Movimiento no válido');
        const current = { ...snapshot.data(), id: mov.id } as Movimiento;
        if (current.tipo !== mov.tipo || current.importe !== mov.importe) throw new Error('Movimiento no válido');
        const related: Movimiento[] = [];
        for (const id of linkedMovementIds(current)) {
          const snap = await transaction.get(doc(db, 'movimientos', id));
          if (snap.exists()) {
            if (snap.data().id_propietario !== user.uid) throw new Error('Un movimiento no está disponible');
            related.push({ ...snap.data(), id } as Movimiento);
          }
        }
        const unlinked = unlinkCompensationUpdates(current, related);

        if (!isIngreso) {
          // Gasto: revertir sumando de vuelta
          const hid = refundHuchaId(mov.hucha_id, huchas);
          if (hid) {
            const huchaRef = doc(db, 'huchas', hid);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: roundMoney(bal + amt), updated_at: serverTimestamp() });
            }
          }
        } else {
          const currentHuchas = await readHuchas(transaction, [
            ...(current.hucha_id ? [current.hucha_id] : []),
            ...Object.keys(current.reparto_aplicado?.saldos || {}), ...Object.keys(current.reparto_aplicado?.deudas || {}),
          ]);
          writeSplit(transaction, currentHuchas, reverseIncome(current, currentHuchas));
        }

        for (const [id, update] of unlinked) {
          if (id === mov.id) continue;
          const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value === undefined ? deleteField() : value]));
          transaction.update(doc(db, 'movimientos', id), { ...fields, updated_at: serverTimestamp() });
        }
        // Eliminar el documento del movimiento
        transaction.delete(movRef);
      });

      showToast('Movimiento eliminado', 'success');
    } catch (error) {
      if (isIncomeSplitError(error)) throw error;
      console.error('Error deleting movement:', error);
      showToast('Error al eliminar el movimiento.');
    }
  };

  // Auto-delete cancel-pending expired subscriptions
  useEffect(() => {
    if (suscripciones.length === 0) return;
    const expired = suscripciones.filter(s => isCancellationExpired(s));
    if (expired.length === 0) return;

    const processAutoDeletion = async () => {
      if (!isFirebaseConfigured) {
        const remaining = suscripciones.filter(s => !expired.find(e => e.id === s.id));
        const nextHuchas = await syncSuscripcionesHucha(remaining);
        saveDemoState(movimientos, nextHuchas || huchas, remaining, userStats || { total_ingresos: 0, total_gastos: 0 });
        return;
      }
      if (!user) return;
        try {
        const remaining = suscripciones.filter(s => !expired.some(e => e.id === s.id));
        const batch = writeBatch(db);
        expired.forEach(s => batch.delete(doc(db, 'suscripciones', s.id)));
        queueSuscripcionesHuchaSync(batch, remaining, huchas);
        await batch.commit();
        } catch (e) {
        console.error('Error deleting expired subscriptions:', e);
        }
    };
    processAutoDeletion();
  }, [suscripciones, user, isFirebaseConfigured]);

  // ----------------------------------------------------
  // Interactive Demo Simulator Method
  // ----------------------------------------------------
  const injectDemoMovement = (tipo: 'ingreso' | 'gasto', concepto: string, importe: number, selectedHuchaId?: string) => {
    if (isFirebaseConfigured) return; // Only allowed in Demo Mode

    const id = 'm-' + Math.random().toString(36).substr(2, 9);
    const addedMov: Movimiento = {
      id,
      tipo,
      concepto,
      importe,
      fecha_operacion: new Date(),
      hucha_id: tipo === 'gasto' ? (selectedHuchaId || huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id) : undefined
    };

    const split = tipo === 'ingreso' ? splitIncome(importe, huchas) : null;
    if (split) addedMov.reparto_aplicado = recordedSplit(split);
    const nextHuchas = split ? applySplit(huchas, split) : huchas.map(h => h.id === addedMov.hucha_id
      ? { ...h, saldo_acumulado: roundMoney(Math.max(0, h.saldo_acumulado - importe)) } : h);
    const nextMovs = [addedMov, ...movimientos];

    const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
    if (tipo === 'ingreso') {
      nextStats.total_ingresos += importe;
    } else {
      nextStats.total_gastos += importe;
    }

    saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
    showToast(`Movimiento inyectado: ${concepto} (${tipo === 'ingreso' ? '+' : '-'}${importe} €)`, 'success');
  };

  // Calculations for stats
  const totalIngresos = userStats?.total_ingresos ?? 0;
  const totalGastos = userStats?.total_gastos ?? 0;
  const balance = totalIngresos - totalGastos;

  const periodConfig = useMemo(() => ({ inicioPeriodo, nominas: payrollDates(chartMovements) }), [inicioPeriodo, chartMovements]);
  const mediaIngresos = useMemo(() => typicalMonthlyIncome(chartMovements, new Date(), periodConfig), [chartMovements, periodConfig]);

  const huchaMonthlyBudgets = useMemo(() => {
    if (mediaIngresos <= 0) return {};
    try {
      return splitIncome(mediaIngresos, huchas.map(h => ({ ...h }))).saldos;
    } catch (error) {
      // An invalid rule can still be edited; a read-only estimate must not break the screen.
      if (isIncomeSplitError(error)) return {};
      throw error;
    }
  }, [huchas, mediaIngresos]);

  const totalMensualSuscripciones = useMemo(
    () => suscripciones.filter(s => s.activa).reduce((sum, s) => sum + calcMensual(s), 0),
    [suscripciones]
  );

  const principalHucha = useMemo(
    () => huchas.find(h => h.es_principal),
    [huchas]
  );

  const chartData = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
    if (inicioPeriodo !== 1) {
      let period = periodOf(now, inicioPeriodo, periodConfig.nominas);
      for (let i = 5; i >= 0; i--) {
        months[i] = period.start;
        period = previousPeriod(period, inicioPeriodo, periodConfig.nominas);
      }
    }
    return groupMovementsByMonth(chartMovements, months, periodConfig);
  }, [chartMovements, inicioPeriodo, periodConfig]);

  return {
    user,
    loading,
    isFirebaseConfigured,
    movimientos,
    chartMovements,
    chartMovementsLoading,
    olderMovements,
    olderMovementsLoading,
    olderMovementsLoaded,
    olderMovementsError,
    loadOlderMovements,
    huchas,
    suscripciones,
    pendingEmails,
    historicoCorreos,
    userStats,
    totalIngresos,
    mediaIngresos,
    totalGastos,
    balance,
    totalMensualSuscripciones,
    huchaMonthlyBudgets,
    principalHucha,
    chartData,
    toast,
    setToast,
    confirmModal,
    setConfirmModal,
    showToast,
    handleCreateOrUpdateHucha,
    handleDeleteHucha,
    handleRestoreHucha,
    handleTransfer,
    handleUpdateMovimientoConcepto,
    handleUpdateMovimientoCategoria,
    handleDismissCompensation,
    dismissDuplicate,
    handleConvertMovimiento,
    handleLinkMovimiento,
    handleUnlinkMovimiento,
    handleCreateOrUpdateSuscripcion,
    handleDeleteSuscripcion,
    handleToggleSuscripcion,
    handleCancelSuscripcion,
    handleUndoCancelSuscripcion,
    handleChangeMovimientoHucha,
    handleApprovePendingEmail,
    handleDiscardPendingEmail,
    handleCreateManualMovimiento,
    handleDeleteMovimiento,
    handleSubsanarHucha,
    handleRevertirDeuda,
    injectDemoMovement,
  };
};

function onAuthStateChanged(auth: any, callback: (user: User | null) => void) {
  // Symmetrical dummy auth listener
  return auth.onAuthStateChanged ? auth.onAuthStateChanged(callback) : () => {};
}

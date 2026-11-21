import { useEffect, useState, useRef, useCallback } from 'react';
import { signOut, type User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  doc,
  serverTimestamp,
  Timestamp,
  runTransaction,
  getDocs,
  setDoc,
  deleteField,
  arrayUnion,
  writeBatch,
  type Transaction,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { type Movimiento, type Hucha, type Suscripcion, type PendingEmail, type CorreoHistorico } from '../types';
import { usePrivacy } from '../context/PrivacyContext';
import { crearRetiradaEfectivo, cuentaEnEstadisticas } from '../utils/movements';
import { parseMovimientoDate } from '../utils/periodStats';
import { usePreferences } from '../context/PreferencesContext';
import { extraMonth, splitIncome, reverseIncome, applySplit, recordedSplit, explicitIncomeSplit, cappedWalletCredit, roundMoney, isIncomeSplitError, type IncomeSplit } from '../utils/incomeSplit';
import { sanitizeConcepto } from '../utils/sanitize';
import { isAllowedUser } from '../shared/allowedUsers';
import { tryEditReviewedMovement } from '../utils/reviewApi';
import { compensationUpdates, unlinkCompensationUpdates, validCategory as validCatalogCategory } from '../utils/movementSuggestions';

import { sortDemoMovements } from '../utils/demoData';
import { useFeedback } from './finance/useFeedback';
import { useFinanceStats } from './finance/useFinanceStats';
import { useMovementWindow } from './finance/useMovementWindow';
import { useOlderMovements } from './finance/useOlderMovements';
import { useSubscriptionActions } from './finance/useSubscriptionActions';
import { useWalletActions } from './finance/useWalletActions';
import { loadStoredDemoData } from '../utils/demoStorage';

export { parseMovimientoDate } from '../utils/periodStats';
export { SUBSCRIPTION_COLORS, FRECUENCIA_OPTIONS, CATEGORIA_OPTIONS, calcMensual } from './finance/subscriptionOptions';

// Standard fallback configurations and options
/** Wallet that gets an expense's money back: its own, or the default one when that is archived or gone. */
const refundHuchaId = (huchaId: string | null | undefined, wallets: Hucha[]): string | undefined => {
  const own = wallets.find(h => h.id === huchaId);
  if (own && own.activa !== false) return own.id;
  return wallets.find(h => h.es_principal && h.activa !== false)?.id || wallets.find(h => h.activa !== false)?.id;
};

const linkedMovementIds = (m: Movimiento): string[] => Array.from(new Set(m.tipo === 'gasto'
  ? [...(m.compensado_por || []), ...(m.compensado_por_detalles || []).map(d => d.ingreso_id)]
  : [...(m.compensa_movimiento_id ? [m.compensa_movimiento_id] : []), ...(m.compensaciones_destinos || []).map(d => d.gasto_id)]));

const needsBank = (mov: Movimiento): boolean => !mov.es_metalico && !mov.es_interno
  && (!mov.banco?.trim() || mov.banco.trim().toLowerCase() === 'banco');

export const useFinanceData = (forceDemo = false) => {
  const { inicioPeriodo } = usePreferences();
  const { isLocked } = usePrivacy();
  const [user, setUser] = useState<User | null>(null);
  // A Google account outside the allowlist signed in: it is signed out again and the login says why.
  const [accessDenied, setAccessDenied] = useState(false);
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

  const windowStart = useMovementWindow(inicioPeriodo);
  const [chartMovementsLoading, setChartMovementsLoading] = useState(true);
  const [huchasLoading, setHuchasLoading] = useState(true);
  const uid = user?.uid;

  const { toast, setToast, confirmModal, setConfirmModal, showToast } = useFeedback();
  const {
    olderMovements, olderMovementsLoading, olderMovementsLoaded, olderMovementsError, loadOlderMovements,
  } = useOlderMovements({ uid, isFirebaseConfigured, isLocked, forceDemo, windowStart, showToast });

  const loadDemoData = () => {
    setIsFirebaseConfigured(false);
    const data = loadStoredDemoData();
    setMovimientos(data.movimientos);
    setChartMovements(data.movimientos);
    setHuchas(data.huchas);
    setSuscripciones(data.suscripciones);
    setUserStats(data.stats);
    setPendingEmails(data.pending);
    setChartMovementsLoading(false);
    setHuchasLoading(false);
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

    // Leaving the demo: back to Firebase, without the demo's movements on screen.
    setIsFirebaseConfigured(true);
    setMovimientos([]);
    setChartMovements([]);
    setHuchas([]);
    setSuscripciones([]);
    setPendingEmails([]);
    setUserStats(null);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser && !isAllowedUser(currentUser)) {
        setAccessDenied(true);
        setUser(null);
        setLoading(false);
        void signOut(auth);
        return;
      }
      if (currentUser) setAccessDenied(false);
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
    setHuchasLoading(true);
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
      setHuchasLoading(false);
    }, (error) => {
      console.error('Error loading huchas:', error);
      setHuchasLoading(false);
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
    const sorted = sortDemoMovements(newMovs);
    setMovimientos(sorted);
    setChartMovements(sorted);
    setHuchas(newHuchas);
    setSuscripciones(newSubs);
    setUserStats(newStats);
    
    const currentPending = newPending !== undefined ? newPending : pendingEmails;
    setPendingEmails(currentPending);
    localStorage.setItem('flowt-demo-pending', JSON.stringify(currentPending));
    
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify(sorted));
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
      if (!split.saldos[h.id] && !split.deudas[h.id] && !split.extras?.[h.id]) continue;
      transaction.update(doc(db, 'huchas', h.id), {
        saldo_acumulado: h.saldo_acumulado,
        ...(split.extras?.[h.id] && (!split.reverseExtras || current.find(wallet => wallet.id === h.id)?.extra_ultimo === split.extras[h.id])
          ? { extra_ultimo: h.extra_ultimo || deleteField() } : {}),
        ...(split.deudas[h.id] ? { deuda_pendiente: h.deuda_pendiente, deuda_con: h.deuda_con || deleteField() } : {}),
        updated_at: serverTimestamp(),
      });
    }
  };

  // ----------------------------------------------------
  // Operations & Actions (Symmetrical Firebase & Demo)
  // ----------------------------------------------------

  const {
    handleCreateOrUpdateHucha,
    handleDeleteHucha,
    handleRestoreHucha,
    handleTransfer,
    handlePrestamo,
    handleSubsanarHucha,
    handleRevertirDeuda,
  } = useWalletActions({
    user, isFirebaseConfigured, forceDemo, huchas, movimientos, suscripciones, userStats,
    saveDemoState, readHuchas, writeSplit, showToast, setConfirmModal,
  });

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
        const split = rows?.length ? explicitIncomeSplit(amount, wallets, rows) : splitIncome(amount, refunded, { extraMonth: extraMonth(current) });
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
          ...Object.keys(current.reparto_aplicado?.saldos || {}), ...Object.keys(current.reparto_aplicado?.deudas || {}), ...Object.keys(current.reparto_aplicado?.extras || {}),
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

  const {
    handleCreateOrUpdateSuscripcion,
    handleDeleteSuscripcion,
    handleToggleSuscripcion,
    handleCancelSuscripcion,
    handleUndoCancelSuscripcion,
  } = useSubscriptionActions({
    user, isFirebaseConfigured, huchas, suscripciones, movimientos, userStats, saveDemoState, showToast, setConfirmModal,
  });

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
          const split = splitIncome(amt, huchas, { extraMonth: extraMonth(newMov) });
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
            const split = splitIncome(amt, currentHuchas, { extraMonth: extraMonth(movData) });
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

  const countMovimientosWithoutBank = useCallback(async (): Promise<number> => {
    if (isLocked) return 0;
    if (!isFirebaseConfigured) return movimientos.filter(needsBank).length;
    if (!user) return 0;
    const snapshot = await getDocs(query(collection(db, 'movimientos'), where('id_propietario', '==', user.uid)));
    return snapshot.docs.filter(item => needsBank(item.data() as Movimiento)).length;
  }, [isLocked, isFirebaseConfigured, movimientos, user]);

  const assignMovimientosWithoutBank = async (banco: string): Promise<void> => {
    if (isLocked || !banco.trim()) throw new Error('Banco no disponible');
    if (!isFirebaseConfigured) {
      const updated_at = new Date();
      saveDemoState(movimientos.map(mov => needsBank(mov) ? { ...mov, banco, updated_at } : mov), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }
    if (!user) throw new Error('Usuario no disponible');
    const snapshot = await getDocs(query(collection(db, 'movimientos'), where('id_propietario', '==', user.uid)));
    const pending = snapshot.docs.filter(item => needsBank(item.data() as Movimiento));
    for (let offset = 0; offset < pending.length; offset += 400) {
      const batch = writeBatch(db);
      pending.slice(offset, offset + 400).forEach(item => batch.update(item.ref, { banco, updated_at: serverTimestamp() }));
      await batch.commit();
    }
  };

  const handleAttachTicket = async (id: string, ticket: NonNullable<Movimiento['ticket']>) => {
    if (isLocked) throw new Error('Desbloquea Flowt para guardar el ticket.');
    const detail = { ...ticket, escaneado_at: Timestamp.now() };
    const assertTarget = (movement: Movimiento | undefined) => {
      if (!movement || movement.tipo !== 'gasto' || movement.es_interno || movement.transfer_id || movement.ticket) {
        throw new Error('El gasto ya tiene un ticket o no está disponible. Vuelve a revisarlo.');
      }
    };
    if (!isFirebaseConfigured) {
      assertTarget(movimientos.find(m => m.id === id));
      saveDemoState(movimientos.map(m => m.id === id ? { ...m, ticket: detail } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
    } else {
      if (!user) throw new Error('Inicia sesión para guardar.');
      await runTransaction(db, async transaction => {
        const ref = doc(db, 'movimientos', id);
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists() ? { id, ...snapshot.data() } as Movimiento : undefined;
        assertTarget(current);
        if (current?.id_propietario !== user.uid) throw new Error('El gasto no está disponible.');
        transaction.update(ref, { ticket: detail });
      });
    }
    showToast('Detalle del ticket añadido al gasto', 'success');
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
    banco?: string;
    categoria?: string;
    ticket?: Movimiento['ticket'];
  }) => {
    const amt = roundMoney(Number(movData.importe));
    const isIngreso = movData.tipo === 'ingreso';
    const isMetalico = !!movData.es_metalico;
    const isCashWithdrawal = !!movData.es_retirada_efectivo;
    const isInternal = !!movData.es_interno || isCashWithdrawal;
    const bankFields = !isMetalico && !isCashWithdrawal && movData.banco ? { banco: movData.banco } : {};
    const ticketFields = movData.ticket ? {
      ticket: { ...movData.ticket, escaneado_at: Timestamp.now() },
      ...(movData.categoria ? { categoria: movData.categoria } : {}),
    } : {};
    if (movData.ticket && isLocked) throw new Error('Desbloquea Flowt para guardar el ticket.');

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
        ...bankFields,
        ...ticketFields,
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
          const split = splitIncome(amt, nextHuchas, { extraMonth: extraMonth(newMov) });
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
    if (!user) {
      if (movData.ticket) throw new Error('Inicia sesión para guardar.');
      return;
    }
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
            const split = splitIncome(amt, currentHuchas, { extraMonth: extraMonth(movData) });
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
          ...bankFields,
          ...ticketFields,
          created_at: serverTimestamp()
        });
      });

      showToast('Movimiento registrado correctamente', 'success');
    } catch (error) {
      if (isIncomeSplitError(error)) throw error;
      console.error('Error creating manual movement:', error);
      showToast('Error al registrar el movimiento.');
      if (movData.ticket) throw error;
    }
  };

  const handleReconcileBankBalance = async (huchaId: string, amount: number): Promise<void> => {
    const delta = roundMoney(amount);
    if (isLocked || !Number.isFinite(delta) || delta === 0) throw new Error('Ajuste no válido');
    const movement = {
      tipo: delta > 0 ? 'ingreso' as const : 'gasto' as const,
      concepto: 'Ajuste para cuadrar con el banco',
      importe: Math.abs(delta),
      hucha_id: huchaId,
      es_interno: true,
      fecha_operacion: new Date(),
    };
    if (!isFirebaseConfigured) {
      const wallet = huchas.find(h => h.id === huchaId && h.activa !== false && !h.es_metalico);
      if (!wallet) throw new Error('Cartera no disponible');
      const id = 'm-ajuste-' + Math.random().toString(36).slice(2, 11);
      const nextHuchas = huchas.map(h => h.id === huchaId ? { ...h, saldo_acumulado: roundMoney(h.saldo_acumulado + delta) } : h);
      saveDemoState([{ id, ...movement }, ...movimientos], nextHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }
    if (!user) throw new Error('Usuario no disponible');
    const movRef = doc(collection(db, 'movimientos'));
    await runTransaction(db, async transaction => {
      const walletRef = doc(db, 'huchas', huchaId);
      const snapshot = await transaction.get(walletRef);
      if (!snapshot.exists()) throw new Error('Cartera no disponible');
      const wallet = snapshot.data();
      if (wallet.id_propietario !== user.uid || wallet.activa === false || wallet.es_metalico) throw new Error('Cartera no disponible');
      transaction.update(walletRef, { saldo_acumulado: roundMoney((wallet.saldo_acumulado || 0) + delta), updated_at: serverTimestamp() });
      transaction.set(movRef, { ...movement, id_propietario: user.uid, created_at: serverTimestamp() });
    });
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
            ...Object.keys(current.reparto_aplicado?.saldos || {}), ...Object.keys(current.reparto_aplicado?.deudas || {}), ...Object.keys(current.reparto_aplicado?.extras || {}),
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

    const split = tipo === 'ingreso' ? splitIncome(importe, huchas, { extraMonth: extraMonth(addedMov) }) : null;
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

  const {
    totalIngresos, mediaIngresos, totalGastos, balance, totalMensualSuscripciones, huchaMonthlyBudgets, principalHucha, chartData,
  } = useFinanceStats({ chartMovements, huchas, suscripciones, userStats, inicioPeriodo });

  return {
    user,
    accessDenied,
    loading,
    isFirebaseConfigured,
    movimientos,
    chartMovements,
    chartMovementsLoading,
    huchasLoading,
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
    handlePrestamo,
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
    handleAttachTicket,
    countMovimientosWithoutBank,
    assignMovimientosWithoutBank,
    handleDeleteMovimiento,
    handleReconcileBankBalance,
    handleSubsanarHucha,
    handleRevertirDeuda,
    injectDemoMovement,
  };
};

function onAuthStateChanged(auth: any, callback: (user: User | null) => void) {
  // Symmetrical dummy auth listener
  return auth.onAuthStateChanged ? auth.onAuthStateChanged(callback) : () => {};
}

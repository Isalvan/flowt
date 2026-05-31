import { useEffect, useMemo, useState, useRef } from 'react';
import { type User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  deleteDoc,
  doc,
  serverTimestamp,
  runTransaction,
  getDocs,
  setDoc,
  deleteField,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { type Movimiento, type Hucha, type Suscripcion, type PendingEmail } from '../types';
import { usePrivacy } from '../context/PrivacyContext';

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
  const opt = FRECUENCIA_OPTIONS.find(o => o.value === s.frecuencia);
  const importeEfectivo = s.mi_parte != null ? s.mi_parte : s.importe;
  return importeEfectivo / (opt?.divisor ?? 1);
};

export const getNextPaymentDate = (diaPago: number): Date => {
  const today = new Date();
  const candidate = new Date(today.getFullYear(), today.getMonth(), diaPago);
  if (candidate <= today) {
    return new Date(today.getFullYear(), today.getMonth() + 1, diaPago);
  }
  return candidate;
};

export const parseMovimientoDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;
  if (dateValue?.toDate instanceof Function) {
    const d = dateValue.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (dateValue instanceof Date) {
    return !Number.isNaN(dateValue.getTime()) ? dateValue : null;
  }
  if (typeof dateValue === 'string') {
    const d = new Date(dateValue);
    return !Number.isNaN(d.getTime()) ? d : null;
  }
  return null;
};

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
  const [userStats, setUserStats] = useState<{ total_ingresos: number; total_gastos: number } | null>(null);

  // Global toasts & confirms
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

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
    setLoading(false);
  };

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
    if (!user || !isFirebaseConfigured) return;

    if (isLocked) {
      // Clear data states when locked to prevent network & memory exposure
      setMovimientos([]);
      setChartMovements([]);
      setHuchas([]);
      setSuscripciones([]);
      setPendingEmails([]);
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

    // Load chart movements (last 150)
    const qChart = query(
      collection(db, 'movimientos'),
      where('id_propietario', '==', user.uid),
      orderBy('fecha_operacion', 'desc'),
      limit(150)
    );

    const unsubChart = onSnapshot(qChart, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Movimiento));
      const sorted = [...docs].sort((a, b) => {
        const dA = parseMovimientoDate(a.fecha_operacion)?.getTime() || 0;
        const dB = parseMovimientoDate(b.fecha_operacion)?.getTime() || 0;
        return dB - dA;
      });
      setChartMovements(sorted);
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
          const m = d.data();
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

    return () => {
      unsubMov();
      unsubChart();
      unsubHuchas();
      unsubStats();
      unsubSuscripciones();
      unsubPending();
    };
  }, [user, isFirebaseConfigured, isLocked]);

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
          if (m.tipo === 'gasto') {
            grossGastos += m.importe;
          } else if (m.tipo === 'ingreso') {
            grossIngresos += m.importe;
          }
        });

        if (Math.abs(userStats.total_ingresos - grossIngresos) > 0.05 || Math.abs(userStats.total_gastos - grossGastos) > 0.05) {
          console.log('Restoring true GROSS historical stats...', { grossIngresos, grossGastos, userStats });
          const statsRef = doc(db, 'stats', user.uid);
          await setDoc(statsRef, {
            total_ingresos: grossIngresos,
            total_gastos: grossGastos,
            updated_at: serverTimestamp()
          }, { merge: true });
          
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

  // Re-runs the income/expense allocations on Demo local memory
  const processLocalDistribution = (tipo: 'ingreso' | 'gasto', importe: number, huchaId?: string): Hucha[] => {
    let updatedHuchas = [...huchas];
    if (tipo === 'gasto') {
      const targetHuchaId = huchaId || huchas.find(h => h.es_principal)?.id || huchas[0]?.id;
      updatedHuchas = huchas.map(h => {
        if (h.id === targetHuchaId) {
          return { ...h, saldo_acumulado: Math.max(0, h.saldo_acumulado - importe) };
        }
        return h;
      });
    } else {
      // Income distribution algorithm
      let remaining = importe;
      const rawDeltas: Record<string, number> = {};

      // 1. Flat amounts
      updatedHuchas.forEach(h => {
        if (h.tipo_aportacion === 'flat' && remaining > 0) {
          const val = h.valor_aportacion || 0;
          const toAdd = Math.min(val, remaining);
          rawDeltas[h.id] = (rawDeltas[h.id] || 0) + toAdd;
          remaining -= toAdd;
        }
      });

      // 2. Percentages
      updatedHuchas.forEach(h => {
        if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
          const perc = h.valor_aportacion || 0;
          const share = importe * (perc / 100);
          const toAdd = Math.min(share, remaining);
          rawDeltas[h.id] = (rawDeltas[h.id] || 0) + toAdd;
          remaining -= toAdd;
        }
      });

      // 3. Rest remainder
      const restoHucha = updatedHuchas.find(h => h.tipo_aportacion === 'resto') 
                     || updatedHuchas.find(h => h.es_principal)
                     || updatedHuchas[0];
      if (restoHucha && remaining > 0) {
        rawDeltas[restoHucha.id] = (rawDeltas[restoHucha.id] || 0) + remaining;
      }

      // Apply redirect overflow boundaries (topes)
      const { adjusted: finalDeltas, overflow } = redirectOverflowToResto(rawDeltas, updatedHuchas);
      if (overflow > 0.01) {
        showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }

      updatedHuchas = updatedHuchas.map(h => {
        if (finalDeltas[h.id]) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + finalDeltas[h.id]).toFixed(2)) };
        }
        return h;
      });
    }
    return updatedHuchas;
  };

  // Redirect overflow logic
  const redirectOverflowToResto = (
    deltas: Record<string, number>,
    huchasState: Hucha[]
  ): { adjusted: Record<string, number>; overflow: number; restoId: string | null } => {
    const adjusted: Record<string, number> = { ...deltas };
    let leftover = 0;

    for (const [hid, delta] of Object.entries(deltas)) {
      if (delta <= 0) continue;
      const h = huchasState.find(x => x.id === hid);
      if (!h) continue;
      if (!h.tope_objetivo || !h.objetivo || h.objetivo <= 0) continue;
      const room = Math.max(0, h.objetivo - h.saldo_acumulado);
      if (delta > room) {
        adjusted[hid] = room;
        leftover += delta - room;
      }
    }

    if (leftover <= 0) return { adjusted, overflow: 0, restoId: null };

    const restoCandidate =
      huchasState.find(h => h.tipo_aportacion === 'resto') ??
      huchasState.find(h => h.es_principal) ??
      huchasState[0];

    if (!restoCandidate) return { adjusted, overflow: leftover, restoId: null };

    const destRoom = restoCandidate.tope_objetivo && restoCandidate.objetivo
      ? Math.max(0, restoCandidate.objetivo - restoCandidate.saldo_acumulado - (adjusted[restoCandidate.id] ?? 0))
      : Infinity;
    const accepted = Math.min(leftover, destRoom);
    if (accepted > 0) {
      adjusted[restoCandidate.id] = (adjusted[restoCandidate.id] ?? 0) + accepted;
    }
    return { adjusted, overflow: leftover - accepted, restoId: restoCandidate.id };
  };

  // ----------------------------------------------------
  // Operations & Actions (Symmetrical Firebase & Demo)
  // ----------------------------------------------------

  const handleCreateOrUpdateHucha = async (newHucha: Omit<Hucha, 'id' | 'saldo_acumulado' | 'orden'>, editingId: string | null) => {
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
      updated_at: serverTimestamp()
    };

    try {
      await runTransaction(db, async (transaction) => {
        if (huchaData.es_principal) {
          const otherPrincipals = huchas.filter(h => h.es_principal && h.id !== editingId);
          for (const h of otherPrincipals) {
            transaction.update(doc(db, 'huchas', h.id), { es_principal: false, updated_at: serverTimestamp() });
          }
        }
        if (huchaData.tipo_aportacion === 'resto') {
          const otherRestos = huchas.filter(h => h.tipo_aportacion === 'resto' && h.id !== editingId);
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

  const handleDeleteHucha = async (hucha: Hucha, deleteMode?: 'auto' | 'manual', manualDistributions?: Record<string, number>) => {
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
            const updated = huchas.filter(h => h.id !== hucha.id);
            saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
            showToast('Cartera eliminada', 'success');
            setConfirmModal(null);
            return;
          }
          try {
            await deleteDoc(doc(db, 'huchas', hucha.id));
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
      const remainingHuchas = huchas.filter(h => h.id !== hucha.id);
      let dists: Record<string, number> = {};

      if (deleteMode === 'auto') {
        let remaining = hucha.saldo_acumulado;
        remainingHuchas.forEach(h => {
          if (h.tipo_aportacion === 'flat' && remaining > 0) {
            const val = h.valor_aportacion || 0;
            const toAdd = Math.min(val, remaining);
            dists[h.id] = toAdd;
            remaining -= toAdd;
          }
        });
        remainingHuchas.forEach(h => {
          if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
            const perc = h.valor_aportacion || 0;
            let toAdd = hucha.saldo_acumulado * (perc / 100);
            toAdd = Math.min(toAdd, remaining);
            dists[h.id] = (dists[h.id] || 0) + toAdd;
            remaining -= toAdd;
          }
        });
        let restoH = remainingHuchas.find(h => h.tipo_aportacion === 'resto') 
                  || remainingHuchas.find(h => h.es_principal)
                  || remainingHuchas[0];
        if (restoH && remaining > 0) {
          dists[restoH.id] = (dists[restoH.id] || 0) + remaining;
        }
      } else {
        dists = manualDistributions || {};
      }

      const updated = remainingHuchas.map(h => {
        const delta = dists[h.id] || 0;
        return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
      });

      saveDemoState(movimientos, updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Cartera eliminada y fondos repartidos', 'success');
      return;
    }

    // Symmetrical for Firebase
    try {
      await runTransaction(db, async (transaction) => {
        const remainingHuchas = huchas.filter(h => h.id !== hucha.id);
        let dists: Record<string, number> = {};
        
        if (deleteMode === 'auto') {
          let remaining = hucha.saldo_acumulado;
          remainingHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              dists[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          remainingHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              let toAdd = hucha.saldo_acumulado * (perc / 100);
              toAdd = Math.min(toAdd, remaining);
              dists[h.id] = (dists[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          let restoH = remainingHuchas.find(h => h.tipo_aportacion === 'resto') 
                        || remainingHuchas.find(h => h.es_principal)
                        || remainingHuchas[0];
          if (restoH && remaining > 0) {
            dists[restoH.id] = (dists[restoH.id] || 0) + remaining;
          }
        } else {
          dists = manualDistributions || {};
        }

        const huchaRefs = remainingHuchas.map(h => doc(db, 'huchas', h.id));
        const huchaDocs = await Promise.all(huchaRefs.map(ref => transaction.get(ref)));
        
        transaction.delete(doc(db, 'huchas', hucha.id));
        
        huchaDocs.forEach(d => {
          if (d.exists() && dists[d.id]) {
            transaction.update(d.ref, {
              saldo_acumulado: (d.data().saldo_acumulado || 0) + dists[d.id],
              updated_at: serverTimestamp()
            });
          }
        });
      });
      showToast('Cartera eliminada y fondos repartidos', 'success');
    } catch (error: any) {
      console.error('Error distribuyendo hucha:', error);
      showToast(error.message || 'Error al eliminar la hucha.');
    }
  };

  const handleTransfer = async (fromHuchaId: string, toHuchaId: string, amount: number) => {
    if (fromHuchaId === toHuchaId) {
      showToast('Debes seleccionar carteras distintas.');
      return;
    }

    const { adjusted: transferDeltas, overflow: transferOverflow, restoId: transferRestoId } =
      redirectOverflowToResto({ [toHuchaId]: amount }, huchas);

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

        transaction.update(fromRef, { saldo_acumulado: fromBalance - amount, updated_at: serverTimestamp() });
        const toDelta = transferDeltas[toHuchaId] ?? 0;
        if (toDelta > 0) {
          transaction.update(toRef, { saldo_acumulado: (toDoc.data().saldo_acumulado || 0) + toDelta, updated_at: serverTimestamp() });
        }
        if (restoRef && restoDoc?.exists()) {
          const restoDelta = transferDeltas[transferRestoId!] ?? 0;
          if (restoDelta > 0) {
            transaction.update(restoRef, { saldo_acumulado: (restoDoc.data().saldo_acumulado || 0) + restoDelta, updated_at: serverTimestamp() });
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

  const handleUpdateMovimientoConcepto = async (movId: string, newConcepto: string) => {
    if (!newConcepto.trim()) return;
    
    if (!isFirebaseConfigured) {
      const updated = movimientos.map(m => m.id === movId ? { ...m, concepto: newConcepto.trim() } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Concepto actualizado', 'success');
      return;
    }

    try {
      const movRef = doc(db, 'movimientos', movId);
      await runTransaction(db, async (transaction) => {
        transaction.update(movRef, { concepto: newConcepto.trim() });
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
    if (!isFirebaseConfigured) {
      let updatedHuchas = [...huchas];
      let updatedStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      const amount = mov.importe;

      if (mov.tipo === 'gasto') {
        // Gasto -> Ingreso (reverts gasto addition on old hucha, and splits ingreso into selected rows)
        if (!rows || rows.length === 0) return;
        const shares: Record<string, number> = {};
        rows.forEach(r => {
          if (r.tipoAportacion === 'flat') shares[r.huchaId] = r.value;
          else if (r.tipoAportacion === 'porcentaje') shares[r.huchaId] = amount * (r.value / 100);
          else {
            const sumExclResto = rows.filter(x => x !== r).reduce((s, x) => s + (x.tipoAportacion === 'flat' ? x.value : amount * (x.value / 100)), 0);
            shares[r.huchaId] = amount - sumExclResto;
          }
        });

        // Deltas: Revert expenditure (+amount) + add split shares
        const rawDeltas: Record<string, number> = {};
        if (mov.hucha_id) rawDeltas[mov.hucha_id] = (rawDeltas[mov.hucha_id] || 0) + amount;
        for (const [hid, s] of Object.entries(shares)) {
          rawDeltas[hid] = (rawDeltas[hid] || 0) + s;
        }

        const { adjusted: deltas, overflow } = redirectOverflowToResto(rawDeltas, updatedHuchas);
        if (overflow > 0.01) {
          showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
        }

        updatedHuchas = updatedHuchas.map(h => {
          const delta = deltas[h.id] || 0;
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
        });

        updatedStats.total_ingresos += amount;
        updatedStats.total_gastos = Math.max(0, updatedStats.total_gastos - amount);
      } else {
        // Ingreso -> Gasto (symmetrically reverts the multi-pocket income distribution, and subtracts the new expense from the target pocket)
        if (!targetHuchaId) return;

        // Recalculate original income splits using pocket rules to cleanly revert them
        const incomeDeltas: Record<string, number> = {};
        let remIncome = amount;
        // 1. Flat
        updatedHuchas.forEach(h => {
          if (h.tipo_aportacion === 'flat' && remIncome > 0) {
            const val = h.valor_aportacion || 0;
            const toAdd = Math.min(val, remIncome);
            incomeDeltas[h.id] = toAdd;
            remIncome -= toAdd;
          }
        });
        // 2. Percentage
        updatedHuchas.forEach(h => {
          if (h.tipo_aportacion === 'porcentaje' && remIncome > 0) {
            const perc = h.valor_aportacion || 0;
            const share = amount * (perc / 100);
            const toAdd = Math.min(share, remIncome);
            incomeDeltas[h.id] = (incomeDeltas[h.id] || 0) + toAdd;
            remIncome -= toAdd;
          }
        });
        // 3. Rest
        const resto = updatedHuchas.find(h => h.tipo_aportacion === 'resto') || updatedHuchas.find(h => h.es_principal) || updatedHuchas[0];
        if (resto && remIncome > 0) {
          incomeDeltas[resto.id] = (incomeDeltas[resto.id] || 0) + remIncome;
        }

        // Apply reversion and new expense
        updatedHuchas = updatedHuchas.map(h => {
          let newBal = h.saldo_acumulado;
          // Revert split income credit
          const incomeDelta = incomeDeltas[h.id] || 0;
          newBal -= incomeDelta;
          // Subtract new expense debit if it's the target hucha
          if (h.id === targetHuchaId) {
            newBal -= amount;
          }
          return { ...h, saldo_acumulado: Number(newBal.toFixed(2)) };
        });

        updatedStats.total_ingresos = Math.max(0, updatedStats.total_ingresos - amount);
        updatedStats.total_gastos += amount;
      }

      // Update movement details
      const updatedMovs = movimientos.map(m => {
        if (m.id === mov.id) {
          if (mov.tipo === 'gasto') {
            return { ...m, tipo: 'ingreso' as const, hucha_id: undefined };
          } else {
            return { ...m, tipo: 'gasto' as const, hucha_id: targetHuchaId };
          }
        }
        return m;
      });

      saveDemoState(updatedMovs, updatedHuchas, suscripciones, updatedStats);
      showToast(mov.tipo === 'gasto' ? 'Movimiento convertido a ingreso' : 'Movimiento convertido a gasto', 'success');
      return;
    }

    // Symmetrical Firebase operations
    const amount = mov.importe;
    try {
      if (mov.tipo === 'gasto') {
        if (!rows || rows.length === 0) return;
        const shares: Record<string, number> = {};
        rows.forEach(r => {
          if (r.tipoAportacion === 'flat') shares[r.huchaId] = r.value;
          else if (r.tipoAportacion === 'porcentaje') shares[r.huchaId] = amount * (r.value / 100);
          else {
            const sumExclResto = rows.filter(x => x !== r).reduce((s, x) => s + (x.tipoAportacion === 'flat' ? x.value : amount * (x.value / 100)), 0);
            shares[r.huchaId] = amount - sumExclResto;
          }
        });

        const oldHuchaId = mov.hucha_id;
        const rawDeltas: Record<string, number> = {};
        if (oldHuchaId) rawDeltas[oldHuchaId] = (rawDeltas[oldHuchaId] || 0) + amount;
        for (const [hid, share] of Object.entries(shares)) {
          rawDeltas[hid] = (rawDeltas[hid] || 0) + share;
        }

        const { adjusted: deltas, overflow } = redirectOverflowToResto(rawDeltas, huchas);
        if (overflow > 0.01) {
          showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
        }

        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'movimientos', mov.id);
          const statsRef = doc(db, 'stats', user!.uid);
          const huchaRefs: Record<string, any> = {};
          
          for (const hid of Object.keys(deltas)) huchaRefs[hid] = doc(db, 'huchas', hid);
          const huchaSnaps: Record<string, DocumentSnapshot> = {};
          for (const hid of Object.keys(huchaRefs)) huchaSnaps[hid] = await transaction.get(huchaRefs[hid]);
          const statsSnap = await transaction.get(statsRef);

          for (const hid of Object.keys(huchaRefs)) {
            const snap = huchaSnaps[hid];
            if (!snap?.exists() || !deltas[hid]) continue;
            const cur = snap.data().saldo_acumulado || 0;
            transaction.update(huchaRefs[hid], { saldo_acumulado: cur + deltas[hid], updated_at: serverTimestamp() });
          }
          
          transaction.update(movRef, { tipo: 'ingreso', hucha_id: deleteField() });
          const curStats = statsSnap.data() || {};
          transaction.set(statsRef, {
            total_ingresos: (curStats.total_ingresos || 0) + amount,
            total_gastos: Math.max(0, (curStats.total_gastos || 0) - amount),
            updated_at: serverTimestamp(),
          }, { merge: true });
        });
        showToast('Movimiento convertido a ingreso', 'success');
      } else {
        if (!targetHuchaId) return;
        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'movimientos', mov.id);
          const statsRef = doc(db, 'stats', user!.uid);

          // Fetch all huchas in transaction to read their rules and balances
          const huchasRefs = huchas.map(h => doc(db, 'huchas', h.id));
          const huchasSnaps = [];
          for (const ref of huchasRefs) {
            huchasSnaps.push(await transaction.get(ref));
          }
          const statsSnap = await transaction.get(statsRef);

          // Calculate the original income distribution splits using the hucha rules to revert them
          const incomeDeltas: Record<string, number> = {};
          let remIncome = amount;
          // 1. Flat
          huchasSnaps.forEach((snap) => {
            const data = snap.data();
            if (data && data.tipo_aportacion === 'flat' && remIncome > 0) {
              const val = data.valor_aportacion || 0;
              const toAdd = Math.min(val, remIncome);
              incomeDeltas[snap.id] = toAdd;
              remIncome -= toAdd;
            }
          });
          // 2. Percentage
          huchasSnaps.forEach((snap) => {
            const data = snap.data();
            if (data && data.tipo_aportacion === 'porcentaje' && remIncome > 0) {
              const perc = data.valor_aportacion || 0;
              const share = amount * (perc / 100);
              const toAdd = Math.min(share, remIncome);
              incomeDeltas[snap.id] = (incomeDeltas[snap.id] || 0) + toAdd;
              remIncome -= toAdd;
            }
          });
          // 3. Rest
          const restoSnap = huchasSnaps.find(s => s.exists() && s.data()?.tipo_aportacion === 'resto')
                         || huchasSnaps.find(s => s.exists() && s.data()?.es_principal)
                         || huchasSnaps[0];
          if (restoSnap && remIncome > 0) {
            incomeDeltas[restoSnap.id] = (incomeDeltas[restoSnap.id] || 0) + remIncome;
          }

          // Apply updates to each hucha's accumulated balance
          huchasSnaps.forEach((snap) => {
            if (!snap.exists()) return;
            const currentBal = snap.data().saldo_acumulado || 0;
            const incomeDelta = incomeDeltas[snap.id] || 0;

            let finalBal = currentBal - incomeDelta;
            if (snap.id === targetHuchaId) {
              finalBal -= amount;
            }

            transaction.update(doc(db, 'huchas', snap.id), {
              saldo_acumulado: Number(finalBal.toFixed(2)),
              updated_at: serverTimestamp()
            });
          });

          // Update movement details
          transaction.update(movRef, { tipo: 'gasto', hucha_id: targetHuchaId });

          // Update stats
          const curStats = statsSnap.data() || {};
          transaction.set(statsRef, {
            total_ingresos: Math.max(0, (curStats.total_ingresos || 0) - amount),
            total_gastos: (curStats.total_gastos || 0) + amount,
            updated_at: serverTimestamp(),
          }, { merge: true });
        });
        showToast('Movimiento convertido a gasto', 'success');
      }
    } catch (error) {
      console.error('Error convirtiendo movimiento:', error);
      showToast('Error al convertir el movimiento');
    }
  };

  const handleLinkMovimiento = async (gasto: Movimiento, ingresos: Movimiento[]) => {
    const totalIngresos = ingresos.reduce((s, m) => s + m.importe, 0);

    if (!isFirebaseConfigured) {
      const updatedMovs = movimientos.map(m => {
        if (m.id === gasto.id) {
          const compPor = [...(m.compensado_por || []), ...ingresos.map(i => i.id)];
          const oldNeto = m.importe_neto ?? m.importe;
          const neto = Math.max(0, m.importe - (m.importe - oldNeto) - totalIngresos);
          return { ...m, compensado_por: compPor, importe_neto: neto };
        }
        if (ingresos.find(i => i.id === m.id)) {
          return { ...m, compensa_movimiento_id: gasto.id };
        }
        return m;
      });

      const updatedStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      // Stats stay as Gross (no compensation subtracted)

      saveDemoState(updatedMovs, huchas, suscripciones, updatedStats);
      showToast('Movimientos vinculados', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const gastoRef = doc(db, 'movimientos', gasto.id);
        const ingresoRefs = ingresos.map(i => doc(db, 'movimientos', i.id));

        const gastoSnap = await transaction.get(gastoRef);
        if (!gastoSnap.exists()) throw new Error('Gasto no existe');
        const gastoData = gastoSnap.data() as Movimiento;

        const compPor = [...(gastoData.compensado_por || []), ...ingresos.map(i => i.id)];
        const prevCompensado = (gastoData.compensado_por || []).reduce((s, id) => {
          const m = movimientos.find(x => x.id === id);
          return s + (m ? m.importe : 0);
        }, 0);
        
        const neto = Math.max(0, gastoData.importe - prevCompensado - totalIngresos);

        transaction.update(gastoRef, { compensado_por: compPor, importe_neto: neto, updated_at: serverTimestamp() });
        for (const ref of ingresoRefs) {
          transaction.update(ref, { compensa_movimiento_id: gasto.id, updated_at: serverTimestamp() });
        }
      });
      showToast('Movimientos vinculados', 'success');
    } catch (error: any) {
      console.error('Error vinculando:', error);
      showToast(error.message || 'Error al vincular');
    }
  };

  const handleUnlinkMovimiento = async (ingreso: Movimiento) => {
    if (!ingreso.compensa_movimiento_id) return;
    const gastoId = ingreso.compensa_movimiento_id;

    if (!isFirebaseConfigured) {
      const updatedMovs = movimientos.map(m => {
        if (m.id === gastoId) {
          const compPor = (m.compensado_por || []).filter(id => id !== ingreso.id);
          const prevCompSinEste = compPor.reduce((s, id) => {
            const mv = movimientos.find(x => x.id === id);
            return s + (mv ? mv.importe : 0);
          }, 0);
          const neto = Math.max(0, m.importe - prevCompSinEste);
          
          return {
            ...m,
            compensado_por: compPor.length > 0 ? compPor : null,
            importe_neto: compPor.length > 0 ? neto : null
          };
        }
        if (m.id === ingreso.id) {
          return { ...m, compensa_movimiento_id: null };
        }
        return m;
      });

      const updatedStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      // Stats stay as Gross

      saveDemoState(updatedMovs, huchas, suscripciones, updatedStats);
      showToast('Vínculo deshecho', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const gastoRef = doc(db, 'movimientos', gastoId);
        const ingresoRef = doc(db, 'movimientos', ingreso.id);

        const gastoSnap = await transaction.get(gastoRef);

        if (gastoSnap.exists()) {
          const gastoData = gastoSnap.data() as Movimiento;
          const compPor = (gastoData.compensado_por || []).filter(id => id !== ingreso.id);
          const prevCompSinEste = compPor.reduce((s, id) => {
            const mv = movimientos.find(x => x.id === id);
            return s + (mv ? mv.importe : 0);
          }, 0);
          
          const neto = Math.max(0, gastoData.importe - prevCompSinEste);
          
          transaction.update(gastoRef, {
            compensado_por: compPor.length > 0 ? compPor : deleteField(),
            importe_neto: compPor.length > 0 ? neto : deleteField(),
            updated_at: serverTimestamp()
          });
        }

        transaction.update(ingresoRef, { compensa_movimiento_id: deleteField(), updated_at: serverTimestamp() });
      });
      showToast('Vínculo deshecho', 'success');
    } catch (error: any) {
      console.error('Error desvinculando:', error);
      showToast('Error al desvincular');
    }
  };

  const handleChangeMovimientoHucha = async (mov: Movimiento, newHuchaId: string) => {
    if (!newHuchaId || mov.hucha_id === newHuchaId) return;
    const oldHuchaId = mov.hucha_id;

    // La hucha antigua recibe +importe (revertir el gasto). Pasar por el tope.
    const rawDeltas: Record<string, number> = oldHuchaId
      ? { [oldHuchaId]: mov.importe }
      : {};
    const { adjusted: changeDeltas, overflow: changeOverflow, restoId: changeRestoId } =
      redirectOverflowToResto(rawDeltas, huchas);

    if (!isFirebaseConfigured) {
      const updatedHuchas = huchas.map(h => {
        let bal = h.saldo_acumulado;
        if (h.id === newHuchaId) {
          bal = bal - mov.importe;
        }
        const delta = changeDeltas[h.id] || 0;
        return { ...h, saldo_acumulado: Number((bal + delta).toFixed(2)) };
      });

      const updatedMovs = movimientos.map(m => m.id === mov.id ? { ...m, hucha_id: newHuchaId } : m);
      saveDemoState(updatedMovs, updatedHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      if (changeOverflow > 0.01) {
        showToast(`${changeOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      showToast('Gasto reasignado', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const newHuchaRef = doc(db, 'huchas', newHuchaId);
        const oldHuchaRef = oldHuchaId ? doc(db, 'huchas', oldHuchaId) : null;
        const restoRef = changeRestoId && changeRestoId !== oldHuchaId && changeRestoId !== newHuchaId
          ? doc(db, 'huchas', changeRestoId)
          : null;

        const newHuchaDoc = await transaction.get(newHuchaRef);
        const oldHuchaDoc = oldHuchaRef ? await transaction.get(oldHuchaRef) : null;
        const restoDoc = restoRef ? await transaction.get(restoRef) : null;

        if (oldHuchaRef && oldHuchaDoc && oldHuchaDoc.exists()) {
          const oldDelta = oldHuchaId ? (changeDeltas[oldHuchaId] ?? 0) : 0;
          if (oldDelta !== 0) {
            transaction.update(oldHuchaRef, {
              saldo_acumulado: (oldHuchaDoc.data().saldo_acumulado || 0) + oldDelta
            });
          }
        }

        if (newHuchaDoc.exists()) {
          transaction.update(newHuchaRef, {
            saldo_acumulado: (newHuchaDoc.data().saldo_acumulado || 0) - mov.importe
          });
        }

        if (restoRef && restoDoc?.exists() && changeRestoId) {
          const restoDelta = changeDeltas[changeRestoId] ?? 0;
          if (restoDelta > 0) {
            transaction.update(restoRef, {
              saldo_acumulado: (restoDoc.data().saldo_acumulado || 0) + restoDelta,
              updated_at: serverTimestamp(),
            });
          }
        }

        transaction.update(movRef, { hucha_id: newHuchaId });
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

  const syncSuscripcionesHucha = async (updatedList: Suscripcion[], localHuchasState?: Hucha[]): Promise<Hucha[] | undefined> => {
    const totalMensual = updatedList
      .filter(s => s.activa)
      .reduce((sum, s) => sum + calcMensual(s), 0);
    const rounded = Math.round(totalMensual * 100) / 100;

    const currentHuchas = localHuchasState || huchas;
    const suscripcionesHucha = currentHuchas.find(h => h.es_suscripciones);

    if (!isFirebaseConfigured) {
      let nextHuchas = [...currentHuchas];
      if (suscripcionesHucha) {
        nextHuchas = currentHuchas.map(h => {
          if (h.es_suscripciones) {
            return { ...h, objetivo: rounded > 0 ? rounded : null, valor_aportacion: rounded };
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
          es_suscripciones: true
        });
      }
      return nextHuchas;
    }

    if (!user) return;
    if (suscripcionesHucha) {
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'huchas', suscripcionesHucha.id), {
          objetivo: rounded > 0 ? rounded : null,
          valor_aportacion: rounded,
          updated_at: serverTimestamp(),
        });
      });
    } else if (rounded > 0) {
      const newDocRef = doc(collection(db, 'huchas'));
      await runTransaction(db, async (transaction) => {
        transaction.set(newDocRef, {
          id_propietario: user.uid,
          nombre: 'Suscripciones',
          tipo_aportacion: 'flat',
          valor_aportacion: rounded,
          objetivo: rounded,
          saldo_acumulado: 0,
          orden: currentHuchas.length + 1,
          es_principal: false,
          es_suscripciones: true,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      });
    }
  };

  const handleCreateOrUpdateSuscripcion = async (newSub: Omit<Suscripcion, 'id' | 'created_at'>, editingSubId: string | null) => {
    if (!isFirebaseConfigured) {
      let updatedSubs = [...suscripciones];
      if (editingSubId) {
        updatedSubs = suscripciones.map(s => s.id === editingSubId ? { ...s, ...newSub } : s);
      } else {
        const id = 's-' + Math.random().toString(36).substr(2, 9);
        updatedSubs.push({ id, ...newSub });
      }
      const nextHuchas = await syncSuscripcionesHucha(updatedSubs);
      saveDemoState(movimientos, nextHuchas || huchas, updatedSubs, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast(editingSubId ? 'Suscripción actualizada' : 'Suscripción creada', 'success');
      return;
    }

    if (!user) return;
    const data = {
      id_propietario: user.uid,
      nombre: newSub.nombre.trim(),
      importe: Number(newSub.importe),
      frecuencia: newSub.frecuencia,
      dia_pago: Number(newSub.dia_pago),
      categoria: newSub.categoria,
      color: newSub.color,
      activa: newSub.activa,
      hucha_id: newSub.hucha_id || null,
      mi_parte: newSub.mi_parte ?? null,
      updated_at: serverTimestamp(),
    };

    try {
      let updatedList: Suscripcion[];
      if (editingSubId) {
        await runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'suscripciones', editingSubId), data);
        });
        updatedList = suscripciones.map(s => s.id === editingSubId ? { ...s, ...data } : s);
      } else {
        const newDocRef = doc(collection(db, 'suscripciones'));
        await runTransaction(db, async (transaction) => {
          transaction.set(newDocRef, { ...data, created_at: serverTimestamp() });
        });
        updatedList = [...suscripciones, { id: newDocRef.id, ...data } as unknown as Suscripcion];
      }

      await syncSuscripcionesHucha(updatedList);
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
          await deleteDoc(doc(db, 'suscripciones', s.id));
          const updatedList = suscripciones.filter(sub => sub.id !== s.id);
          await syncSuscripcionesHucha(updatedList);
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
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'suscripciones', s.id), { activa: !s.activa, updated_at: serverTimestamp() });
      });
      const updatedList = suscripciones.map(sub => sub.id === s.id ? { ...sub, activa: !sub.activa } : sub);
      await syncSuscripcionesHucha(updatedList);
    } catch (error) {
      console.error('Error al cambiar estado suscripción:', error);
      showToast('Error al actualizar la suscripción');
    }
  };

  const handleCancelSuscripcion = (s: Suscripcion) => {
    const nextDate = getNextPaymentDate(s.dia_pago);
    const label = nextDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    setConfirmModal({
      title: 'Cancelar Suscripción',
      message: `"${s.nombre}" se eliminará automáticamente el ${label} (próximo cobro). Hasta entonces sigue activa.`,
      confirmLabel: 'Cancelar',
      onConfirm: async () => {
        if (!isFirebaseConfigured) {
          const updated = suscripciones.map(sub => sub.id === s.id ? { ...sub, cancelando: true } : sub);
          saveDemoState(movimientos, huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
          showToast(`${s.nombre} se cancelará el ${label}`, 'success');
          setConfirmModal(null);
          return;
        }
        try {
          await runTransaction(db, async (transaction) => {
            transaction.update(doc(db, 'suscripciones', s.id), { cancelando: true, updated_at: serverTimestamp() });
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
      const updated = suscripciones.map(sub => sub.id === s.id ? { ...sub, cancelando: false } : sub);
      saveDemoState(movimientos, huchas, updated, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast(`${s.nombre} reactivada`, 'success');
      return;
    }

    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'suscripciones', s.id), { cancelando: false, updated_at: serverTimestamp() });
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
    const amt = Number(movData.importe);
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
        const hid = movData.hucha_id || huchas.find(h => h.es_principal)?.id || huchas[0]?.id;
        nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
      } else {
        const hid = movData.hucha_id;
        if (hid) {
          nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
        } else {
          // Distribute
          const deltas: Record<string, number> = {};
          let remaining = amt;
          // 1. Flat
          huchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Percentage
          huchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Rest
          const resto = huchas.find(h => h.tipo_aportacion === 'resto') || huchas.find(h => h.es_principal) || huchas[0];
          if (resto && remaining > 0) {
            deltas[resto.id] = (deltas[resto.id] || 0) + remaining;
          }
          // Add deltas
          nextHuchas = huchas.map(h => {
            const delta = deltas[h.id] || 0;
            return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
          });
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
        const movRef = doc(collection(db, 'movimientos'));
        const statsRef = doc(db, 'stats', user!.uid);

        // Get stats
        const statsSnap = await transaction.get(statsRef);
        const currentStats = statsSnap.data() || { total_ingresos: 0, total_gastos: 0 };

        // Get selected hucha (or principal)
        let targetHuchaId = movData.hucha_id;
        if (!isIngreso && !targetHuchaId) {
          targetHuchaId = huchas.find(h => h.es_principal)?.id || huchas[0]?.id;
        }

        let distributions: Record<string, number> = {};

        if (!isIngreso) {
          // Expense
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal - amt, updated_at: serverTimestamp() });
            }
          }
        } else {
          // Income distribution
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal + amt, updated_at: serverTimestamp() });
            }
          } else {
            // Standard auto-reparto
            let remaining = amt;
            // Fetch current huchas in transaction
            const huchasRefs = huchas.map(h => doc(db, 'huchas', h.id));
            const huchasSnaps = [];
            for (const ref of huchasRefs) {
              huchasSnaps.push(await transaction.get(ref));
            }

            // 1. Flat
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'flat' && remaining > 0) {
                const val = data.valor_aportacion || 0;
                const toAdd = Math.min(val, remaining);
                distributions[snap.id] = toAdd;
                remaining -= toAdd;
              }
            });
            // 2. Percentage
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'porcentaje' && remaining > 0) {
                const perc = data.valor_aportacion || 0;
                const share = amt * (perc / 100);
                const toAdd = Math.min(share, remaining);
                distributions[snap.id] = (distributions[snap.id] || 0) + toAdd;
                remaining -= toAdd;
              }
            });
            // 3. Rest
            const restoSnap = huchasSnaps.find(s => s.exists() && s.data()?.tipo_aportacion === 'resto')
                           || huchasSnaps.find(s => s.exists() && s.data()?.es_principal)
                           || huchasSnaps[0];
            if (restoSnap && remaining > 0) {
              distributions[restoSnap.id] = (distributions[restoSnap.id] || 0) + remaining;
            }

            // Apply balances updates
            huchasSnaps.forEach(snap => {
              const change = distributions[snap.id] || 0;
              const data = snap.data();
              if (change > 0 && data) {
                const bal = data.saldo_acumulado || 0;
                transaction.update(doc(db, 'huchas', snap.id), { saldo_acumulado: bal + change, updated_at: serverTimestamp() });
              }
            });
          }
        }

        // Create movement document
        transaction.set(movRef, {
          id_propietario: user!.uid,
          tipo: movData.tipo,
          concepto: movData.concepto.trim(),
          importe: amt,
          fecha_operacion: new Date(movData.fecha_operacion),
          hucha_id: targetHuchaId || null,
          created_at: serverTimestamp()
        });

        // Update stats
        const nextStats = { ...currentStats };
        if (isIngreso) {
          nextStats.total_ingresos = (nextStats.total_ingresos || 0) + amt;
        } else {
          nextStats.total_gastos = (nextStats.total_gastos || 0) + amt;
        }
        transaction.set(statsRef, nextStats, { merge: true });

        // Delete pending email from manual queue
        transaction.delete(emailRef);
      });

      showToast('Movimiento aprobado y registrado', 'success');
    } catch (error) {
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
      await deleteDoc(doc(db, 'correos_pendientes', emailId));
      showToast('Correo descartado', 'success');
    } catch (error) {
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
  }) => {
    const amt = Number(movData.importe);
    const isIngreso = movData.tipo === 'ingreso';
    const isMetalico = !!movData.es_metalico;

    if (!isFirebaseConfigured) {
      // 1. MODO DEMO
      let nextHuchas = [...huchas];
      let targetHuchaId = movData.hucha_id;

      // Provisionar hucha de Efectivo si es metálico y no existe
      if (isMetalico) {
        let cashHucha = nextHuchas.find(h => h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo'));
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
        es_metalico: isMetalico
      };

      if (!isIngreso) {
        // Gasto
        const hid = targetHuchaId || nextHuchas.find(h => h.es_principal)?.id || nextHuchas[0]?.id;
        nextHuchas = nextHuchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
      } else {
        // Ingreso
        if (targetHuchaId) {
          nextHuchas = nextHuchas.map(h => h.id === targetHuchaId ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
        } else {
          // Auto-reparto estándar
          const deltas: Record<string, number> = {};
          let remaining = amt;
          // 1. Flat
          nextHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Porcentaje
          nextHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Resto
          const resto = nextHuchas.find(h => h.tipo_aportacion === 'resto') || nextHuchas.find(h => h.es_principal) || nextHuchas[0];
          if (resto && remaining > 0) {
            deltas[resto.id] = (deltas[resto.id] || 0) + remaining;
          }
          // Redirigir desbordamiento (topes)
          const { adjusted: finalDeltas, overflow } = redirectOverflowToResto(deltas, nextHuchas);
          if (overflow > 0.01) {
            showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
          }
          // Sumar deltas
          nextHuchas = nextHuchas.map(h => {
            const delta = finalDeltas[h.id] || 0;
            return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
          });
        }
      }

      const nextMovs = [newMov, ...movimientos];
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (isIngreso) nextStats.total_ingresos += amt;
      else nextStats.total_gastos += amt;

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
      showToast('Movimiento registrado correctamente', 'success');
      return;
    }

    // 2. MODO FIREBASE
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', user.uid);
        const statsSnap = await transaction.get(statsRef);
        const currentStats = statsSnap.data() || { total_ingresos: 0, total_gastos: 0 };

        let targetHuchaId = movData.hucha_id;
        let createdCashHuchaId: string | null = null;
        let nextHuchasState = [...huchas];

        // Provisionar hucha de Efectivo si es metálico y no existe
        if (isMetalico) {
          let cashHucha = nextHuchasState.find(h => h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo'));
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
              created_at: serverTimestamp(),
              updated_at: serverTimestamp()
            };
            transaction.set(newHuchaRef, cashData);
            createdCashHuchaId = newHuchaRef.id;
            targetHuchaId = newHuchaRef.id;
            
            // Añadir al estado local temporal
            nextHuchasState.push({ id: newHuchaRef.id, ...cashData } as unknown as Hucha);
          } else {
            targetHuchaId = cashHucha.id;
          }
        }

        if (!isIngreso) {
          // Gasto
          const hid = targetHuchaId || nextHuchasState.find(h => h.es_principal)?.id || nextHuchasState[0]?.id;
          if (hid) {
            const huchaRef = doc(db, 'huchas', hid);
            let bal = 0;
            if (hid !== createdCashHuchaId) {
              const huchaSnap = await transaction.get(huchaRef);
              if (huchaSnap.exists()) {
                bal = huchaSnap.data().saldo_acumulado || 0;
              }
            }
            transaction.update(huchaRef, { saldo_acumulado: bal - amt, updated_at: serverTimestamp() });
          }
        } else {
          // Ingreso
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            let bal = 0;
            if (targetHuchaId !== createdCashHuchaId) {
              const huchaSnap = await transaction.get(huchaRef);
              if (huchaSnap.exists()) {
                bal = huchaSnap.data().saldo_acumulado || 0;
              }
            }
            transaction.update(huchaRef, { saldo_acumulado: bal + amt, updated_at: serverTimestamp() });
          } else {
            // Auto-reparto bancario estándar
            let remaining = amt;
            const huchasRefs = nextHuchasState.map(h => doc(db, 'huchas', h.id));
            const huchasSnaps = [];
            for (const ref of huchasRefs) {
              if (ref.id === createdCashHuchaId) {
                huchasSnaps.push({ id: ref.id, exists: () => true, data: () => ({ id: ref.id, nombre: 'Efectivo', tipo_aportacion: 'flat', valor_aportacion: 0, saldo_acumulado: 0 }) });
              } else {
                huchasSnaps.push(await transaction.get(ref));
              }
            }

            const distributions: Record<string, number> = {};

            // 1. Flat
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'flat' && remaining > 0) {
                const val = data.valor_aportacion || 0;
                const toAdd = Math.min(val, remaining);
                distributions[snap.id] = toAdd;
                remaining -= toAdd;
              }
            });
            // 2. Porcentaje
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'porcentaje' && remaining > 0) {
                const perc = data.valor_aportacion || 0;
                const share = amt * (perc / 100);
                const toAdd = Math.min(share, remaining);
                distributions[snap.id] = (distributions[snap.id] || 0) + toAdd;
                remaining -= toAdd;
              }
            });
            // 3. Resto
            const restoSnap = huchasSnaps.find(s => s.exists() && (s.data() as any)?.tipo_aportacion === 'resto')
                           || huchasSnaps.find(s => s.exists() && (s.data() as any)?.es_principal)
                           || huchasSnaps[0];
            if (restoSnap && remaining > 0) {
              distributions[restoSnap.id] = (distributions[restoSnap.id] || 0) + remaining;
            }

            // Aplicar saldos actualizados
            huchasSnaps.forEach(snap => {
              const change = distributions[snap.id] || 0;
              const data = snap.data();
              if (change > 0 && data) {
                const bal = data.saldo_acumulado || 0;
                transaction.update(doc(db, 'huchas', snap.id), { saldo_acumulado: bal + change, updated_at: serverTimestamp() });
              }
            });
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
          es_metalico: isMetalico,
          created_at: serverTimestamp()
        });

        // Actualizar estadísticas
        const nextStats = { ...currentStats };
        if (isIngreso) {
          nextStats.total_ingresos = (nextStats.total_ingresos || 0) + amt;
        } else {
          nextStats.total_gastos = (nextStats.total_gastos || 0) + amt;
        }
        transaction.set(statsRef, nextStats, { merge: true });
      });

      showToast('Movimiento registrado correctamente', 'success');
    } catch (error) {
      console.error('Error creating manual movement:', error);
      showToast('Error al registrar el movimiento.');
    }
  };

  const handleDeleteMovimiento = async (mov: Movimiento) => {
    const amt = Number(mov.importe);
    const isIngreso = mov.tipo === 'ingreso';

    if (!isFirebaseConfigured) {
      // 1. MODO DEMO
      let nextHuchas = [...huchas];

      if (!isIngreso) {
        // Gasto: revertir sumando de vuelta
        const hid = mov.hucha_id || huchas.find(h => h.es_principal)?.id || huchas[0]?.id;
        nextHuchas = nextHuchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
      } else {
        // Ingreso: revertir restando
        if (mov.hucha_id) {
          nextHuchas = nextHuchas.map(h => h.id === mov.hucha_id ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
        } else {
          // Revertir auto-reparto estándar
          const deltas: Record<string, number> = {};
          let remaining = amt;
          // 1. Flat
          nextHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Porcentaje
          nextHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Resto
          const resto = nextHuchas.find(h => h.tipo_aportacion === 'resto') || nextHuchas.find(h => h.es_principal) || nextHuchas[0];
          if (resto && remaining > 0) {
            deltas[resto.id] = (deltas[resto.id] || 0) + remaining;
          }
          // Redirigir desbordamiento (topes)
          const { adjusted: finalDeltas } = redirectOverflowToResto(deltas, nextHuchas);
          // Restar deltas para revertir
          nextHuchas = nextHuchas.map(h => {
            const delta = finalDeltas[h.id] || 0;
            return { ...h, saldo_acumulado: Number((h.saldo_acumulado - delta).toFixed(2)) };
          });
        }
      }

      const nextMovs = movimientos.filter(m => m.id !== mov.id);
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (isIngreso) nextStats.total_ingresos = Math.max(0, nextStats.total_ingresos - amt);
      else nextStats.total_gastos = Math.max(0, nextStats.total_gastos - amt);

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
      showToast('Movimiento eliminado', 'success');
      return;
    }

    // 2. MODO FIREBASE
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const statsRef = doc(db, 'stats', user.uid);
        const statsSnap = await transaction.get(statsRef);
        const currentStats = statsSnap.data() || { total_ingresos: 0, total_gastos: 0 };

        if (!isIngreso) {
          // Gasto: revertir sumando de vuelta
          const hid = mov.hucha_id || huchas.find(h => h.es_principal)?.id || huchas[0]?.id;
          if (hid) {
            const huchaRef = doc(db, 'huchas', hid);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal + amt, updated_at: serverTimestamp() });
            }
          }
        } else {
          // Ingreso: revertir restando
          if (mov.hucha_id) {
            const huchaRef = doc(db, 'huchas', mov.hucha_id);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal - amt, updated_at: serverTimestamp() });
            }
          } else {
            // Revertir auto-reparto bancario estándar
            let remaining = amt;
            const huchasRefs = huchas.map(h => doc(db, 'huchas', h.id));
            const huchasSnaps = [];
            for (const ref of huchasRefs) {
              huchasSnaps.push(await transaction.get(ref));
            }

            const distributions: Record<string, number> = {};

            // 1. Flat
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'flat' && remaining > 0) {
                const val = data.valor_aportacion || 0;
                const toAdd = Math.min(val, remaining);
                distributions[snap.id] = toAdd;
                remaining -= toAdd;
              }
            });
            // 2. Porcentaje
            huchasSnaps.forEach((snap) => {
              const data = snap.data();
              if (data && data.tipo_aportacion === 'porcentaje' && remaining > 0) {
                const perc = data.valor_aportacion || 0;
                const share = amt * (perc / 100);
                const toAdd = Math.min(share, remaining);
                distributions[snap.id] = (distributions[snap.id] || 0) + toAdd;
                remaining -= toAdd;
              }
            });
            // 3. Resto
            const restoSnap = huchasSnaps.find(s => s.exists() && (s.data() as any)?.tipo_aportacion === 'resto')
                           || huchasSnaps.find(s => s.exists() && (s.data() as any)?.es_principal)
                           || huchasSnaps[0];
            if (restoSnap && remaining > 0) {
              distributions[restoSnap.id] = (distributions[restoSnap.id] || 0) + remaining;
            }

            // Restar deltas de cada hucha
            huchasSnaps.forEach(snap => {
              const change = distributions[snap.id] || 0;
              const data = snap.data();
              if (change > 0 && data) {
                const bal = data.saldo_acumulado || 0;
                transaction.update(doc(db, 'huchas', snap.id), { saldo_acumulado: bal - change, updated_at: serverTimestamp() });
              }
            });
          }
        }

        // Eliminar el documento del movimiento
        transaction.delete(movRef);

        // Actualizar estadísticas
        const nextStats = { ...currentStats };
        if (isIngreso) {
          nextStats.total_ingresos = Math.max(0, (nextStats.total_ingresos || 0) - amt);
        } else {
          nextStats.total_gastos = Math.max(0, (nextStats.total_gastos || 0) - amt);
        }
        transaction.set(statsRef, nextStats, { merge: true });
      });

      showToast('Movimiento eliminado', 'success');
    } catch (error) {
      console.error('Error deleting movement:', error);
      showToast('Error al eliminar el movimiento.');
    }
  };

  // Auto-delete cancel-pending expired subscriptions
  useEffect(() => {
    if (suscripciones.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expired = suscripciones.filter(s => {
      if (!s.cancelando) return false;
      const next = getNextPaymentDate(s.dia_pago);
      return today >= next;
    });
    if (expired.length === 0) return;

    const processAutoDeletion = async () => {
      if (!isFirebaseConfigured) {
        const remaining = suscripciones.filter(s => !expired.find(e => e.id === s.id));
        const nextHuchas = await syncSuscripcionesHucha(remaining);
        saveDemoState(movimientos, nextHuchas || huchas, remaining, userStats || { total_ingresos: 0, total_gastos: 0 });
        return;
      }
      if (!user) return;
      for (const s of expired) {
        try {
          await deleteDoc(doc(db, 'suscripciones', s.id));
        } catch (e) {
          console.error('Error deleting expired subscription:', e);
        }
      }
      const remaining = suscripciones.filter(s => !expired.find(e => e.id === s.id));
      await syncSuscripcionesHucha(remaining);
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
      hucha_id: tipo === 'gasto' ? (selectedHuchaId || huchas.find(h => h.es_principal)?.id || huchas[0]?.id) : undefined
    };

    const nextHuchas = processLocalDistribution(tipo, importe, addedMov.hucha_id);
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

  const mediaIngresos = useMemo(() => {
    const monthlyIngresos: Record<string, number> = {};
    chartMovements.forEach((m) => {
      if (m.tipo !== 'ingreso') return;
      const date = parseMovimientoDate(m.fecha_operacion);
      if (!date) return;
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      monthlyIngresos[key] = (monthlyIngresos[key] || 0) + m.importe;
    });

    const validMonths = Object.values(monthlyIngresos).filter((amount) => amount > 900);
    if (validMonths.length === 0) return 0;

    const sum = validMonths.reduce((a, b) => a + b, 0);
    return Number((sum / validMonths.length).toFixed(2));
  }, [chartMovements]);

  const huchaMonthlyBudgets = useMemo(() => {
    const budgets: Record<string, number> = {};
    if (mediaIngresos <= 0) return budgets;
    
    let remaining = mediaIngresos;

    // 1. Flat amounts
    huchas.forEach((h) => {
      if (h.tipo_aportacion === 'flat' && remaining > 0) {
        const val = h.valor_aportacion || 0;
        const toAdd = Math.min(val, remaining);
        budgets[h.id] = toAdd;
        remaining -= toAdd;
      }
    });

    // 2. Percentages
    huchas.forEach((h) => {
      if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
        const perc = h.valor_aportacion || 0;
        const share = mediaIngresos * (perc / 100);
        const toAdd = Math.min(share, remaining);
        budgets[h.id] = (budgets[h.id] || 0) + toAdd;
        remaining -= toAdd;
      }
    });

    // 3. Resto
    const restoHucha =
      huchas.find((h) => h.tipo_aportacion === 'resto') ||
      huchas.find((h) => h.es_principal) ||
      huchas[0];

    if (restoHucha && remaining > 0) {
      budgets[restoHucha.id] = (budgets[restoHucha.id] || 0) + remaining;
    }

    return budgets;
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
    const months: Record<string, { name: string; ingresos: number; gastos: number }> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const name = d.toLocaleDateString('es-ES', { month: 'short' });
      months[key] = { name, ingresos: 0, gastos: 0 };
    }
    chartMovements.forEach((m) => {
      const date = parseMovimientoDate(m.fecha_operacion) || new Date();
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (months[key]) {
        if (m.tipo === 'ingreso') months[key].ingresos += m.importe;
        else months[key].gastos += m.importe;
      }
    });
    return Object.values(months);
  }, [chartMovements]);

  return {
    user,
    loading,
    isFirebaseConfigured,
    movimientos,
    chartMovements,
    huchas,
    suscripciones,
    pendingEmails,
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
    handleTransfer,
    handleUpdateMovimientoConcepto,
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
    injectDemoMovement,
  };
};

function onAuthStateChanged(auth: any, callback: (user: User | null) => void) {
  // Symmetrical dummy auth listener
  return auth.onAuthStateChanged ? auth.onAuthStateChanged(callback) : () => {};
}

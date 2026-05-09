import React, { useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
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
  startAfter,
  getDocs,
  setDoc,
  deleteField,
  type DocumentSnapshot,
} from 'firebase/firestore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  LogOut,
  LogIn,
  PlusCircle,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Sparkles,
  ReceiptText,
  X,
  Trash2,
  Edit,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Download,
  Moon,
  Sun,
  BarChart2,
  CreditCard,
  Calendar,
  RefreshCw,
  LayoutDashboard,
  ToggleLeft,
  ToggleRight,
  XCircle,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { auth, db } from './firebase';

interface Movimiento {
  id: string;
  tipo: 'gasto' | 'ingreso';
  concepto: string;
  importe: number;
  fecha_operacion: any;
  hucha_id?: string;
  // Compensación entre movimientos
  compensa_movimiento_id?: string | null; // solo en ingresos: gasto que compensa
  compensado_por?: string[] | null;       // solo en gastos: ingresos que lo compensan
  importe_neto?: number | null;           // solo en gastos compensados: importe efectivo restante
}

interface Hucha {
  id: string;
  nombre: string;
  saldo_acumulado: number;
  objetivo: number | null;
  tipo_aportacion: 'flat' | 'porcentaje' | 'resto';
  valor_aportacion?: number;
  orden: number;
  es_principal?: boolean;
  es_suscripciones?: boolean;
}

interface Suscripcion {
  id: string;
  nombre: string;
  importe: number;
  frecuencia: 'mensual' | 'trimestral' | 'semestral' | 'anual';
  dia_pago: number;
  categoria: string;
  color: string;
  activa: boolean;
  cancelando?: boolean;
  hucha_id?: string | null;
  // Si la suscripción es compartida con otras personas, "mi_parte" es la cuota
  // real del usuario en € (el resto lo reembolsan los demás vía bizum, etc.).
  // Si null/undefined, la suscripción es íntegra del usuario.
  mi_parte?: number | null;
  created_at?: any; // Firestore Timestamp or null for old records
}

const SUBSCRIPTION_COLORS = [
  '#8b5cf6', '#ec4899', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#6366f1',
];

const FRECUENCIA_OPTIONS = [
  { value: 'mensual', label: 'Mensual', divisor: 1 },
  { value: 'trimestral', label: 'Trimestral', divisor: 3 },
  { value: 'semestral', label: 'Semestral', divisor: 6 },
  { value: 'anual', label: 'Anual', divisor: 12 },
];

const CATEGORIA_OPTIONS = [
  { value: 'streaming', label: 'Streaming' },
  { value: 'musica', label: 'Música' },
  { value: 'software', label: 'Software' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'noticias', label: 'Noticias' },
  { value: 'otros', label: 'Otros' },
];

const calcMensual = (s: Suscripcion): number => {
  const opt = FRECUENCIA_OPTIONS.find(o => o.value === s.frecuencia);
  const importeEfectivo = s.mi_parte != null ? s.mi_parte : s.importe;
  return importeEfectivo / (opt?.divisor ?? 1);
};

const getNextPaymentDate = (diaPago: number): Date => {
  const today = new Date();
  const candidate = new Date(today.getFullYear(), today.getMonth(), diaPago);
  if (candidate <= today) {
    return new Date(today.getFullYear(), today.getMonth() + 1, diaPago);
  }
  return candidate;
};

const MOCK_SUSCRIPCIONES: Suscripcion[] = [
  { id: '1', nombre: 'Netflix', importe: 17.99, frecuencia: 'mensual', dia_pago: 15, categoria: 'streaming', color: '#ef4444', activa: true },
  { id: '2', nombre: 'Spotify', importe: 9.99, frecuencia: 'mensual', dia_pago: 20, categoria: 'musica', color: '#22c55e', activa: true },
  { id: '3', nombre: 'iCloud+', importe: 2.99, frecuencia: 'mensual', dia_pago: 5, categoria: 'software', color: '#3b82f6', activa: false },
];

const MOCK_MOVIMIENTOS: Movimiento[] = [
  { id: '1', tipo: 'ingreso', concepto: 'Nomina', importe: 2500, fecha_operacion: { toDate: () => new Date() } },
  { id: '2', tipo: 'gasto', concepto: 'Alquiler', importe: 800, fecha_operacion: { toDate: () => new Date() } },
  { id: '3', tipo: 'gasto', concepto: 'Supermercado', importe: 150, fecha_operacion: { toDate: () => new Date() } },
  { id: '4', tipo: 'ingreso', concepto: 'Bizum', importe: 50, fecha_operacion: { toDate: () => new Date() } },
];

const MOCK_HUCHAS: Hucha[] = [
  { id: '1', nombre: 'Vacaciones', saldo_acumulado: 1200, objetivo: 3000, tipo_aportacion: 'porcentaje', valor_aportacion: 10, orden: 1 },
  { id: '2', nombre: 'Fondo de emergencia', saldo_acumulado: 5000, objetivo: 10000, tipo_aportacion: 'resto', orden: 2, es_principal: true },
];

const TIMELINE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#f97316'];

const formatCurrency = (value: number) =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

const parseMovimientoDate = (dateValue: any): Date | null => {
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

const formatDate = (dateValue: any) => {
  const value = parseMovimientoDate(dateValue);
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toLocaleDateString('es-ES')
    : '---';
};

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.localStorage.getItem('flowt-theme') === 'dark' ? 'dark' : 'light';
  });
  const [activeView, setActiveView] = useState<'dashboard' | 'suscripciones' | 'calendario'>('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [huchas, setHuchas] = useState<Hucha[]>([]);
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);

  // Subscription Modal State
  const [isSuscripcionModalOpen, setIsSuscripcionModalOpen] = useState(false);
  const [editingSuscripcionId, setEditingSuscripcionId] = useState<string | null>(null);
  const [newSuscripcion, setNewSuscripcion] = useState({
    nombre: '',
    importe: 0,
    frecuencia: 'mensual' as Suscripcion['frecuencia'],
    dia_pago: 1,
    categoria: 'otros',
    color: '#8b5cf6',
    activa: true,
    hucha_id: '',
    compartida: false,
    mi_parte: 0,
  });
  const [isFirebaseConfigured, setIsFirebaseConfigured] = useState(true);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newHucha, setNewHucha] = useState({
    nombre: '',
    tipo_aportacion: 'porcentaje' as 'flat' | 'porcentaje' | 'resto',
    valor_aportacion: 0,
    objetivo: 0,
    es_principal: false
  });
  
  // Transfer State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferData, setTransferData] = useState({
    fromHuchaId: '',
    toHuchaId: '',
    amount: 0
  });

  // Delete State
  const [deleteHuchaData, setDeleteHuchaData] = useState<{
    hucha: Hucha | null;
    mode: 'auto' | 'manual';
    manualDistributions: Record<string, number>;
  }>({
    hucha: null,
    mode: 'auto',
    manualDistributions: {}
  });

  // Global stats (total_ingresos / total_gastos from Firestore stats doc)
  const [userStats, setUserStats] = useState<{ total_ingresos: number; total_gastos: number } | null>(null);

  // History State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [history, setHistory] = useState<Movimiento[]>([]);
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [chartMovements, setChartMovements] = useState<Movimiento[]>([]);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Timeline State
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [timelineMovimientos, setTimelineMovimientos] = useState<Movimiento[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineRange, setTimelineRange] = useState<'week' | 'month' | '3months' | 'year' | 'all'>('month');
  const [hiddenHuchas, setHiddenHuchas] = useState<Set<string>>(new Set());

  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    setHistory([]);
    setLastDoc(null);
    setHasMore(true);
    await loadMoreHistory(true);
  };

  const loadMoreHistory = async (reset = false) => {
    if (!user || isHistoryLoading || (!hasMore && !reset)) return;
    
    setIsHistoryLoading(true);
    try {
      const q = query(
        collection(db, 'movimientos'),
        where('id_propietario', '==', user.uid),
        orderBy('fecha_operacion', 'desc'),
        ...(reset ? [] : [startAfter(lastDoc)]),
        limit(15)
      );

      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Movimiento));
      
      const sortedDocs = [...docs].sort((a, b) => {
        const dA = parseMovimientoDate(a.fecha_operacion)?.getTime() || 0;
        const dB = parseMovimientoDate(b.fecha_operacion)?.getTime() || 0;
        return dB - dA;
      });

      if (reset) {
        setHistory(sortedDocs);
      } else {
        setHistory(prev => [...prev, ...sortedDocs]);
      }
      
      setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 15);
    } catch (error) {
      console.error("Error fetching history:", error);
      showToast("Error al cargar el historial");
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const loadTimelineData = async () => {
    if (!isFirebaseConfigured) {
      setTimelineMovimientos(MOCK_MOVIMIENTOS);
      return;
    }
    if (!user) return;
    setTimelineLoading(true);
    try {
      const q = query(
        collection(db, 'movimientos'),
        where('id_propietario', '==', user.uid),
        orderBy('fecha_operacion', 'desc'),
      );
      const snapshot = await getDocs(q);
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento));
      setTimelineMovimientos(docs);
    } catch (err) {
      console.error('Error loading timeline:', err);
      showToast('Error al cargar la línea de tiempo');
    } finally {
      setTimelineLoading(false);
    }
  };

  const openTimeline = async () => {
    setIsTimelineOpen(true);
    setHiddenHuchas(new Set());
    setTimelineRange('month');
    await loadTimelineData();
  };

  // UI Feedback State
  const [toast, setToast] = useState<{message: string, type: 'error' | 'success'} | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const [installPrompt, setInstallPrompt] = useState<any>(null);

  // Movement Editing State
  const [editingMovimientoId, setEditingMovimientoId] = useState<string | null>(null);
  const [tempConcepto, setTempConcepto] = useState("");

  const handleUpdateMovimientoConcepto = async (movId: string) => {
    if (!tempConcepto.trim()) {
      setEditingMovimientoId(null);
      return;
    }
    try {
      const movRef = doc(db, 'movimientos', movId);
      await runTransaction(db, async (transaction) => {
        transaction.update(movRef, { concepto: tempConcepto.trim() });
      });
      setEditingMovimientoId(null);
      showToast("Concepto actualizado", "success");
    } catch (error) {
      console.error("Error al actualizar concepto:", error);
      showToast("Error al actualizar el nombre");
    }
  };

  const showToast = (message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('flowt-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  useEffect(() => {
    if (!import.meta.env.VITE_FIREBASE_API_KEY) {
      setIsFirebaseConfigured(false);
      setMovimientos(MOCK_MOVIMIENTOS);
      setHuchas(MOCK_HUCHAS);
      setSuscripciones(MOCK_SUSCRIPCIONES);
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isFirebaseConfigured) return;

    const qMov = query(
      collection(db, 'movimientos'),
      where('id_propietario', '==', user.uid),
      orderBy('fecha_operacion', 'desc'),
      limit(5),
    );

    const unsubMov = onSnapshot(qMov, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Movimiento));
      // Safety sort: ensure newest is always first even if Firestore types are mixed
      const sorted = [...docs].sort((a, b) => {
        const dA = parseMovimientoDate(a.fecha_operacion)?.getTime() || 0;
        const dB = parseMovimientoDate(b.fecha_operacion)?.getTime() || 0;
        return dB - dA;
      });
      setMovimientos(sorted);
    });

    // Chart Data Query (last 6 months of movements)
    const qChart = query(
      collection(db, 'movimientos'),
      where('id_propietario', '==', user.uid),
      orderBy('fecha_operacion', 'desc'),
      limit(100), // Fetch enough for the chart
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

    const qHuchas = query(
      collection(db, 'huchas'),
      where('id_propietario', '==', user.uid),
      orderBy('orden', 'asc'),
    );

    const unsubHuchas = onSnapshot(qHuchas, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Hucha));
      setHuchas(docs);
    });

    const unsubStats = onSnapshot(doc(db, 'stats', user.uid), async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setUserStats({
          total_ingresos: data.total_ingresos ?? 0,
          total_gastos: data.total_gastos ?? 0,
        });
      } else {
        // One-time migration: build stats from all existing movements
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

          // Normalize date if it's a string (historical fix)
          if (typeof m.fecha_operacion === 'string') {
            const normalizedDate = parseMovimientoDate(m.fecha_operacion);
            if (normalizedDate) {
              await setDoc(doc(db, 'movimientos', d.id), { fecha_operacion: normalizedDate }, { merge: true });
            }
          }
        }

        await setDoc(doc(db, 'stats', user.uid), {
          total_ingresos,
          total_gastos,
          updated_at: serverTimestamp(),
        });
        // The onSnapshot above will fire again with the new doc
      }
    });

    const qSuscripciones = query(
      collection(db, 'suscripciones'),
      where('id_propietario', '==', user.uid),
      orderBy('created_at', 'asc'),
    );

    const unsubSuscripciones = onSnapshot(qSuscripciones, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Suscripcion));
      setSuscripciones(docs);
    });

    return () => {
      unsubMov();
      unsubChart();
      unsubHuchas();
      unsubStats();
      unsubSuscripciones();
    };
  }, [user, isFirebaseConfigured]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleCreateOrUpdateHucha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const huchaData = {
      id_propietario: user.uid,
      nombre: newHucha.nombre,
      tipo_aportacion: newHucha.tipo_aportacion,
      valor_aportacion: Number(newHucha.valor_aportacion),
      objetivo: newHucha.objetivo > 0 ? Number(newHucha.objetivo) : null,
      es_principal: newHucha.es_principal,
      updated_at: serverTimestamp()
    };

    try {
      await runTransaction(db, async (transaction) => {
        // If this hucha is being set as principal, we need to unset any other principal
        if (huchaData.es_principal) {
          const otherPrincipals = huchas.filter(h => h.es_principal && h.id !== editingId);
          for (const h of otherPrincipals) {
            transaction.update(doc(db, 'huchas', h.id), { 
              es_principal: false,
              updated_at: serverTimestamp()
            });
          }
        }

        // If this hucha is being set as type "resto", we need to unset any other "resto"
        if (huchaData.tipo_aportacion === 'resto') {
          const otherRestos = huchas.filter(h => h.tipo_aportacion === 'resto' && h.id !== editingId);
          for (const h of otherRestos) {
            transaction.update(doc(db, 'huchas', h.id), { 
              tipo_aportacion: 'flat', // Default fallback
              valor_aportacion: 0,
              updated_at: serverTimestamp()
            });
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

      closeModal();
      showToast(editingId ? "Cartera actualizada" : "Cartera creada", "success");
    } catch (error) {
      console.error("Error al procesar hucha:", error);
      showToast("Error al procesar la hucha. Revisa la consola.");
    }
  };

  const handleDeleteHucha = async (hucha: Hucha) => {
    if (hucha.es_suscripciones) {
      showToast('Esta cartera es gestionada automáticamente por tus suscripciones.');
      return;
    }
    if (huchas.length === 1) {
      showToast('No puedes eliminar tu unica cartera. Crea otra primero.');
      return;
    }
    if (hucha.saldo_acumulado <= 0) {
      setConfirmModal({
        title: 'Eliminar Cartera',
        message: `¿Estas seguro de que quieres eliminar la cartera "${hucha.nombre}"?`,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'huchas', hucha.id));
            showToast("Cartera eliminada", "success");
          } catch (error) {
            console.error("Error al eliminar hucha:", error);
            showToast("Error al eliminar la hucha");
          }
          setConfirmModal(null);
        }
      });
    } else {
      const initialDistributions: Record<string, number> = {};
      huchas.filter(h => h.id !== hucha.id).forEach(h => initialDistributions[h.id] = 0);
      setDeleteHuchaData({ hucha, mode: 'auto', manualDistributions: initialDistributions });
    }
  };

  const confirmDeleteHuchaWithFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    const { hucha, mode, manualDistributions } = deleteHuchaData;
    if (!hucha || hucha.saldo_acumulado <= 0) return;

    try {
      await runTransaction(db, async (transaction) => {
        const remainingHuchas = huchas.filter(h => h.id !== hucha.id);
        let dists: Record<string, number> = {};
        
        if (mode === 'auto') {
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
          
          let restoHucha = remainingHuchas.find(h => h.tipo_aportacion === 'resto') 
                        || remainingHuchas.find(h => h.es_principal)
                        || remainingHuchas[0];
                        
          if (restoHucha && remaining > 0) {
            dists[restoHucha.id] = (dists[restoHucha.id] || 0) + remaining;
          }
        } else {
          let sum = 0;
          Object.values(manualDistributions).forEach(val => sum += val);
          if (Math.abs(sum - hucha.saldo_acumulado) > 0.01) {
            throw new Error(`Debes distribuir exactamente ${formatCurrency(hucha.saldo_acumulado)}`);
          }
          dists = manualDistributions;
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

      setDeleteHuchaData({ hucha: null, mode: 'auto', manualDistributions: {} });
      showToast("Cartera eliminada y fondos repartidos", "success");
    } catch (error: any) {
      console.error("Error distribuyendo hucha:", error);
      showToast(error.message || "Error al eliminar la hucha.");
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !transferData.fromHuchaId || !transferData.toHuchaId || transferData.amount <= 0) return;
    if (transferData.fromHuchaId === transferData.toHuchaId) {
      showToast('Debes seleccionar carteras distintas.');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const fromRef = doc(db, 'huchas', transferData.fromHuchaId);
        const toRef = doc(db, 'huchas', transferData.toHuchaId);

        const fromDoc = await transaction.get(fromRef);
        const toDoc = await transaction.get(toRef);

        if (!fromDoc.exists() || !toDoc.exists()) throw new Error("Una de las huchas no existe");

        const fromBalance = fromDoc.data().saldo_acumulado || 0;
        if (fromBalance < transferData.amount) {
          throw new Error("Saldo insuficiente en la cartera de origen");
        }

        transaction.update(fromRef, {
          saldo_acumulado: fromBalance - transferData.amount,
          updated_at: serverTimestamp()
        });

        transaction.update(toRef, {
          saldo_acumulado: (toDoc.data().saldo_acumulado || 0) + transferData.amount,
          updated_at: serverTimestamp()
        });
      });

      setIsTransferModalOpen(false);
      setTransferData({ fromHuchaId: '', toHuchaId: '', amount: 0 });
      showToast("Transferencia completada", "success");
    } catch (error: any) {
      console.error("Error en la transferencia:", error);
      showToast(error.message || "Error al transferir fondos.");
    }
  };

  const openEditModal = (hucha: Hucha) => {
    setEditingId(hucha.id);
    setNewHucha({
      nombre: hucha.nombre,
      tipo_aportacion: hucha.tipo_aportacion,
      valor_aportacion: hucha.valor_aportacion || 0,
      objetivo: hucha.objetivo || 0,
      es_principal: !!hucha.es_principal
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setNewHucha({ nombre: '', tipo_aportacion: 'porcentaje', valor_aportacion: 0, objetivo: 0, es_principal: false });
  };

  const handleChangeMovimientoHucha = async (mov: Movimiento, newHuchaId: string) => {
    if (!newHuchaId || mov.hucha_id === newHuchaId) return;
    const oldHuchaId = mov.hucha_id;

    try {
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const newHuchaRef = doc(db, 'huchas', newHuchaId);
        const oldHuchaRef = oldHuchaId ? doc(db, 'huchas', oldHuchaId) : null;

        const newHuchaDoc = await transaction.get(newHuchaRef);
        let oldHuchaDoc = null;
        if (oldHuchaRef) oldHuchaDoc = await transaction.get(oldHuchaRef);

        if (oldHuchaRef && oldHuchaDoc && oldHuchaDoc.exists()) {
          transaction.update(oldHuchaRef, {
            saldo_acumulado: (oldHuchaDoc.data().saldo_acumulado || 0) + mov.importe
          });
        }
        
        if (newHuchaDoc.exists()) {
          transaction.update(newHuchaRef, {
            saldo_acumulado: (newHuchaDoc.data().saldo_acumulado || 0) - mov.importe
          });
        }

        transaction.update(movRef, { hucha_id: newHuchaId });
      });
      showToast("Gasto reasignado", "success");
    } catch (error) {
      console.error("Error cambiando hucha del movimiento:", error);
      showToast("Error al reasignar el gasto");
    }
  };

  // ---------- Convert tipo (gasto <-> ingreso) ----------
  type ConvertRow = {
    huchaId: string;
    tipoAportacion: 'flat' | 'porcentaje' | 'resto';
    valor: number;
  };
  const [convertingMov, setConvertingMov] = useState<Movimiento | null>(null);
  const [convertRows, setConvertRows] = useState<ConvertRow[]>([]);
  const [convertTargetHuchaId, setConvertTargetHuchaId] = useState<string>('');

  const openConvertModal = (mov: Movimiento) => {
    setConvertingMov(mov);
    if (mov.tipo === 'gasto') {
      // Default: distribute everything to principal/resto hucha
      const principal = huchas.find(h => h.es_principal)
        ?? huchas.find(h => h.tipo_aportacion === 'resto')
        ?? huchas[0];
      setConvertRows(principal ? [{ huchaId: principal.id, tipoAportacion: 'resto', valor: 0 }] : []);
      setConvertTargetHuchaId('');
    } else {
      // ingreso -> gasto: pick a single hucha for the expense
      const principal = huchas.find(h => h.es_principal) ?? huchas[0];
      setConvertTargetHuchaId(principal?.id ?? '');
      setConvertRows([]);
    }
  };

  const closeConvertModal = () => {
    setConvertingMov(null);
    setConvertRows([]);
    setConvertTargetHuchaId('');
  };

  const addConvertRow = () => {
    const used = new Set(convertRows.map(r => r.huchaId));
    const next = huchas.find(h => !used.has(h.id));
    if (!next) return;
    setConvertRows(prev => [...prev, { huchaId: next.id, tipoAportacion: 'flat', valor: 0 }]);
  };

  const updateConvertRow = (idx: number, patch: Partial<ConvertRow>) => {
    setConvertRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeConvertRow = (idx: number) => {
    setConvertRows(prev => prev.filter((_, i) => i !== idx));
  };

  // Computes the € that each row contributes given the movement amount.
  // Returns null if the distribution is invalid (with reason in `error`).
  const computeConvertShares = (
    rows: ConvertRow[],
    amount: number,
  ): { shares: Record<string, number>; error: string | null } => {
    if (rows.length === 0) return { shares: {}, error: 'Añade al menos una hucha' };

    const ids = new Set<string>();
    for (const r of rows) {
      if (!r.huchaId) return { shares: {}, error: 'Selecciona una hucha en cada fila' };
      if (ids.has(r.huchaId)) return { shares: {}, error: 'No repitas huchas' };
      ids.add(r.huchaId);
    }

    const restoCount = rows.filter(r => r.tipoAportacion === 'resto').length;
    if (restoCount > 1) return { shares: {}, error: 'Sólo una fila puede ser «resto»' };

    let flatSum = 0;
    let pctSum = 0;
    for (const r of rows) {
      if (r.tipoAportacion === 'flat') {
        if (r.valor < 0) return { shares: {}, error: 'Valores negativos no permitidos' };
        flatSum += r.valor;
      } else if (r.tipoAportacion === 'porcentaje') {
        if (r.valor < 0) return { shares: {}, error: 'Valores negativos no permitidos' };
        pctSum += r.valor;
      }
    }

    if (pctSum > 100 + 0.001) return { shares: {}, error: 'Los porcentajes superan el 100%' };
    const pctEuros = amount * (pctSum / 100);
    if (flatSum + pctEuros > amount + 0.01) {
      return { shares: {}, error: 'Las cantidades fijas + porcentajes superan el importe' };
    }

    const restoEuros = amount - flatSum - pctEuros;
    if (restoCount === 0 && Math.abs(restoEuros) > 0.01) {
      return { shares: {}, error: `Faltan ${restoEuros.toFixed(2)} € sin asignar (añade «resto» o sube valores)` };
    }

    const shares: Record<string, number> = {};
    for (const r of rows) {
      let val = 0;
      if (r.tipoAportacion === 'flat') val = r.valor;
      else if (r.tipoAportacion === 'porcentaje') val = amount * (r.valor / 100);
      else val = restoEuros;
      shares[r.huchaId] = (shares[r.huchaId] ?? 0) + val;
    }
    return { shares, error: null };
  };

  const handleConvertMovimiento = async () => {
    if (!convertingMov || !user) return;
    const mov = convertingMov;
    const amount = mov.importe;

    try {
      if (mov.tipo === 'gasto') {
        // gasto -> ingreso
        const { shares, error } = computeConvertShares(convertRows, amount);
        if (error) {
          showToast(error);
          return;
        }
        const oldHuchaId = mov.hucha_id;

        // Net delta per hucha: revert -amount on old hucha (+amount), plus add shares.
        const deltas: Record<string, number> = {};
        if (oldHuchaId) deltas[oldHuchaId] = (deltas[oldHuchaId] || 0) + amount;
        for (const [hid, share] of Object.entries(shares)) {
          deltas[hid] = (deltas[hid] || 0) + share;
        }

        await runTransaction(db, async (transaction) => {
          // ----- READS FIRST -----
          const movRef = doc(db, 'movimientos', mov.id);
          const statsRef = doc(db, 'stats', user.uid);

          const huchaRefs: Record<string, ReturnType<typeof doc>> = {};
          for (const hid of Object.keys(deltas)) huchaRefs[hid] = doc(db, 'huchas', hid);

          const huchaSnaps: Record<string, DocumentSnapshot> = {};
          for (const hid of Object.keys(huchaRefs)) {
            huchaSnaps[hid] = await transaction.get(huchaRefs[hid]);
          }
          const statsSnap = await transaction.get(statsRef);

          // ----- WRITES -----
          for (const hid of Object.keys(huchaRefs)) {
            const snap = huchaSnaps[hid];
            if (!snap?.exists()) continue;
            const cur = snap.data().saldo_acumulado || 0;
            transaction.update(huchaRefs[hid], {
              saldo_acumulado: cur + deltas[hid],
              updated_at: serverTimestamp(),
            });
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
        // ingreso -> gasto
        if (!convertTargetHuchaId) {
          showToast('Elige una hucha para el gasto');
          return;
        }
        const targetId = convertTargetHuchaId;

        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'movimientos', mov.id);
          const statsRef = doc(db, 'stats', user.uid);
          const targetRef = doc(db, 'huchas', targetId);

          const targetSnap = await transaction.get(targetRef);
          const statsSnap = await transaction.get(statsRef);

          if (targetSnap.exists()) {
            const cur = targetSnap.data().saldo_acumulado || 0;
            transaction.update(targetRef, {
              saldo_acumulado: cur - amount,
              updated_at: serverTimestamp(),
            });
          }
          transaction.update(movRef, { tipo: 'gasto', hucha_id: targetId });
          const cur = statsSnap.data() || {};
          transaction.set(statsRef, {
            total_ingresos: Math.max(0, (cur.total_ingresos || 0) - amount),
            total_gastos: (cur.total_gastos || 0) + amount,
            updated_at: serverTimestamp(),
          }, { merge: true });
        });

        showToast('Movimiento convertido a gasto', 'success');
      }
      closeConvertModal();
    } catch (error) {
      console.error('Error convirtiendo movimiento:', error);
      showToast('Error al convertir el movimiento');
    }
  };

  // ---------- Link / Compensar movimientos ----------
  // Permite marcar que un ingreso compensa parcialmente a un gasto (p. ej.
  // pagas Spotify Family 7€ y un amigo te bizumea 3.5€ por su parte). El
  // efecto en huchas YA es correcto al estar gasto e ingreso aplicados por
  // separado (la hucha refleja el neto). Solo necesitamos ajustar las
  // stats globales y guardar el vínculo en los dos movimientos.
  const [linkingMov, setLinkingMov] = useState<Movimiento | null>(null);
  const [linkSelectedIds, setLinkSelectedIds] = useState<Set<string>>(new Set());
  const [linkSearch, setLinkSearch] = useState('');

  const openLinkModal = (mov: Movimiento) => {
    setLinkingMov(mov);
    setLinkSelectedIds(new Set());
    setLinkSearch('');
  };

  const closeLinkModal = () => {
    setLinkingMov(null);
    setLinkSelectedIds(new Set());
    setLinkSearch('');
  };

  const toggleLinkCandidate = (id: string) => {
    setLinkSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        // Si el movimiento abierto es un ingreso, solo se puede vincular a 1 gasto
        if (linkingMov?.tipo === 'ingreso') next.clear();
        next.add(id);
      }
      return next;
    });
  };

  // Cuando estamos sobre un gasto: candidatos = ingresos sin vincular (excluyendo
  // los ya vinculados a otro gasto y los que ya están vinculados a este).
  // Cuando estamos sobre un ingreso: candidatos = gastos del usuario.
  const linkCandidates = useMemo(() => {
    if (!linkingMov) return [] as Movimiento[];
    const search = linkSearch.trim().toLowerCase();
    let list: Movimiento[];
    if (linkingMov.tipo === 'gasto') {
      const yaVinculados = new Set(linkingMov.compensado_por ?? []);
      list = movimientos.filter(m =>
        m.tipo === 'ingreso'
        && !m.compensa_movimiento_id
        && !yaVinculados.has(m.id)
      );
    } else {
      // ingreso → buscar gastos. Excluir los que ya están totalmente compensados.
      list = movimientos.filter(m => {
        if (m.tipo !== 'gasto') return false;
        const compensadoActual = (m.compensado_por ?? []).reduce((s, id) => {
          const inc = movimientos.find(x => x.id === id);
          return inc ? s + inc.importe : s;
        }, 0);
        // Si vincularas linkingMov a m, ¿cabe?
        return compensadoActual + linkingMov.importe <= m.importe + 0.01;
      });
    }
    if (search) {
      list = list.filter(m => m.concepto?.toLowerCase().includes(search));
    }
    return list.slice(0, 50);
  }, [linkingMov, movimientos, linkSearch]);

  const linkSummary = useMemo(() => {
    if (!linkingMov) return null;
    if (linkingMov.tipo === 'gasto') {
      const compensadoActual = (linkingMov.compensado_por ?? []).reduce((s, id) => {
        const inc = movimientos.find(x => x.id === id);
        return inc ? s + inc.importe : s;
      }, 0);
      const nuevosSum = Array.from(linkSelectedIds).reduce((s, id) => {
        const inc = movimientos.find(x => x.id === id);
        return inc ? s + inc.importe : s;
      }, 0);
      const totalCompensado = compensadoActual + nuevosSum;
      const neto = Math.max(0, linkingMov.importe - totalCompensado);
      const exceso = totalCompensado - linkingMov.importe;
      return { gasto: linkingMov.importe, totalCompensado, neto, exceso };
    } else {
      const targetId = Array.from(linkSelectedIds)[0];
      const target = targetId ? movimientos.find(m => m.id === targetId) : null;
      if (!target) return { gasto: 0, totalCompensado: 0, neto: 0, exceso: 0 };
      const compensadoActual = (target.compensado_por ?? []).reduce((s, id) => {
        const inc = movimientos.find(x => x.id === id);
        return inc ? s + inc.importe : s;
      }, 0);
      const totalCompensado = compensadoActual + linkingMov.importe;
      const neto = Math.max(0, target.importe - totalCompensado);
      const exceso = totalCompensado - target.importe;
      return { gasto: target.importe, totalCompensado, neto, exceso };
    }
  }, [linkingMov, linkSelectedIds, movimientos]);

  const handleLinkMovimiento = async () => {
    if (!linkingMov || !user) return;
    if (linkSelectedIds.size === 0) {
      showToast('Selecciona al menos un movimiento');
      return;
    }
    if (linkSummary && linkSummary.exceso > 0.01) {
      showToast(`El total compensado supera al gasto en ${formatCurrency(linkSummary.exceso)}`);
      return;
    }

    // Determinar gasto y lista de ingresos a vincular
    let gasto: Movimiento;
    let ingresos: Movimiento[];
    if (linkingMov.tipo === 'gasto') {
      gasto = linkingMov;
      ingresos = Array.from(linkSelectedIds)
        .map(id => movimientos.find(m => m.id === id))
        .filter((m): m is Movimiento => !!m);
    } else {
      const targetId = Array.from(linkSelectedIds)[0];
      const target = movimientos.find(m => m.id === targetId);
      if (!target) {
        showToast('No se encontró el gasto seleccionado');
        return;
      }
      gasto = target;
      ingresos = [linkingMov];
    }

    const totalIngresos = ingresos.reduce((s, m) => s + m.importe, 0);

    try {
      await runTransaction(db, async (transaction) => {
        // ----- READS -----
        const gastoRef = doc(db, 'movimientos', gasto.id);
        const ingresoRefs = ingresos.map(i => doc(db, 'movimientos', i.id));
        const statsRef = doc(db, 'stats', user.uid);

        const gastoSnap = await transaction.get(gastoRef);
        const ingresoSnaps = [] as DocumentSnapshot[];
        for (const ref of ingresoRefs) {
          ingresoSnaps.push(await transaction.get(ref));
        }
        const statsSnap = await transaction.get(statsRef);

        if (!gastoSnap.exists()) throw new Error('Gasto no existe');
        const gastoData = gastoSnap.data() as Movimiento;
        if (gastoData.tipo !== 'gasto') throw new Error('El destino debe ser un gasto');

        // Validar ingresos y que no estén ya vinculados
        const yaVinculados = new Set(gastoData.compensado_por ?? []);
        for (let i = 0; i < ingresos.length; i++) {
          const snap = ingresoSnaps[i];
          if (!snap.exists()) throw new Error('Ingreso no existe');
          const data = snap.data() as Movimiento;
          if (data.tipo !== 'ingreso') throw new Error('Solo se pueden vincular ingresos a gastos');
          if (data.compensa_movimiento_id) throw new Error('Algún ingreso ya está vinculado a otro gasto');
          if (yaVinculados.has(snap.id)) throw new Error('Ese ingreso ya estaba vinculado a este gasto');
        }

        // Calcular total compensado tras la operación (suma importes ya vinculados + nuevos)
        const compensadoActual = (gastoData.compensado_por ?? []).reduce((s, id) => {
          const m = movimientos.find(x => x.id === id);
          return m ? s + m.importe : s;
        }, 0);
        const nuevoTotalCompensado = compensadoActual + totalIngresos;
        if (nuevoTotalCompensado > gastoData.importe + 0.01) {
          throw new Error('El total compensado supera al importe del gasto');
        }

        // ----- WRITES -----
        const nuevoCompensadoPor = [...(gastoData.compensado_por ?? []), ...ingresos.map(i => i.id)];
        const nuevoNeto = Math.max(0, gastoData.importe - nuevoTotalCompensado);
        transaction.update(gastoRef, {
          compensado_por: nuevoCompensadoPor,
          importe_neto: nuevoNeto,
          updated_at: serverTimestamp(),
        });

        for (let i = 0; i < ingresoRefs.length; i++) {
          transaction.update(ingresoRefs[i], {
            compensa_movimiento_id: gasto.id,
            updated_at: serverTimestamp(),
          });
        }

        const cur = statsSnap.data() || {};
        transaction.set(statsRef, {
          total_ingresos: Math.max(0, (cur.total_ingresos || 0) - totalIngresos),
          total_gastos: Math.max(0, (cur.total_gastos || 0) - totalIngresos),
          updated_at: serverTimestamp(),
        }, { merge: true });
      });

      showToast('Movimientos vinculados', 'success');
      closeLinkModal();
    } catch (error: any) {
      console.error('Error vinculando:', error);
      showToast(error?.message || 'Error al vincular movimientos');
    }
  };

  const handleUnlinkMovimiento = async (ingreso: Movimiento) => {
    if (!user || !ingreso.compensa_movimiento_id) return;
    const gastoId = ingreso.compensa_movimiento_id;
    const iAmt = ingreso.importe;

    try {
      await runTransaction(db, async (transaction) => {
        const gastoRef = doc(db, 'movimientos', gastoId);
        const ingresoRef = doc(db, 'movimientos', ingreso.id);
        const statsRef = doc(db, 'stats', user.uid);

        const gastoSnap = await transaction.get(gastoRef);
        const statsSnap = await transaction.get(statsRef);

        const restantes = gastoSnap.exists()
          ? ((gastoSnap.data() as Movimiento).compensado_por ?? []).filter(id => id !== ingreso.id)
          : [];

        if (gastoSnap.exists()) {
          const gastoData = gastoSnap.data() as Movimiento;
          const sumRestantes = restantes.reduce((s, id) => {
            const m = movimientos.find(x => x.id === id);
            return m ? s + m.importe : s;
          }, 0);
          transaction.update(gastoRef, {
            compensado_por: restantes.length > 0 ? restantes : deleteField(),
            importe_neto: restantes.length > 0
              ? Math.max(0, gastoData.importe - sumRestantes)
              : deleteField(),
            updated_at: serverTimestamp(),
          });
        }

        transaction.update(ingresoRef, {
          compensa_movimiento_id: deleteField(),
          updated_at: serverTimestamp(),
        });

        const cur = statsSnap.data() || {};
        transaction.set(statsRef, {
          total_ingresos: (cur.total_ingresos || 0) + iAmt,
          total_gastos: (cur.total_gastos || 0) + iAmt,
          updated_at: serverTimestamp(),
        }, { merge: true });
      });

      showToast('Vínculo deshecho', 'success');
    } catch (error: any) {
      console.error('Error desvinculando:', error);
      showToast(error?.message || 'Error al desvincular');
    }
  };

  const closeSuscripcionModal = () => {
    setIsSuscripcionModalOpen(false);
    setEditingSuscripcionId(null);
    setNewSuscripcion({ nombre: '', importe: 0, frecuencia: 'mensual', dia_pago: 1, categoria: 'otros', color: '#8b5cf6', activa: true, hucha_id: '', compartida: false, mi_parte: 0 });
  };

  const openEditSuscripcion = (s: Suscripcion) => {
    setEditingSuscripcionId(s.id);
    setNewSuscripcion({
      nombre: s.nombre,
      importe: s.importe,
      frecuencia: s.frecuencia,
      dia_pago: s.dia_pago,
      categoria: s.categoria,
      color: s.color,
      activa: s.activa,
      hucha_id: s.hucha_id || '',
      compartida: s.mi_parte != null,
      mi_parte: s.mi_parte ?? 0,
    });
    setIsSuscripcionModalOpen(true);
  };

  const syncSuscripcionesHucha = async (updatedList: Suscripcion[]) => {
    if (!user) return;
    const totalMensual = updatedList
      .filter(s => s.activa)
      .reduce((sum, s) => sum + calcMensual(s), 0);
    const rounded = Math.round(totalMensual * 100) / 100;

    const suscripcionesHucha = huchas.find(h => h.es_suscripciones);

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
          orden: huchas.length + 1,
          es_principal: false,
          es_suscripciones: true,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      });
    }
  };

  const handleCreateOrUpdateSuscripcion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // mi_parte solo se guarda si la suscripción está marcada como compartida
    // y la cantidad es válida (>0 y < importe). Si no, se guarda null para
    // indicar que la suscripción es íntegramente del usuario.
    const importeNum = Number(newSuscripcion.importe);
    const miParteNum = Number(newSuscripcion.mi_parte);
    const miParteValido =
      newSuscripcion.compartida && miParteNum > 0 && miParteNum < importeNum;
    if (newSuscripcion.compartida && !miParteValido) {
      showToast('Mi parte debe ser mayor que 0 y menor que el importe total');
      return;
    }

    const data = {
      id_propietario: user.uid,
      nombre: newSuscripcion.nombre.trim(),
      importe: importeNum,
      frecuencia: newSuscripcion.frecuencia,
      dia_pago: Number(newSuscripcion.dia_pago),
      categoria: newSuscripcion.categoria,
      color: newSuscripcion.color,
      activa: newSuscripcion.activa,
      hucha_id: newSuscripcion.hucha_id || null,
      mi_parte: miParteValido ? miParteNum : null,
      updated_at: serverTimestamp(),
    };

    try {
      let updatedList: Suscripcion[];
      if (editingSuscripcionId) {
        await runTransaction(db, async (transaction) => {
          transaction.update(doc(db, 'suscripciones', editingSuscripcionId), data);
        });
        updatedList = suscripciones.map(s =>
          s.id === editingSuscripcionId ? { ...s, ...data } : s
        );
      } else {
        const newDocRef = doc(collection(db, 'suscripciones'));
        await runTransaction(db, async (transaction) => {
          transaction.set(newDocRef, { ...data, created_at: serverTimestamp() });
        });
        updatedList = [...suscripciones, { id: newDocRef.id, ...data } as unknown as Suscripcion];
      }

      await syncSuscripcionesHucha(updatedList);
      closeSuscripcionModal();
      showToast(editingSuscripcionId ? 'Suscripción actualizada' : 'Suscripción creada', 'success');
    } catch (error) {
      console.error('Error al guardar suscripción:', error);
      showToast('Error al guardar la suscripción');
    }
  };

  const handleDeleteSuscripcion = (s: Suscripcion) => {
    setConfirmModal({
      title: 'Eliminar Suscripción',
      message: `¿Eliminar "${s.nombre}"? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
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
      },
    });
  };

  const handleToggleSuscripcion = async (s: Suscripcion) => {
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'suscripciones', s.id), {
          activa: !s.activa,
          updated_at: serverTimestamp(),
        });
      });
      const updatedList = suscripciones.map(sub =>
        sub.id === s.id ? { ...sub, activa: !sub.activa } : sub
      );
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
        try {
          await runTransaction(db, async (transaction) => {
            transaction.update(doc(db, 'suscripciones', s.id), {
              cancelando: true,
              updated_at: serverTimestamp(),
            });
          });
          showToast(`${s.nombre} se cancelará el ${label}`, 'success');
        } catch (error) {
          console.error('Error al cancelar suscripción:', error);
          showToast('Error al cancelar la suscripción');
        }
        setConfirmModal(null);
      },
    });
  };

  const handleUndoCancelSuscripcion = async (s: Suscripcion) => {
    try {
      await runTransaction(db, async (transaction) => {
        transaction.update(doc(db, 'suscripciones', s.id), {
          cancelando: false,
          updated_at: serverTimestamp(),
        });
      });
      showToast(`${s.nombre} reactivada`, 'success');
    } catch (error) {
      console.error('Error al reactivar suscripción:', error);
      showToast('Error al reactivar la suscripción');
    }
  };

  // Auto-delete subscriptions whose cancellation date has passed
  useEffect(() => {
    if (!user || !isFirebaseConfigured || suscripciones.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expired = suscripciones.filter(s => {
      if (!s.cancelando) return false;
      // Calculate the NEXT payment date (always in the future or today)
      const next = getNextPaymentDate(s.dia_pago);
      // Delete only when today has reached or passed the next payment date
      return today >= next;
    });
    if (expired.length === 0) return;

    const deleteExpired = async () => {
      for (const s of expired) {
        try {
          await deleteDoc(doc(db, 'suscripciones', s.id));
        } catch (e) {
          console.error('Error auto-deleting subscription:', e);
        }
      }
      const remaining = suscripciones.filter(s => !expired.find(e => e.id === s.id));
      await syncSuscripcionesHucha(remaining);
    };
    deleteExpired();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suscripciones, user, isFirebaseConfigured]);

  const totalIngresos = userStats?.total_ingresos ?? 0;
  const totalGastos = userStats?.total_gastos ?? 0;
  const balance = totalIngresos - totalGastos;

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

  const timelineChartData = useMemo(() => {
    if (!huchas.length) return [];

    type Point = {
      dateLabel: string;
      timestamp: number;
      total: number;
      lastMovement?: { concepto: string; tipo: 'ingreso' | 'gasto'; importe: number };
      [key: string]: any;
    };

    const makePoint = (ts: number, label: string, state: Record<string, number>, mov?: Movimiento): Point => ({
      dateLabel: label,
      timestamp: ts,
      total: Object.values(state).reduce((s, v) => s + v, 0),
      ...(mov ? { lastMovement: { concepto: mov.concepto, tipo: mov.tipo, importe: mov.importe } } : {}),
      ...state,
    });

    const sortedDesc = [...timelineMovimientos].sort((a, b) => {
      const ta = parseMovimientoDate(a.fecha_operacion)?.getTime() ?? 0;
      const tb = parseMovimientoDate(b.fecha_operacion)?.getTime() ?? 0;
      return tb - ta;
    });

    let running: Record<string, number> = {};
    huchas.forEach(h => { running[h.id] = h.saldo_acumulado; });

    const points: Point[] = [];
    const nowTs = Date.now();
    points.push(makePoint(nowTs, new Date(nowTs).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), running));

    for (const mov of sortedDesc) {
      const date = parseMovimientoDate(mov.fecha_operacion);
      if (!date) continue;

      // Push state AFTER this movement (before undoing it)
      points.push(makePoint(date.getTime(), date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }), running, mov));

      // Undo this movement to go further back in time
      const next = { ...running };
      if (mov.tipo === 'gasto') {
        const hId = mov.hucha_id ?? huchas.find(h => h.es_principal)?.id ?? huchas[0]?.id;
        if (hId) next[hId] = (next[hId] ?? 0) + mov.importe;
      } else {
        let rem = mov.importe;
        for (const h of huchas) {
          if (h.tipo_aportacion === 'flat' && (h.valor_aportacion ?? 0) > 0 && rem > 0) {
            const amt = Math.min(h.valor_aportacion!, rem);
            next[h.id] = (next[h.id] ?? 0) - amt;
            rem -= amt;
          }
        }
        for (const h of huchas) {
          if (h.tipo_aportacion === 'porcentaje' && (h.valor_aportacion ?? 0) > 0 && rem > 0) {
            const share = mov.importe * (h.valor_aportacion! / 100);
            const amt = Math.min(share, rem);
            next[h.id] = (next[h.id] ?? 0) - amt;
            rem -= amt;
          }
        }
        const restoH = huchas.find(h => h.tipo_aportacion === 'resto') ?? huchas.find(h => h.es_principal) ?? huchas[0];
        if (restoH && rem > 0) next[restoH.id] = (next[restoH.id] ?? 0) - rem;
      }
      running = next;
    }

    // `running` is now the state before all movements

    points.sort((a, b) => a.timestamp - b.timestamp);

    // Determine range start
    const nowDate = new Date();
    let startTs = 0;
    if (timelineRange === 'week') startTs = nowDate.getTime() - 7 * 24 * 60 * 60 * 1000;
    else if (timelineRange === 'month') startTs = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, nowDate.getDate()).getTime();
    else if (timelineRange === '3months') startTs = new Date(nowDate.getFullYear(), nowDate.getMonth() - 3, nowDate.getDate()).getTime();
    else if (timelineRange === 'year') startTs = new Date(nowDate.getFullYear() - 1, nowDate.getMonth(), nowDate.getDate()).getTime();

    let filtered = startTs > 0 ? points.filter(p => p.timestamp >= startTs) : [...points];

    // Add anchor point showing balance at range start
    if (startTs > 0) {
      const beforeRange = points.filter(p => p.timestamp < startTs);
      const anchorState = beforeRange.length > 0 ? beforeRange[beforeRange.length - 1] : makePoint(startTs, '', running);
      const anchor = { ...anchorState };
      anchor.dateLabel = new Date(startTs).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      anchor.timestamp = startTs;
      anchor.lastMovement = undefined;
      filtered = [anchor, ...filtered];
    }

    // Granularity depends on range: day for week/month, week for 3months, month for year/all
    const granularity = timelineRange === 'week' || timelineRange === 'month' ? 'day'
                      : timelineRange === '3months' ? 'week'
                      : 'month';

    const getPeriodKey = (ts: number): string => {
      const d = new Date(ts);
      if (granularity === 'day') return d.toDateString();
      if (granularity === 'week') {
        const dow = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
        monday.setHours(0, 0, 0, 0);
        return monday.toDateString();
      }
      return `${d.getFullYear()}-${d.getMonth()}`;
    };

    const getPeriodLabel = (ts: number): string => {
      const d = new Date(ts);
      if (granularity === 'month') return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    };

    // Aggregate filtered points into periods (keep last state per period)
    const byPeriod: Record<string, Point> = {};
    for (const p of filtered) {
      const key = getPeriodKey(p.timestamp);
      if (!byPeriod[key] || p.timestamp > byPeriod[key].timestamp) byPeriod[key] = p;
    }

    const periodPoints = Object.values(byPeriod).sort((a, b) => a.timestamp - b.timestamp);
    if (periodPoints.length === 0) return [];

    // Normalize cursor to the start of the first period
    const cursor = new Date(periodPoints[0].timestamp);
    if (granularity === 'week') {
      const dow = cursor.getDay();
      cursor.setDate(cursor.getDate() - (dow === 0 ? 6 : dow - 1));
    } else if (granularity === 'month') {
      cursor.setDate(1);
    }
    cursor.setHours(0, 0, 0, 0);

    const endDate = new Date(nowTs);
    endDate.setHours(23, 59, 59, 999);

    // Fill every period so the X axis is continuous (carry balance forward for empty periods)
    const filled: Point[] = [];
    let prev = periodPoints[0];

    while (cursor <= endDate) {
      const key = getPeriodKey(cursor.getTime());
      if (byPeriod[key]) {
        filled.push({ ...byPeriod[key], dateLabel: getPeriodLabel(byPeriod[key].timestamp) });
        prev = byPeriod[key];
      } else {
        filled.push({
          ...prev,
          dateLabel: getPeriodLabel(cursor.getTime()),
          timestamp: cursor.getTime(),
          lastMovement: undefined,
        });
      }
      if (granularity === 'day') cursor.setDate(cursor.getDate() + 1);
      else if (granularity === 'week') cursor.setDate(cursor.getDate() + 7);
      else cursor.setMonth(cursor.getMonth() + 1);
    }

    return filled;
  }, [timelineMovimientos, huchas, timelineRange]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 bg-gray-50">
        <div className="glass-panel flex items-center gap-4 rounded-3xl px-8 py-6 shadow-2xl animate-appear-up border-white">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-100 border-t-sky-500" />
          <p className="text-base font-bold text-slate-700 tracking-tight">Cargando Flowt...</p>
        </div>
      </div>
    );
  }

  if (!user && isFirebaseConfigured) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6 bg-gray-50">
        <div className="bg-orb-left" aria-hidden="true" />
        <div className="bg-orb-right" aria-hidden="true" />

        <div className="grid w-full max-w-5xl overflow-hidden rounded-[3rem] border border-white bg-white/70 shadow-[0_32px_100px_-20px_rgba(0,0,0,0.15)] backdrop-blur-3xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative p-10 sm:p-14">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50/50 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-sky-600">
              <Sparkles size={14} />
              Inteligencia Financiera
            </span>

            <h1 className="mt-8 max-w-lg font-title text-5xl font-black leading-[1.1] text-slate-900 sm:text-6xl tracking-tight">
              Control real, <span className="text-sky-500">sin esfuerzo.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-500 font-medium">
              Flowt organiza automáticamente tus movimientos bancarios y los reparte en tus carteras de ahorro en tiempo real.
            </p>

            <div className="mt-12 grid gap-4 text-sm sm:grid-cols-3">
              <article className="rounded-3xl border border-white bg-white/50 p-5 shadow-sm transition-transform hover:-translate-y-1">
                <ShieldCheck className="text-sky-500 mb-3" size={24} />
                <p className="font-black uppercase tracking-tighter text-[10px] text-slate-400">Seguridad</p>
                <p className="mt-1 font-bold text-slate-800 leading-tight">Google Auth</p>
              </article>
              <article className="rounded-3xl border border-white bg-white/50 p-5 shadow-sm transition-transform hover:-translate-y-1">
                <TrendingUp className="text-emerald-500 mb-3" size={24} />
                <p className="font-black uppercase tracking-tighter text-[10px] text-slate-400">Analítica</p>
                <p className="mt-1 font-bold text-slate-800 leading-tight">Visual e inmediata</p>
              </article>
              <article className="rounded-3xl border border-white bg-white/50 p-5 shadow-sm transition-transform hover:-translate-y-1">
                <PiggyBank className="text-amber-500 mb-3" size={24} />
                <p className="font-black uppercase tracking-tighter text-[10px] text-slate-400">Objetivos</p>
                <p className="mt-1 font-bold text-slate-800 leading-tight">Huchas activas</p>
              </article>
            </div>
          </section>

          <aside className="relative flex flex-col justify-center border-t border-slate-100 bg-slate-900 p-10 sm:p-14 text-white lg:border-l lg:border-t-0">
            <div className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-white/10 ring-1 ring-white/20 shadow-inner">
              <Wallet size={32} className="text-sky-300" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-400/70">Tu Dashboard</p>
            <h2 className="mt-3 font-title text-4xl font-black tracking-tight">Bienvenido</h2>

            <button
              onClick={handleLogin}
              className="mt-10 inline-flex items-center justify-center gap-3 rounded-2xl bg-sky-500 hover:bg-sky-400 active:scale-95 transition-all px-8 py-5 font-black uppercase tracking-widest text-xs text-white shadow-2xl shadow-sky-500/30"
            >
              <LogIn size={20} />
              Entrar con Google
            </button>

            <p className="mt-8 text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center">Inicia sesión en un solo clic</p>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden pb-12 bg-gray-50">
      <div className="bg-orb-left" aria-hidden="true" />
      <div className="bg-orb-right" aria-hidden="true" />

      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-900/20">
              <Wallet size={24} />
            </div>
            <div>
              <p className="font-title text-2xl font-black text-slate-900 leading-none tracking-tight">Flowt</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Control Financiero</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
              aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
              title={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
            >
              {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
              <span className="hidden sm:inline">{theme === 'light' ? 'Oscuro' : 'Claro'}</span>
            </button>
            {installPrompt && (
              <button
                onClick={handleInstallApp}
                className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-sky-600 border border-sky-100 hover:bg-sky-100 transition-all active:scale-95 mr-2"
              >
                <Download size={14} />
                Descargar App
              </button>
            )}
            
            {user && (
              <div className="flex items-center gap-2 rounded-full border border-slate-100 bg-white p-1.5 shadow-sm transition-shadow hover:shadow-md sm:gap-3 sm:pr-5">
              <img
                src={user.photoURL || ''}
                alt=""
                className="h-10 w-10 rounded-full border-2 border-slate-50 object-cover"
              />
              <div className="hidden sm:block">
                <p className="text-sm font-black text-slate-800 leading-tight tracking-tight">{user.displayName || 'Usuario'}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Conectado</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                aria-label="Cerrar sesión"
              >
                <LogOut size={20} />
              </button>
            </div>
          )}
          </div>
        </div>
      </header>

      {user && (
        <nav className="sticky top-20 z-10 border-b border-white/70 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 sm:px-6">
            <button
              onClick={() => setActiveView('dashboard')}
              className={`flex items-center gap-2.5 px-5 py-4 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${
                activeView === 'dashboard'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <LayoutDashboard size={14} />
              Dashboard
            </button>
            <button
              onClick={() => setActiveView('suscripciones')}
              className={`flex items-center gap-2.5 px-5 py-4 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${
                activeView === 'suscripciones'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <CreditCard size={14} />
              Suscripciones
              {suscripciones.filter(s => s.activa).length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-slate-900 text-white text-[9px] font-black px-1.5">
                  {suscripciones.filter(s => s.activa).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView('calendario')}
              className={`flex items-center gap-2.5 px-5 py-4 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${
                activeView === 'calendario'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <Calendar size={14} />
              Calendario
            </button>
          </div>
        </nav>
      )}

      <main className="relative mx-auto w-full max-w-6xl px-4 pt-10 pb-12 sm:px-6">
        {!isFirebaseConfigured && (
          <div className="mb-8 flex items-center gap-4 rounded-3xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm animate-appear-up">
            <AlertTriangle className="text-amber-500 shrink-0" size={24} />
            <p className="text-sm font-bold text-amber-900 leading-tight">
              <span className="font-black uppercase tracking-widest text-[10px] block mb-0.5">Modo Demo</span>
              Firebase no está configurado. Los datos mostrados son de ejemplo.
            </p>
          </div>
        )}

        {activeView === 'suscripciones' && (
          <>
            {/* Suscripciones — resumen */}
            <section className="animate-appear-up rounded-[2.5rem] border border-white bg-white/80 p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl sm:p-10">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="inline-flex items-center gap-2 rounded-full border border-slate-100 bg-slate-50/50 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <CreditCard size={14} />
                    Gastos Recurrentes
                  </p>
                  <h2 className="mt-6 font-title text-4xl font-black text-slate-900 sm:text-5xl tracking-tight leading-none">
                    Mis Suscripciones
                  </h2>
                  <p className="mt-4 text-base font-bold text-slate-400">
                    Pagos automáticos configurados.
                  </p>
                </div>
                <button
                  onClick={() => setIsSuscripcionModalOpen(true)}
                  className="h-12 px-6 inline-flex items-center gap-3 rounded-2xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-slate-800 active:scale-95 shadow-2xl shadow-slate-900/30 shrink-0"
                >
                  <PlusCircle size={18} />
                  Nueva
                </button>
              </div>

              <div className="mt-10 grid gap-4 grid-cols-2 lg:grid-cols-3">
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Coste Mensual</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-slate-900 tabular-nums">{formatCurrency(totalMensualSuscripciones)}</p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Coste Anual</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-slate-900 tabular-nums">{formatCurrency(totalMensualSuscripciones * 12)}</p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] group col-span-2 lg:col-span-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Activas</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
                    {suscripciones.filter(s => s.activa).length}
                    <span className="text-slate-300 font-black text-base"> / {suscripciones.length}</span>
                  </p>
                </article>
              </div>
            </section>

            {/* Suscripciones — lista */}
            <section className="mt-8 glass-panel rounded-[2.5rem] p-8 shadow-xl sm:p-10">
              {suscripciones.length === 0 ? (
                <div className="py-20 text-center">
                  <CreditCard className="mx-auto mb-6 text-slate-200" size={64} />
                  <p className="text-xl font-black text-slate-300 uppercase tracking-[0.2em]">Sin suscripciones</p>
                  <p className="mt-3 text-sm font-bold text-slate-300">Añade Netflix, Spotify y todo lo que pagas cada mes</p>
                  <button
                    onClick={() => setIsSuscripcionModalOpen(true)}
                    className="mt-8 inline-flex items-center gap-2 h-12 px-6 rounded-2xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white hover:bg-slate-800 active:scale-95 transition-all shadow-xl shadow-slate-900/20"
                  >
                    <PlusCircle size={16} />
                    Añadir primera suscripción
                  </button>
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {suscripciones.map(s => {
                    const frecOpt = FRECUENCIA_OPTIONS.find(o => o.value === s.frecuencia);
                    const mensual = calcMensual(s);
                    const nextDate = getNextPaymentDate(s.dia_pago);
                    const daysUntil = Math.ceil((nextDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                    return (
                      <article
                        key={s.id}
                        className={`group relative rounded-[2.5rem] border-4 p-8 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl ${
                          s.cancelando
                            ? 'border-rose-100 bg-rose-50/30 shadow-sm'
                            : s.activa
                              ? 'border-white bg-white shadow-lg'
                              : 'border-slate-100 bg-slate-50/50 shadow-sm opacity-60'
                        }`}
                      >
                        {/* Cancelación pendiente — banner */}
                        {s.cancelando && (
                          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-rose-100/70 px-4 py-3">
                            <XCircle size={14} className="text-rose-500 shrink-0" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">
                              Se cancela el día {s.dia_pago}
                            </p>
                            <button
                              onClick={() => handleUndoCancelSuscripcion(s)}
                              className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-700 transition-colors"
                              title="Deshacer cancelación"
                            >
                              <Undo2 size={12} />
                              Deshacer
                            </button>
                          </div>
                        )}

                        <div className="mb-6 flex items-start justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div
                              className={`h-14 w-14 rounded-2xl flex items-center justify-center shadow-lg shrink-0 ${s.cancelando ? 'opacity-50' : ''}`}
                              style={{ backgroundColor: s.color + '20', color: s.color }}
                            >
                              <CreditCard size={24} />
                            </div>
                            <div>
                              <h4 className={`font-black text-xl leading-tight tracking-tight ${s.cancelando ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                {s.nombre}
                              </h4>
                              <span className="mt-1 inline-block rounded-xl px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-white shadow-sm" style={{ backgroundColor: s.cancelando ? '#94a3b8' : s.color }}>
                                {CATEGORIA_OPTIONS.find(c => c.value === s.categoria)?.label ?? s.categoria}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-2 transition-all sm:opacity-0 sm:group-hover:opacity-100 sm:translate-y-2 sm:group-hover:translate-y-0 shrink-0">
                            {!s.cancelando && (
                              <button
                                onClick={() => openEditSuscripcion(s)}
                                className="flex h-9 w-9 items-center justify-center bg-slate-100 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-xl transition-all active:scale-90"
                                title="Editar"
                              >
                                <Edit size={16} />
                              </button>
                            )}
                            
                            {!s.cancelando && (
                              <button
                                onClick={() => handleCancelSuscripcion(s)}
                                className="flex h-9 w-9 items-center justify-center bg-slate-100 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all active:scale-90"
                                title="Cancelar suscripción (al final del periodo)"
                              >
                                <XCircle size={16} />
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteSuscripcion(s)}
                              className="flex h-9 w-9 items-center justify-center bg-rose-50 text-rose-400 hover:text-rose-600 hover:bg-rose-100 rounded-xl transition-all active:scale-90"
                              title="Eliminar ahora (borrado total)"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <p className={`text-4xl font-black tabular-nums tracking-tighter leading-none ${s.cancelando ? 'text-slate-400' : 'text-slate-900'}`}>
                          {formatCurrency(s.mi_parte != null ? s.mi_parte : s.importe)}
                        </p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          {frecOpt?.label ?? s.frecuencia}
                          {s.frecuencia !== 'mensual' && (
                            <span className="text-slate-300"> · {formatCurrency(mensual)}/mes</span>
                          )}
                        </p>
                        {s.mi_parte != null && (
                          <p className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-600">
                            <Undo2 size={10} />
                            Compartida · total {formatCurrency(s.importe)}
                          </p>
                        )}

                        <div className="mt-6 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2 text-slate-400">
                            <Calendar size={14} />
                            <span className="text-[10px] font-black uppercase tracking-widest">
                              Día {s.dia_pago}
                              {!s.cancelando && s.activa && daysUntil <= 7 && (
                                <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                                  · {daysUntil === 0 ? 'Hoy' : daysUntil === 1 ? 'Mañana' : `en ${daysUntil} días`}
                                </span>
                              )}
                            </span>
                          </div>
                          {!s.cancelando && (
                            <button
                              onClick={() => handleToggleSuscripcion(s)}
                              className="transition-all active:scale-90"
                              title={s.activa ? 'Pausar' : 'Activar'}
                            >
                              {s.activa
                                ? <ToggleRight size={28} style={{ color: s.color }} />
                                : <ToggleLeft size={28} className="text-slate-300" />
                              }
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {activeView === 'calendario' && (
          <section className="animate-appear-up space-y-10">
            <header className="rounded-[3rem] border-4 border-white bg-white/70 p-10 shadow-2xl shadow-slate-900/5 backdrop-blur-2xl transition-all hover:shadow-slate-900/10">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-4">
                  <p className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50/50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-sky-500">
                    <Sparkles size={14} className="animate-pulse" />
                    Agenda Financiera
                  </p>
                  <h2 className="font-title text-5xl font-black text-slate-900 tracking-tighter leading-none">
                    Calendario de <span className="text-sky-500">Pagos</span>
                  </h2>
                  <p className="text-base font-bold text-slate-400">
                    Visualiza tus próximos cargos recurrentes de un vistazo.
                  </p>
                </div>
                
                <div className="flex flex-col items-center gap-6">
                  <div className="flex items-center gap-3 bg-slate-900/5 p-2 rounded-[2rem] border-2 border-white shadow-inner backdrop-blur-sm">
                    <button 
                      onClick={() => {
                        const d = new Date(currentCalendarDate);
                        d.setMonth(d.getMonth() - 1);
                        setCurrentCalendarDate(d);
                      }}
                      className="h-14 w-14 flex items-center justify-center rounded-2xl bg-white text-slate-600 hover:text-sky-600 shadow-xl shadow-slate-900/5 active:scale-90 transition-all group"
                      aria-label="Mes anterior"
                    >
                      <ChevronLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
                    </button>
                    <span className="min-w-[180px] text-center text-lg font-black uppercase tracking-[0.15em] text-slate-900">
                      {currentCalendarDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
                    </span>
                    <button 
                      onClick={() => {
                        const d = new Date(currentCalendarDate);
                        d.setMonth(d.getMonth() + 1);
                        setCurrentCalendarDate(d);
                      }}
                      className="h-14 w-14 flex items-center justify-center rounded-2xl bg-white text-slate-600 hover:text-sky-600 shadow-xl shadow-slate-900/5 active:scale-90 transition-all group"
                      aria-label="Mes siguiente"
                    >
                      <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>

                  {(() => {
                    const totalMonth = suscripciones
                      .filter(s => s.activa || s.cancelando)
                      .reduce((sum, s) => sum + calcMensual(s), 0);
                    return (
                      <div className="flex items-center gap-4 px-6 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl shadow-slate-900/20">
                        <Wallet size={16} className="text-sky-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Total Mes:</span>
                        <span className="text-xl font-black tabular-nums">{formatCurrency(totalMonth)}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </header>

            <div className="rounded-[3rem] border-4 border-white bg-white/60 p-2 sm:p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl">
              <div className="grid grid-cols-7 mb-4 px-4 border-b border-slate-100/50">
                {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(day => (
                  <div key={day} className="text-center text-[11px] font-black text-slate-500 tracking-[0.2em] py-8">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-3 sm:gap-5 p-2">
                {(() => {
                  const daysInMonth = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + 1, 0).getDate();
                  const firstDayOfMonth = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), 1).getDay();
                  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
                  
                  const days = [];
                  for (let i = 0; i < startOffset; i++) {
                    days.push(<div key={`empty-${i}`} className="h-32 sm:h-40 opacity-10 pointer-events-none" />);
                  }

                  for (let d = 1; d <= daysInMonth; d++) {
                    const isToday = new Date().toDateString() === new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), d).toDateString();
                    const cellDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), d);
                    cellDate.setHours(0, 0, 0, 0);
                    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

                    const daySubs = suscripciones.filter(s => {
                      if (!s.activa && !s.cancelando) return false;
                      if (s.dia_pago !== d) return false;

                      // Don't show subscription in months before it was created
                      if (s.created_at) {
                        const createdDate: Date = s.created_at?.toDate ? s.created_at.toDate() : new Date(s.created_at);
                        const createdMonth = new Date(createdDate.getFullYear(), createdDate.getMonth(), 1);
                        const cellMonth = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), 1);
                        if (cellMonth < createdMonth) return false;
                      }

                      // Cancelled subs only appear on FUTURE days (their next charge date)
                      if (s.cancelando) {
                        const next = getNextPaymentDate(s.dia_pago);
                        const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
                        const cellDay = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), d);
                        return nextDay.getTime() === cellDay.getTime();
                      }
                      return true;
                    });

                    days.push(
                      <div 
                        key={d} 
                        className={`group relative h-32 sm:h-40 rounded-[2.2rem] border-2 p-5 transition-all duration-500 ${
                          isToday 
                            ? 'border-sky-500 bg-white shadow-2xl shadow-sky-500/20 z-10' 
                            : 'border-slate-100 bg-white/80 hover:bg-white hover:border-sky-200 hover:shadow-2xl hover:shadow-slate-900/10 hover:-translate-y-1'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <span className={`text-xl font-black tabular-nums tracking-tighter ${isToday ? 'text-sky-600' : 'text-slate-700 group-hover:text-slate-900 transition-colors'}`}>
                            {d}
                          </span>
                          {isToday && (
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-black text-sky-500 uppercase tracking-widest">Hoy</span>
                              <div className="h-2.5 w-2.5 rounded-full bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.5)] animate-pulse" />
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-2 overflow-y-auto max-h-[80px] sm:max-h-[100px] custom-scrollbar pr-1">
                          {daySubs.map(s => (
                            <div 
                              key={s.id} 
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold leading-none transition-all cursor-default ${
                                s.cancelando ? 'opacity-50 line-through' : 'hover:scale-[1.02]'
                              }`}
                              style={{ 
                                backgroundColor: 'white',
                                color: s.color,
                                border: `2px solid ${s.color}`,
                              }}
                              title={`${s.nombre}: ${formatCurrency(s.importe)}`}
                            >
                              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                              <span className="truncate flex-1 font-black">{s.nombre}</span>
                              <span className="tabular-nums shrink-0 opacity-70 text-[10px]">{formatCurrency(s.importe)}</span>
                            </div>
                          ))}
                        </div>

                        {!isToday && daySubs.length === 0 && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none">
                            <PlusCircle size={32} className="text-slate-900" />
                          </div>
                        )}
                      </div>
                    );
                  }
                  return days;
                })()}
              </div>
            </div>
          </section>
        )}

        {activeView === 'dashboard' && (
          <>

        <section className="animate-appear-up rounded-[2.5rem] border border-white bg-white/80 p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl sm:p-10 transition-all hover:shadow-slate-900/10">
          <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:items-center">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-slate-100 bg-slate-50/50 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <ReceiptText size={14} />
                Vista General
              </p>
              <h2 className="mt-6 font-title text-4xl font-black text-slate-900 sm:text-5xl tracking-tight leading-none">
                Resumen de cuenta
              </h2>
              <p className="mt-4 text-base font-bold text-slate-400 sm:text-lg">
                Ingresos y gastos en tiempo real.
              </p>

              {installPrompt && (
                <button
                  onClick={handleInstallApp}
                  className="mt-6 flex w-full sm:hidden items-center justify-center gap-3 rounded-2xl bg-sky-500 p-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-sky-500/20 active:scale-95 transition-all"
                >
                  <Download size={18} />
                  Instalar Aplicación
                </button>
              )}

              <div className="mt-10 grid gap-4 grid-cols-2 lg:grid-cols-4">
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Cartera Principal</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
                    {formatCurrency(principalHucha?.saldo_acumulado || 0)}
                  </p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Saldo Carteras</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-slate-900 tabular-nums">
                    {formatCurrency(balance - (principalHucha?.saldo_acumulado || 0))}
                  </p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group border-b-sky-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-sky-600 transition-colors">Ingresos</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-sky-600 tabular-nums">+{formatCurrency(totalIngresos)}</p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-4 sm:p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group border-b-orange-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-orange-600 transition-colors">Gastos</p>
                  <p className="mt-2 text-lg sm:text-xl font-black text-orange-600 tabular-nums">-{formatCurrency(totalGastos)}</p>
                </article>
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-white bg-slate-900 p-8 text-white shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] transition-transform hover:scale-[1.02]">
              <div className="mb-6 pb-6 border-b border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-sky-400 mb-1">Saldo Disponible (Cartera Principal)</p>
                <p className="font-title text-5xl font-black tabular-nums tracking-tighter leading-none text-white">
                  {formatCurrency(principalHucha?.saldo_acumulado || 0)}
                </p>
              </div>

              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Saldo Consolidado (Total Huchas)</p>
              <p className="mt-2 font-title text-3xl font-black tabular-nums tracking-tighter leading-none text-slate-300 opacity-80">{formatCurrency(balance)}</p>

              <div className="mt-10 grid grid-cols-2 gap-4 text-sm font-bold">
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition-all hover:bg-white/10">
                  <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Entradas</p>
                  <p className="flex items-center gap-2 text-sky-300 tabular-nums text-lg">
                    <TrendingUp size={18} />
                    {formatCurrency(totalIngresos)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 transition-all hover:bg-white/10">
                  <p className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">Salidas</p>
                  <p className="flex items-center gap-2 text-orange-300 tabular-nums text-lg">
                    <TrendingDown size={18} />
                    {formatCurrency(totalGastos)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[0.95fr_1.05fr]">
          <article className="glass-panel rounded-[2.5rem] p-8 shadow-xl transition-all hover:shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <h3 className="section-title text-slate-900 font-black uppercase tracking-widest text-[11px]">Evolución Semestral</h3>
              <button
                onClick={openTimeline}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-2xl bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-sky-50 hover:text-sky-600 active:scale-95"
              >
                <BarChart2 size={14} />
                Timeline
              </button>
            </div>
            <div className="h-[280px] w-full min-h-[280px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontWeight: 800, fontSize: 10 }} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: '#f8fafc', radius: 12 }}
                    contentStyle={{
                      borderRadius: '20px',
                      border: 'none',
                      boxShadow: '0 25px 50px -12px rgba(2, 6, 23, 0.25)',
                      padding: '16px',
                      fontWeight: 'bold',
                    }}
                    formatter={(value) => [formatCurrency(Number(value)), '']}
                  />
                  <Bar dataKey="ingresos" fill="#0ea5e9" radius={[8, 8, 0, 0]} barSize={28} />
                  <Bar dataKey="gastos" fill="#f97316" radius={[8, 8, 0, 0]} barSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="glass-panel rounded-[2.5rem] p-8 shadow-xl transition-all hover:shadow-2xl">
            <div className="mb-8 flex items-center justify-between gap-4">
              <h3 className="section-title text-slate-900 font-black uppercase tracking-widest text-[11px]">Actividad Reciente</h3>
              <button 
                onClick={openHistoryModal}
                className="h-10 px-5 rounded-2xl bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-200 hover:text-slate-900 active:scale-95 focus:outline-none focus:ring-4 focus:ring-slate-100"
              >
                Historial
              </button>
            </div>

            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {movimientos.length > 0 ? (
                movimientos.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-center justify-between rounded-3xl border border-slate-50 bg-white/50 p-4 transition-all hover:border-sky-100 hover:bg-white hover:shadow-xl hover:translate-x-2"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm transition-transform group-hover:scale-110 ${
                          m.tipo === 'ingreso'
                            ? 'bg-sky-50 text-sky-600 ring-1 ring-sky-100'
                            : 'bg-orange-50 text-orange-600 ring-1 ring-orange-100'
                        }`}
                      >
                        {m.tipo === 'ingreso' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                      </div>
                      <div>
                        {editingMovimientoId === m.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              type="text"
                              className="text-sm font-black text-slate-900 tracking-tight bg-slate-50 border-2 border-sky-100 rounded-xl px-2 py-1 focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:bg-white"
                              value={tempConcepto}
                              onChange={(e) => setTempConcepto(e.target.value)}
                              onBlur={() => handleUpdateMovimientoConcepto(m.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateMovimientoConcepto(m.id);
                                if (e.key === 'Escape') setEditingMovimientoId(null);
                              }}
                            />
                            <button
                              onClick={() => handleUpdateMovimientoConcepto(m.id)}
                              className="text-emerald-500 hover:text-emerald-600 transition-colors"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group/concept">
                            <p 
                              className="text-sm font-black text-slate-900 tracking-tight cursor-pointer hover:text-sky-600 transition-colors"
                              onClick={() => {
                                setEditingMovimientoId(m.id);
                                setTempConcepto(m.concepto);
                              }}
                            >
                              {m.concepto}
                            </p>
                            <Edit 
                              size={12} 
                              className="text-slate-300 opacity-0 group-hover/concept:opacity-100 transition-opacity cursor-pointer hover:text-sky-500" 
                              onClick={() => {
                                setEditingMovimientoId(m.id);
                                setTempConcepto(m.concepto);
                              }}
                            />
                          </div>
                        )}
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{formatDate(m.fecha_operacion)}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="text-right">
                        <p className={`text-base font-black tabular-nums ${m.tipo === 'ingreso' ? 'text-sky-700' : 'text-orange-700'} ${m.tipo === 'gasto' && (m.compensado_por?.length ?? 0) > 0 ? 'line-through opacity-60' : ''}`}>
                          {m.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(m.importe)}
                        </p>
                        {m.tipo === 'gasto' && (m.compensado_por?.length ?? 0) > 0 && (
                          <p className="text-xs font-black tabular-nums text-emerald-600 -mt-0.5">
                            neto −{formatCurrency(m.importe_neto ?? m.importe)}
                          </p>
                        )}
                        {m.tipo === 'ingreso' && m.compensa_movimiento_id && (
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mt-0.5 flex items-center gap-1 justify-end">
                            <Undo2 size={10} /> compensación
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 transition-all sm:opacity-0 sm:group-hover:opacity-100 sm:translate-x-2 sm:group-hover:translate-x-0">
                        {m.tipo === 'gasto' && huchas.length > 0 && (
                          <select
                            className="text-[9px] font-black uppercase tracking-widest bg-slate-100 border-none text-slate-500 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:bg-white focus:text-sky-600 cursor-pointer transition-all hover:bg-slate-200"
                            value={m.hucha_id || ''}
                            onChange={(e) => handleChangeMovimientoHucha(m, e.target.value)}
                            aria-label="Asignar a hucha"
                          >
                            <option value="" disabled>Cartera...</option>
                            {huchas.map(h => (
                              <option key={h.id} value={h.id}>{h.nombre}</option>
                            ))}
                          </select>
                        )}
                        {m.tipo === 'ingreso' && m.compensa_movimiento_id ? (
                          <button
                            type="button"
                            onClick={() => handleUnlinkMovimiento(m)}
                            className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 rounded-xl px-3 py-1.5 hover:bg-emerald-100 transition-all"
                            title="Deshacer vínculo con el gasto"
                          >
                            <X size={11} className="inline -mt-0.5 mr-1" />
                            Desvincular
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openLinkModal(m)}
                            className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 rounded-xl px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                            title={m.tipo === 'gasto' ? 'Compensar con uno o varios ingresos' : 'Marcar como compensación de un gasto'}
                          >
                            <Undo2 size={11} className="inline -mt-0.5 mr-1" />
                            Vincular
                          </button>
                        )}
                        {huchas.length > 0 && (
                          <button
                            type="button"
                            onClick={() => openConvertModal(m)}
                            className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500 rounded-xl px-3 py-1.5 hover:bg-sky-50 hover:text-sky-600 transition-all"
                            title={m.tipo === 'gasto' ? 'Convertir este gasto en ingreso' : 'Convertir este ingreso en gasto'}
                          >
                            <ArrowRightLeft size={11} className="inline -mt-0.5 mr-1" />
                            {m.tipo === 'gasto' ? 'A ingreso' : 'A gasto'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[2rem] border-4 border-dashed border-slate-50 bg-slate-50/30 px-4 py-14 text-center text-sm font-black uppercase tracking-widest text-slate-300">
                  Sin actividad
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="mt-8 glass-panel rounded-[2.5rem] p-8 shadow-xl sm:p-10 transition-all hover:shadow-2xl">
          <div className="mb-10 flex flex-wrap items-center justify-between gap-6 border-b border-slate-100 pb-8">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 shadow-sm shadow-sky-500/10">
                <PiggyBank size={24} />
              </div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Mis Carteras</h3>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsTransferModalOpen(true)}
                disabled={huchas.length < 2}
                className="h-12 px-6 inline-flex items-center gap-3 rounded-2xl bg-white border-2 border-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-50 hover:border-slate-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                <ArrowRightLeft size={18} />
                Transferir
              </button>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="h-12 px-6 inline-flex items-center gap-3 rounded-2xl bg-slate-900 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-slate-800 active:scale-95 shadow-2xl shadow-slate-900/30"
              >
                <PlusCircle size={18} />
                Nueva Hucha
              </button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {huchas.length > 0 ? (
              huchas.map((h) => {
                const progress = h.objetivo ? Math.min((h.saldo_acumulado / h.objetivo) * 100, 100) : 0;
                const allocationLabel = h.tipo_aportacion === 'porcentaje' ? `${h.valor_aportacion}%` : h.tipo_aportacion === 'flat' ? `${h.valor_aportacion}€` : 'Resto';

                return (
                  <article
                    key={h.id}
                    className={`group relative rounded-[2.5rem] border-4 p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ${
                      h.es_principal 
                        ? 'border-sky-100 bg-sky-50/30 shadow-sky-500/10' 
                        : 'border-white bg-white shadow-lg'
                    }`}
                  >
                    <div className="mb-6 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-black text-slate-900 text-xl leading-tight tracking-tight uppercase">{h.nombre}</h4>
                          {h.es_suscripciones && (
                            <span className="inline-flex items-center gap-1 rounded-xl bg-violet-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-violet-700">
                              <CreditCard size={10} />
                              Auto
                            </span>
                          )}
                        </div>
                        <span className="mt-2 inline-block rounded-xl bg-slate-900 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-slate-900/20">
                          {allocationLabel}
                        </span>
                      </div>
                      
                      <div className="flex gap-2 transition-all sm:opacity-0 sm:group-hover:opacity-100 sm:translate-y-2 sm:group-hover:translate-y-0">
                        <button 
                          onClick={() => openEditModal(h)}
                          className="flex h-11 w-11 items-center justify-center bg-slate-100 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-2xl transition-all active:scale-90 focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                          title="Editar hucha"
                          aria-label={`Editar hucha ${h.nombre}`}
                        >
                          <Edit size={20} />
                        </button>
                        <button 
                          onClick={() => handleDeleteHucha(h)}
                          className="flex h-11 w-11 items-center justify-center bg-slate-100 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all active:scale-90 focus:outline-none focus:ring-4 focus:ring-rose-500/10"
                          title="Eliminar hucha"
                          aria-label={`Eliminar hucha ${h.nombre}`}
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>

                    <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tighter leading-none">{formatCurrency(h.saldo_acumulado)}</p>
                    {h.objetivo && <p className="mt-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Objetivo: {formatCurrency(h.objetivo)}</p>}

                    {h.objetivo && (
                      <div className="mt-8">
                        <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100 shadow-inner">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-1000 ease-out shadow-[0_0_20px_rgba(14,165,233,0.5)]"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="mt-3 text-right text-xs font-black text-slate-900 tabular-nums">{Math.round(progress)}%</p>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="rounded-[3rem] border-4 border-dashed border-slate-100 bg-white/50 p-16 text-center md:col-span-2 xl:col-span-3 transition-all hover:bg-white hover:border-sky-100 group">
                <PiggyBank className="mx-auto mb-6 text-slate-200 group-hover:text-sky-200 transition-colors" size={64} />
                <p className="text-xl font-black text-slate-300 uppercase tracking-[0.2em] group-hover:text-sky-300 transition-colors">Vacio</p>
              </div>
            )}
          </div>
        </section>
        </>
        )}
      </main>

      {/* Modal Nueva Hucha */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md overflow-hidden border border-white animate-in fade-in zoom-in duration-300">
            <div className="p-10 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none">
                {editingId ? 'Actualizar' : 'Nueva Hucha'}
              </h3>
              <button 
                onClick={closeModal}
                className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                aria-label="Cerrar modal"
              >
                <X size={28} className="text-slate-400 hover:text-slate-900 transition-colors" />
              </button>
            </div>

            <form onSubmit={handleCreateOrUpdateHucha} className="p-10 space-y-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="hucha-nombre">Nombre de Identificación</label>
                  <input
                    id="hucha-nombre"
                    required
                    type="text"
                    placeholder="Ej: AHORRO_PERSONAL"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all text-slate-900 font-bold placeholder:text-slate-300"
                    value={newHucha.nombre}
                    onChange={(e) => setNewHucha({...newHucha, nombre: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="hucha-tipo">Distribución</label>
                    <select
                      id="hucha-tipo"
                      className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                      value={newHucha.tipo_aportacion}
                      onChange={(e) => setNewHucha({...newHucha, tipo_aportacion: e.target.value as any})}
                    >
                      <option value="porcentaje">Porcentaje %</option>
                      <option value="flat">Fijo €</option>
                      <option value="resto">Resto</option>
                    </select>
                  </div>

                  {newHucha.tipo_aportacion !== 'resto' && (
                    <div className="animate-in slide-in-from-right-8 duration-500">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="hucha-valor">
                        {newHucha.tipo_aportacion === 'porcentaje' ? 'Valor %' : 'Euros €'}
                      </label>
                      <input
                        id="hucha-valor"
                        required
                        type="number"
                        min="0"
                        step={newHucha.tipo_aportacion === 'porcentaje' ? "1" : "0.01"}
                        className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold tabular-nums"
                        value={newHucha.valor_aportacion}
                        onChange={(e) => setNewHucha({...newHucha, valor_aportacion: Number(e.target.value)})}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="hucha-objetivo">Objetivo Final (€)</label>
                  <input
                    id="hucha-objetivo"
                    type="number"
                    min="0"
                    placeholder="0.00"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold placeholder:text-slate-300 tabular-nums"
                    value={newHucha.objetivo || ''}
                    onChange={(e) => setNewHucha({...newHucha, objetivo: Number(e.target.value)})}
                  />
                </div>
              </div>

              <div className="flex items-center gap-5 p-6 rounded-[1.5rem] bg-slate-50 border-2 border-slate-100 transition-colors hover:bg-white hover:border-sky-100 group">
                <div className="relative flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    id="es_principal"
                    className="peer w-8 h-8 rounded-xl border-2 border-slate-200 bg-white text-sky-500 focus:ring-sky-500/20 cursor-pointer transition-all appearance-none checked:bg-sky-500 checked:border-sky-500"
                    checked={newHucha.es_principal}
                    onChange={(e) => setNewHucha({...newHucha, es_principal: e.target.checked})}
                  />
                  <ShieldCheck className="absolute pointer-events-none hidden peer-checked:block left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white" size={20} />
                </div>
                <label htmlFor="es_principal" className="text-sm font-black text-slate-500 group-hover:text-slate-900 cursor-pointer select-none leading-tight transition-colors">
                  Cartera Principal <span className="block text-[9px] uppercase tracking-widest text-slate-400 mt-1 font-bold">Recibe automáticamente el sobrante</span>
                </label>
              </div>

              <div className="pt-6 flex gap-6">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:bg-slate-50 active:scale-95 transition-all focus:outline-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-8 py-5 rounded-[1.5rem] bg-slate-900 text-white font-black uppercase tracking-[0.2em] text-[10px] hover:bg-slate-800 active:scale-95 transition-all shadow-[0_20px_50px_-15px_rgba(15,23,42,0.4)]"
                >
                  {editingId ? 'Confirmar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transferir */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md overflow-hidden border border-white animate-in fade-in zoom-in duration-300">
            <div className="p-10 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Mover Fondos</h3>
              <button 
                onClick={() => {
                  setIsTransferModalOpen(false);
                  setTransferData({ fromHuchaId: '', toHuchaId: '', amount: 0 });
                }}
                className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                aria-label="Cerrar modal"
              >
                <X size={28} className="text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleTransfer} className="p-10 space-y-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="transfer-from">Origen de fondos</label>
                  <select
                    id="transfer-from"
                    required
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                    value={transferData.fromHuchaId}
                    onChange={(e) => setTransferData({...transferData, fromHuchaId: e.target.value})}
                  >
                    <option value="" disabled>Selecciona origen...</option>
                    {huchas.map(h => (
                      <option key={h.id} value={h.id} disabled={h.saldo_acumulado <= 0}>
                        {h.nombre} ({formatCurrency(h.saldo_acumulado)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-center -my-4 relative z-10">
                  <div className="bg-white border-2 border-slate-50 p-3 rounded-full shadow-lg text-sky-500 animate-bounce-subtle">
                    <ArrowDownRight size={24} className="rotate-45" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="transfer-to">Destino final</label>
                  <select
                    id="transfer-to"
                    required
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                    value={transferData.toHuchaId}
                    onChange={(e) => setTransferData({...transferData, toHuchaId: e.target.value})}
                  >
                    <option value="" disabled>Selecciona destino...</option>
                    {huchas.map(h => (
                      <option key={h.id} value={h.id} disabled={h.id === transferData.fromHuchaId}>
                        {h.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="transfer-amount">Importe del Traspaso (€)</label>
                <input
                  id="transfer-amount"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full px-6 py-6 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-black text-4xl tabular-nums tracking-tighter"
                  value={transferData.amount || ''}
                  onChange={(e) => setTransferData({...transferData, amount: Number(e.target.value)})}
                />
              </div>

              <div className="pt-6 flex gap-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsTransferModalOpen(false);
                    setTransferData({ fromHuchaId: '', toHuchaId: '', amount: 0 });
                  }}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:bg-slate-50 active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!transferData.fromHuchaId || !transferData.toHuchaId || transferData.amount <= 0}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] bg-sky-600 text-white font-black uppercase tracking-[0.2em] text-[10px] hover:bg-sky-500 active:scale-95 transition-all shadow-[0_20px_50px_-15px_rgba(14,165,233,0.4)] disabled:opacity-40"
                >
                  Ejecutar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Eliminar Hucha con Fondos */}
      {deleteHuchaData.hucha && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md overflow-hidden border border-white animate-in fade-in zoom-in duration-300">
            <div className="p-10 border-b border-rose-50 flex items-center justify-between bg-rose-50/30">
              <h3 className="text-2xl font-black text-rose-900 uppercase tracking-tight leading-none">Borrar Cartera</h3>
              <button 
                onClick={() => setDeleteHuchaData({ hucha: null, mode: 'auto', manualDistributions: {} })}
                className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none"
                aria-label="Cerrar modal"
              >
                <X size={28} className="text-rose-400" />
              </button>
            </div>

            <form onSubmit={confirmDeleteHuchaWithFunds} className="p-10 space-y-8">
              <div className="rounded-[2rem] border-4 border-amber-100 bg-amber-50/50 p-6 flex flex-col items-center text-center gap-4 shadow-inner">
                <div className="h-16 w-16 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600 shadow-sm animate-pulse-slow">
                  <AlertTriangle size={32} />
                </div>
                <p className="text-sm font-bold text-amber-900 leading-relaxed max-w-[240px]">
                  "{deleteHuchaData.hucha.nombre}" tiene <span className="text-2xl font-black tabular-nums block mt-1">{formatCurrency(deleteHuchaData.hucha.saldo_acumulado)}</span> 
                  ¿Dónde movemos este capital?
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 text-center">Método de Reparto</label>
                <div className="grid grid-cols-2 gap-3 bg-slate-100 p-2 rounded-[1.5rem] shadow-inner">
                  <button
                    type="button"
                    onClick={() => setDeleteHuchaData({...deleteHuchaData, mode: 'auto'})}
                    className={`py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${deleteHuchaData.mode === 'auto' ? 'bg-white text-slate-900 shadow-xl scale-105' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                    Automático
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteHuchaData({...deleteHuchaData, mode: 'manual'})}
                    className={`py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${deleteHuchaData.mode === 'manual' ? 'bg-white text-slate-900 shadow-xl scale-105' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                    Manual
                  </button>
                </div>
              </div>

              {deleteHuchaData.mode === 'manual' && (
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar p-1">
                  {huchas.filter(h => h.id !== deleteHuchaData.hucha?.id).map(h => (
                    <div key={h.id} className="flex items-center justify-between gap-4 p-5 rounded-[1.5rem] bg-slate-50 border-2 border-slate-100 transition-all hover:bg-white hover:border-sky-100 hover:shadow-lg">
                      <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest truncate flex-1 leading-none" htmlFor={`manual-dist-${h.id}`}>{h.nombre}</label>
                      <div className="relative w-36">
                        <input
                          id={`manual-dist-${h.id}`}
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 text-right pr-10 font-black tabular-nums transition-all"
                          value={deleteHuchaData.manualDistributions[h.id] || ''}
                          onChange={(e) => setDeleteHuchaData({
                            ...deleteHuchaData,
                            manualDistributions: {
                              ...deleteHuchaData.manualDistributions,
                              [h.id]: Number(e.target.value)
                            }
                          })}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 font-black text-xs">€</span>
                      </div>
                    </div>
                  ))}
                  
                  <div className="mt-6 p-6 rounded-[1.5rem] bg-slate-900 text-white flex flex-col gap-2 shadow-2xl shadow-slate-900/20">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Saldo pendiente:</span>
                    <span className={`text-3xl font-black tabular-nums tracking-tight ${
                      Math.abs(Object.values(deleteHuchaData.manualDistributions).reduce((a,b)=>a+b, 0) - deleteHuchaData.hucha.saldo_acumulado) < 0.01
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}>
                      {formatCurrency(deleteHuchaData.hucha.saldo_acumulado - Object.values(deleteHuchaData.manualDistributions).reduce((a,b)=>a+b, 0))}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-6 flex gap-6">
                <button
                  type="button"
                  onClick={() => setDeleteHuchaData({ hucha: null, mode: 'auto', manualDistributions: {} })}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:bg-slate-50 active:scale-95 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deleteHuchaData.mode === 'manual' && Math.abs(Object.values(deleteHuchaData.manualDistributions).reduce((a,b)=>a+b, 0) - deleteHuchaData.hucha.saldo_acumulado) > 0.01}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] bg-rose-600 text-white font-black uppercase tracking-[0.2em] text-[10px] hover:bg-rose-500 active:scale-95 transition-all shadow-[0_20px_50px_-15px_rgba(225,29,72,0.4)] disabled:opacity-40"
                >
                  Borrar Todo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Historial Completo */}
      {isHistoryModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-xl animate-fade-in" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden border-4 border-white animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-xl shadow-slate-900/20">
                  <ReceiptText size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Historial Completo</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Todos tus movimientos</p>
                </div>
              </div>
              <button 
                onClick={() => setIsHistoryModalOpen(false)}
                className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white border-2 border-slate-100 text-slate-400 hover:text-rose-500 hover:border-rose-100 transition-all active:scale-90 shadow-sm"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-4 custom-scrollbar bg-white">
              {history.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-3xl border border-slate-50 bg-slate-50/30 p-5 transition-all hover:border-sky-100 hover:bg-white hover:shadow-xl group"
                >
                  <div className="flex items-center gap-5">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm transition-transform group-hover:scale-110 ${
                        m.tipo === 'ingreso'
                          ? 'bg-sky-50 text-sky-600 ring-1 ring-sky-100'
                          : 'bg-orange-50 text-orange-600 ring-1 ring-orange-100'
                      }`}
                    >
                      {m.tipo === 'ingreso' ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                    </div>
                    <div>
                      {editingMovimientoId === m.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            className="text-sm font-black text-slate-900 tracking-tight bg-slate-50 border-2 border-sky-100 rounded-xl px-2 py-1 focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:bg-white"
                            value={tempConcepto}
                            onChange={(e) => setTempConcepto(e.target.value)}
                            onBlur={() => handleUpdateMovimientoConcepto(m.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateMovimientoConcepto(m.id);
                              if (e.key === 'Escape') setEditingMovimientoId(null);
                            }}
                          />
                          <button
                            onClick={() => handleUpdateMovimientoConcepto(m.id)}
                            className="text-emerald-500 hover:text-emerald-600 transition-colors"
                          >
                            <CheckCircle2 size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group/concept">
                          <p 
                            className="text-base font-black text-slate-900 tracking-tight leading-none cursor-pointer hover:text-sky-600 transition-colors"
                            onClick={() => {
                              setEditingMovimientoId(m.id);
                              setTempConcepto(m.concepto);
                            }}
                          >
                            {m.concepto}
                          </p>
                          <Edit 
                            size={12} 
                            className="text-slate-300 opacity-0 group-hover/concept:opacity-100 transition-opacity cursor-pointer hover:text-sky-500" 
                            onClick={() => {
                              setEditingMovimientoId(m.id);
                              setTempConcepto(m.concepto);
                            }}
                          />
                        </div>
                      )}
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">{formatDate(m.fecha_operacion)}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className={`text-lg font-black tabular-nums ${m.tipo === 'ingreso' ? 'text-sky-700' : 'text-orange-700'} ${m.tipo === 'gasto' && (m.compensado_por?.length ?? 0) > 0 ? 'line-through opacity-60' : ''}`}>
                        {m.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(m.importe)}
                      </p>
                      {m.tipo === 'gasto' && (m.compensado_por?.length ?? 0) > 0 && (
                        <p className="text-sm font-black tabular-nums text-emerald-600 -mt-0.5">
                          neto −{formatCurrency(m.importe_neto ?? m.importe)}
                        </p>
                      )}
                      {m.tipo === 'ingreso' && m.compensa_movimiento_id && (
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mt-0.5 flex items-center gap-1 justify-end">
                          <Undo2 size={10} /> compensación
                        </p>
                      )}
                    </div>
                    {m.tipo === 'gasto' && huchas.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">Hucha:</span>
                        <select
                          className="text-[9px] font-black uppercase tracking-widest bg-white border-2 border-slate-100 text-slate-500 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:text-sky-600 cursor-pointer transition-all hover:bg-slate-50"
                          value={m.hucha_id || ''}
                          onChange={(e) => handleChangeMovimientoHucha(m, e.target.value)}
                        >
                          <option value="" disabled>Seleccionar...</option>
                          {huchas.map(h => (
                            <option key={h.id} value={h.id}>{h.nombre}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {m.tipo === 'ingreso' && m.compensa_movimiento_id ? (
                        <button
                          type="button"
                          onClick={() => handleUnlinkMovimiento(m)}
                          className="text-[9px] font-black uppercase tracking-widest bg-emerald-50 border-2 border-emerald-100 text-emerald-600 rounded-xl px-3 py-1.5 hover:bg-emerald-100 transition-all"
                        >
                          <X size={11} className="inline -mt-0.5 mr-1" />
                          Desvincular
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openLinkModal(m)}
                          className="text-[9px] font-black uppercase tracking-widest bg-white border-2 border-slate-100 text-slate-500 rounded-xl px-3 py-1.5 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-100 transition-all"
                        >
                          <Undo2 size={11} className="inline -mt-0.5 mr-1" />
                          Vincular
                        </button>
                      )}
                      {huchas.length > 0 && (
                        <button
                          type="button"
                          onClick={() => openConvertModal(m)}
                          className="text-[9px] font-black uppercase tracking-widest bg-white border-2 border-slate-100 text-slate-500 rounded-xl px-3 py-1.5 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-100 transition-all"
                        >
                          <ArrowRightLeft size={11} className="inline -mt-0.5 mr-1" />
                          {m.tipo === 'gasto' ? 'Convertir a ingreso' : 'Convertir a gasto'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {hasMore && (
                <div className="pt-6">
                  <button
                    onClick={() => loadMoreHistory()}
                    disabled={isHistoryLoading}
                    className="w-full py-5 rounded-3xl border-4 border-dashed border-slate-100 text-slate-400 font-black uppercase tracking-[0.2em] text-[10px] hover:border-sky-200 hover:text-sky-500 hover:bg-sky-50/30 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {isHistoryLoading ? 'Cargando...' : 'Cargar más movimientos'}
                  </button>
                </div>
              )}

              {!hasMore && history.length > 0 && (
                <div className="py-10 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300">Fin del historial</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Línea de Tiempo */}
      {isTimelineOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/90 backdrop-blur-xl" role="dialog" aria-modal="true">
          <div className="bg-white w-full sm:rounded-[3rem] shadow-2xl flex flex-col overflow-hidden border-4 border-white sm:max-w-5xl h-[92vh] sm:h-[88vh]">

            {/* Header */}
            <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center shadow-sm shadow-sky-500/10">
                  <BarChart2 size={24} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Línea de Tiempo</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Evolución del saldo</p>
                </div>
              </div>
              <button
                onClick={() => setIsTimelineOpen(false)}
                className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white border-2 border-slate-100 text-slate-400 hover:text-rose-500 hover:border-rose-100 transition-all active:scale-90 shadow-sm"
                aria-label="Cerrar"
              >
                <X size={24} />
              </button>
            </div>

            {/* Range selector */}
            <div className="px-6 sm:px-8 py-4 border-b border-slate-100 shrink-0">
              <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                {(['week', 'month', '3months', 'year', 'all'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setTimelineRange(r)}
                    className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                      timelineRange === r
                        ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/20'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {r === 'week' ? 'Última semana' : r === 'month' ? 'Último mes' : r === '3months' ? 'Últimos 3 meses' : r === 'year' ? 'Este año' : 'Todo'}
                  </button>
                ))}
              </div>
            </div>

            {/* Hucha toggles */}
            {huchas.length > 0 && (
              <div className="px-6 sm:px-8 py-3 flex gap-2 flex-wrap shrink-0 border-b border-slate-50">
                {huchas.map((h, i) => {
                  const color = TIMELINE_COLORS[i % TIMELINE_COLORS.length];
                  const hidden = hiddenHuchas.has(h.id);
                  return (
                    <button
                      key={h.id}
                      onClick={() => setHiddenHuchas(prev => {
                        const next = new Set(prev);
                        if (next.has(h.id)) next.delete(h.id);
                        else next.add(h.id);
                        return next;
                      })}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        hidden ? 'bg-slate-100 text-slate-400' : 'text-white shadow-lg'
                      }`}
                      style={hidden ? {} : { backgroundColor: color }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hidden ? '#94a3b8' : 'white' }} />
                      {h.nombre}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Chart area */}
            <div className="flex-1 p-4 sm:p-8 min-h-0">
              {timelineLoading ? (
                <div className="flex items-center justify-center h-full gap-4">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-100 border-t-sky-500" />
                  <p className="text-sm font-black uppercase tracking-widest text-slate-400">Cargando...</p>
                </div>
              ) : timelineChartData.length < 2 ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <BarChart2 className="text-slate-200" size={48} />
                  <p className="text-sm font-black uppercase tracking-widest text-slate-300">Sin datos suficientes</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineChartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      {huchas.map((h, i) => (
                        <linearGradient key={h.id} id={`tl-grad-${h.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={TIMELINE_COLORS[i % TIMELINE_COLORS.length]} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={TIMELINE_COLORS[i % TIMELINE_COLORS.length]} stopOpacity={0.05} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="dateLabel"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontWeight: 800, fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontWeight: 800, fontSize: 10 }}
                      width={44}
                      tickFormatter={(v: number) => {
                        if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
                        if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
                        return `${Math.round(v)}`;
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const pt = payload[0]?.payload;
                        return (
                          <div className="rounded-2xl bg-white shadow-2xl border border-slate-100 p-4 max-w-[220px]">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">{pt?.dateLabel}</p>
                            {payload.map((entry: any) => {
                              const h = huchas.find(h => h.id === entry.dataKey);
                              if (!h) return null;
                              return (
                                <div key={entry.dataKey} className="flex items-center justify-between gap-3 mb-1.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                                    <span className="text-[11px] font-bold text-slate-600 truncate">{h.nombre}</span>
                                  </div>
                                  <span className="text-[11px] font-black text-slate-900 tabular-nums shrink-0">{formatCurrency(entry.value ?? 0)}</span>
                                </div>
                              );
                            })}
                            <div className="border-t border-slate-100 mt-2 pt-2 flex items-center justify-between gap-3">
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</span>
                              <span className="text-sm font-black text-slate-900 tabular-nums">{formatCurrency(pt?.total ?? 0)}</span>
                            </div>
                            {pt?.lastMovement && (
                              <div className={`mt-3 p-3 rounded-xl ${pt.lastMovement.tipo === 'ingreso' ? 'bg-sky-50' : 'bg-orange-50'}`}>
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Último movimiento</p>
                                <p className="text-[11px] font-black text-slate-700 truncate">{pt.lastMovement.concepto}</p>
                                <p className={`text-sm font-black tabular-nums mt-1 ${pt.lastMovement.tipo === 'ingreso' ? 'text-sky-600' : 'text-orange-600'}`}>
                                  {pt.lastMovement.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(pt.lastMovement.importe)}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    {huchas
                      .filter(h => !hiddenHuchas.has(h.id))
                      .map((h, i) => (
                        <Area
                          key={h.id}
                          type="monotone"
                          dataKey={h.id}
                          stackId="1"
                          stroke={TIMELINE_COLORS[i % TIMELINE_COLORS.length]}
                          fill={`url(#tl-grad-${h.id})`}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 2 }}
                        />
                      ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Convertir movimiento (gasto <-> ingreso) */}
      {convertingMov && (() => {
        const mov = convertingMov;
        const isGastoToIngreso = mov.tipo === 'gasto';
        const amount = mov.importe;
        const { shares, error } = isGastoToIngreso
          ? computeConvertShares(convertRows, amount)
          : { shares: {} as Record<string, number>, error: null as string | null };
        const used = new Set(convertRows.map(r => r.huchaId));
        const canAddRow = isGastoToIngreso && huchas.some(h => !used.has(h.id));
        const totalAssigned = Object.values(shares).reduce((a, b) => a + b, 0);
        const canConfirm = isGastoToIngreso ? !error : !!convertTargetHuchaId;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-white animate-in fade-in zoom-in duration-300 max-h-[95vh] flex flex-col">
              <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/30 shrink-0">
                <div className="flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-2xl flex items-center justify-center shadow-sm ${isGastoToIngreso ? 'bg-sky-50 text-sky-600' : 'bg-orange-50 text-orange-600'}`}>
                    <ArrowRightLeft size={24} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none">
                      {isGastoToIngreso ? 'Convertir a ingreso' : 'Convertir a gasto'}
                    </h3>
                    <p className="text-xs font-bold text-slate-400 mt-1">
                      {mov.concepto} · <span className="tabular-nums">{formatCurrency(amount)}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeConvertModal}
                  className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                  aria-label="Cerrar modal"
                >
                  <X size={28} className="text-slate-400 hover:text-slate-900 transition-colors" />
                </button>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
                {isGastoToIngreso ? (
                  <>
                    <p className="text-xs font-bold text-slate-500 leading-relaxed">
                      Reparte los <span className="tabular-nums font-black text-slate-900">{formatCurrency(amount)}</span> entre las huchas que quieras. Puedes mezclar cantidades fijas (€), porcentajes (%) y dejar una hucha como «resto» para que reciba lo que sobre.
                    </p>

                    <div className="space-y-3">
                      {convertRows.map((row, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-3 rounded-2xl border-2 border-slate-100 bg-slate-50">
                          <select
                            className="flex-1 px-3 py-2 rounded-xl border-2 border-slate-100 bg-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500"
                            value={row.huchaId}
                            onChange={e => updateConvertRow(idx, { huchaId: e.target.value })}
                          >
                            {huchas.map(h => (
                              <option key={h.id} value={h.id}>{h.nombre}</option>
                            ))}
                          </select>
                          <select
                            className="px-3 py-2 rounded-xl border-2 border-slate-100 bg-white text-xs font-black uppercase tracking-wider focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500"
                            value={row.tipoAportacion}
                            onChange={e => updateConvertRow(idx, { tipoAportacion: e.target.value as ConvertRow['tipoAportacion'] })}
                          >
                            <option value="flat">€</option>
                            <option value="porcentaje">%</option>
                            <option value="resto">Resto</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={row.tipoAportacion === 'resto'}
                            className="w-24 px-3 py-2 rounded-xl border-2 border-slate-100 bg-white text-sm font-black tabular-nums text-right focus:outline-none focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-300"
                            value={row.tipoAportacion === 'resto' ? '' : row.valor}
                            onChange={e => updateConvertRow(idx, { valor: Number(e.target.value) })}
                            placeholder={row.tipoAportacion === 'resto' ? 'auto' : '0'}
                          />
                          <button
                            type="button"
                            onClick={() => removeConvertRow(idx)}
                            className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition-all"
                            aria-label="Quitar fila"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={!canAddRow}
                      onClick={addConvertRow}
                      className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 hover:text-sky-600 hover:border-sky-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <PlusCircle size={14} className="inline -mt-0.5 mr-2" />
                      Añadir hucha
                    </button>

                    <div className="rounded-2xl bg-slate-50 p-4 space-y-2">
                      <div className="flex justify-between text-xs font-black uppercase tracking-widest text-slate-400">
                        <span>Asignado</span>
                        <span className="tabular-nums text-slate-900">{formatCurrency(totalAssigned)} / {formatCurrency(amount)}</span>
                      </div>
                      {error ? (
                        <p className="text-xs font-bold text-red-500 flex items-center gap-2">
                          <AlertTriangle size={14} /> {error}
                        </p>
                      ) : (
                        <p className="text-xs font-bold text-emerald-600 flex items-center gap-2">
                          <CheckCircle2 size={14} /> Reparto válido
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-slate-500 leading-relaxed">
                      Elige la hucha que asume el gasto. <span className="text-amber-600">Aviso:</span> el ingreso original puede haberse repartido entre varias huchas. Esta operación sólo descuenta el gasto de la hucha elegida y actualiza el total; revisa los saldos manualmente si hace falta.
                    </p>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Hucha del gasto</label>
                      <select
                        className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all text-slate-900 font-bold"
                        value={convertTargetHuchaId}
                        onChange={e => setConvertTargetHuchaId(e.target.value)}
                      >
                        <option value="" disabled>Selecciona una hucha…</option>
                        {huchas.map(h => (
                          <option key={h.id} value={h.id}>{h.nombre}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="p-6 border-t border-slate-50 flex justify-end gap-3 bg-slate-50/30 shrink-0">
                <button
                  type="button"
                  onClick={closeConvertModal}
                  className="px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={handleConvertMovimiento}
                  className={`px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isGastoToIngreso ? 'bg-sky-600 hover:bg-sky-700' : 'bg-orange-600 hover:bg-orange-700'}`}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Vincular movimientos (compensación) */}
      {linkingMov && (() => {
        const mov = linkingMov;
        const isGasto = mov.tipo === 'gasto';
        const summary = linkSummary;
        const canConfirm = linkSelectedIds.size > 0 && !(summary && summary.exceso > 0.01);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
            <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-white animate-in fade-in zoom-in duration-300 max-h-[95vh] flex flex-col">
              <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/30 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl flex items-center justify-center shadow-sm bg-emerald-50 text-emerald-600">
                    <Undo2 size={24} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none">
                      {isGasto ? 'Compensar gasto' : 'Compensar gasto con este ingreso'}
                    </h3>
                    <p className="text-xs font-bold text-slate-400 mt-1">
                      {mov.concepto} · <span className="tabular-nums">{formatCurrency(mov.importe)}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeLinkModal}
                  className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                  aria-label="Cerrar modal"
                >
                  <X size={28} className="text-slate-400 hover:text-slate-900 transition-colors" />
                </button>
              </div>

              <div className="p-8 space-y-5 overflow-y-auto custom-scrollbar">
                <p className="text-xs font-bold text-slate-500 leading-relaxed">
                  {isGasto
                    ? 'Selecciona los ingresos (bizums, devoluciones…) que reembolsen parte de este gasto. El total compensado se descontará del coste real y de tus estadísticas.'
                    : 'Selecciona el gasto que este ingreso compensa. Solo se muestran gastos con importe disponible suficiente.'}
                </p>

                <input
                  type="text"
                  placeholder="Buscar por concepto…"
                  className="w-full px-5 py-3 rounded-2xl border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all text-sm font-bold"
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                />

                <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                  {linkCandidates.length === 0 ? (
                    <p className="text-xs font-bold text-slate-400 text-center py-8">
                      No hay {isGasto ? 'ingresos' : 'gastos'} compatibles.
                    </p>
                  ) : (
                    linkCandidates.map(c => {
                      const selected = linkSelectedIds.has(c.id);
                      const fecha = parseMovimientoDate(c.fecha_operacion);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleLinkCandidate(c.id)}
                          className={`w-full flex items-center justify-between gap-3 p-3 rounded-2xl border-2 transition-all text-left ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${c.tipo === 'ingreso' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                              {c.tipo === 'ingreso' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-slate-900 text-sm truncate">{c.concepto}</div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                {fecha ? fecha.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '—'}
                              </div>
                            </div>
                          </div>
                          <div className="font-black tabular-nums text-sm shrink-0">
                            {formatCurrency(c.importe)}
                          </div>
                          <div className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center ${selected ? 'bg-emerald-500 text-white' : 'border-2 border-slate-200'}`}>
                            {selected && <CheckCircle2 size={14} />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {summary && linkSelectedIds.size > 0 && (
                  <div className="rounded-2xl bg-slate-50 p-4 space-y-2 text-xs font-bold">
                    <div className="flex justify-between text-slate-500">
                      <span>Gasto</span>
                      <span className="tabular-nums text-slate-900 font-black">{formatCurrency(summary.gasto)}</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Compensado</span>
                      <span className="tabular-nums text-emerald-600 font-black">−{formatCurrency(summary.totalCompensado)}</span>
                    </div>
                    <div className="border-t border-slate-200 pt-2 flex justify-between">
                      <span className="text-slate-700 uppercase tracking-widest">Coste real</span>
                      <span className="tabular-nums text-slate-900 font-black text-base">{formatCurrency(summary.neto)}</span>
                    </div>
                    {summary.exceso > 0.01 && (
                      <p className="text-red-500 flex items-center gap-2 pt-2">
                        <AlertTriangle size={14} /> Excede el gasto en {formatCurrency(summary.exceso)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-50 flex justify-end gap-3 bg-slate-50/30 shrink-0">
                <button
                  type="button"
                  onClick={closeLinkModal}
                  className="px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-white transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={handleLinkMovimiento}
                  className="px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white bg-emerald-600 hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Vincular
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal Nueva / Editar Suscripción */}
      {isSuscripcionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md animate-appear-up" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-white animate-in fade-in zoom-in duration-300 max-h-[95vh] flex flex-col">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/30 shrink-0">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center shadow-sm">
                  <CreditCard size={24} />
                </div>
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight leading-none">
                  {editingSuscripcionId ? 'Editar' : 'Nueva Suscripción'}
                </h3>
              </div>
              <button
                onClick={closeSuscripcionModal}
                className="flex h-12 w-12 items-center justify-center hover:bg-white hover:shadow-md rounded-2xl transition-all focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                aria-label="Cerrar modal"
              >
                <X size={28} className="text-slate-400 hover:text-slate-900 transition-colors" />
              </button>
            </div>

            <form onSubmit={handleCreateOrUpdateSuscripcion} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
              {/* Nombre */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-nombre">Nombre del Servicio</label>
                <input
                  id="sus-nombre"
                  required
                  type="text"
                  placeholder="Ej: Netflix, Spotify..."
                  className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all text-slate-900 font-bold placeholder:text-slate-300"
                  value={newSuscripcion.nombre}
                  onChange={e => setNewSuscripcion({ ...newSuscripcion, nombre: e.target.value })}
                />
              </div>

              {/* Importe + Frecuencia */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-importe">Importe (€)</label>
                  <input
                    id="sus-importe"
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-black tabular-nums text-xl"
                    value={newSuscripcion.importe || ''}
                    onChange={e => setNewSuscripcion({ ...newSuscripcion, importe: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-frecuencia">Frecuencia</label>
                  <select
                    id="sus-frecuencia"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                    value={newSuscripcion.frecuencia}
                    onChange={e => setNewSuscripcion({ ...newSuscripcion, frecuencia: e.target.value as Suscripcion['frecuencia'] })}
                  >
                    {FRECUENCIA_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Compartida con otros */}
              <div className="rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 p-5 space-y-4">
                <button
                  type="button"
                  onClick={() => setNewSuscripcion({ ...newSuscripcion, compartida: !newSuscripcion.compartida })}
                  className="w-full flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    {newSuscripcion.compartida
                      ? <ToggleRight size={28} style={{ color: newSuscripcion.color }} />
                      : <ToggleLeft size={28} className="text-slate-400" />}
                    <div className="text-left">
                      <div className="font-black text-slate-900">Compartida con otros</div>
                      <div className="text-xs text-slate-500">
                        {newSuscripcion.compartida
                          ? 'Defines tu parte; el resto lo reembolsan otros'
                          : 'Pagas tú la suscripción completa'}
                      </div>
                    </div>
                  </div>
                </button>

                {newSuscripcion.compartida && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-mi-parte">Mi parte (€)</label>
                    <input
                      id="sus-mi-parte"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={newSuscripcion.importe || undefined}
                      placeholder="0.00"
                      className="w-full px-6 py-4 rounded-[1.25rem] border-2 border-slate-100 bg-white focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 transition-all font-black tabular-nums text-lg"
                      value={newSuscripcion.mi_parte || ''}
                      onChange={e => setNewSuscripcion({ ...newSuscripcion, mi_parte: Number(e.target.value) })}
                    />
                    {newSuscripcion.importe > 0 && newSuscripcion.mi_parte > 0 && newSuscripcion.mi_parte < newSuscripcion.importe && (
                      <div className="mt-3 text-xs text-slate-500 font-semibold">
                        Reembolsable por otros: <span className="text-slate-700 font-black tabular-nums">{formatCurrency(newSuscripcion.importe - newSuscripcion.mi_parte)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Día de cobro + Categoría */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-dia">
                    <Calendar size={10} className="inline mr-1" />
                    Día de cobro
                  </label>
                  <input
                    id="sus-dia"
                    required
                    type="number"
                    min="1"
                    max="28"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold tabular-nums"
                    value={newSuscripcion.dia_pago}
                    onChange={e => setNewSuscripcion({ ...newSuscripcion, dia_pago: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-categoria">Categoría</label>
                  <select
                    id="sus-categoria"
                    className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                    value={newSuscripcion.categoria}
                    onChange={e => setNewSuscripcion({ ...newSuscripcion, categoria: e.target.value })}
                  >
                    {CATEGORIA_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Color</label>
                <div className="flex flex-wrap gap-3">
                  {SUBSCRIPTION_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewSuscripcion({ ...newSuscripcion, color: c })}
                      className={`h-10 w-10 rounded-2xl transition-all active:scale-90 ${newSuscripcion.color === c ? 'ring-4 ring-offset-2 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c, boxShadow: newSuscripcion.color === c ? `0 0 0 4px ${c}40` : 'none' }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>

              {/* Preview mensual */}
              {newSuscripcion.importe > 0 && newSuscripcion.frecuencia !== 'mensual' && (
                <div className="rounded-[1.5rem] bg-slate-50 border-2 border-slate-100 p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-slate-500">
                    <RefreshCw size={16} />
                    <span className="text-[11px] font-black uppercase tracking-widest">
                      {newSuscripcion.compartida && newSuscripcion.mi_parte > 0 ? 'Tu parte equivale a' : 'Equivale a'}
                    </span>
                  </div>
                  <span className="text-lg font-black text-slate-900 tabular-nums">
                    {formatCurrency(
                      (newSuscripcion.compartida && newSuscripcion.mi_parte > 0 ? newSuscripcion.mi_parte : newSuscripcion.importe)
                      / (FRECUENCIA_OPTIONS.find(o => o.value === newSuscripcion.frecuencia)?.divisor ?? 1)
                    )}/mes
                  </span>
                </div>
              )}

              {/* Cartera de origen */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3" htmlFor="sus-hucha">Cartera de origen (Descontar de...)</label>
                <select
                  id="sus-hucha"
                  className="w-full px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-slate-50 focus:outline-none focus:ring-8 focus:ring-sky-500/5 focus:border-sky-500 focus:bg-white transition-all font-bold cursor-pointer appearance-none"
                  value={newSuscripcion.hucha_id || ''}
                  onChange={e => setNewSuscripcion({ ...newSuscripcion, hucha_id: e.target.value })}
                >
                  <option value="">Ninguna (Añadir al total)</option>
                  {huchas.filter(h => !h.es_suscripciones).map(h => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
                </select>
                <p className="mt-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest px-2">
                  Si eliges una cartera, el coste de la suscripción se restará de lo que le corresponde a esa cartera en cada ingreso.
                </p>
              </div>

              {/* Activa toggle */}
              <div className="flex items-center gap-5 p-5 rounded-[1.5rem] bg-slate-50 border-2 border-slate-100 transition-colors hover:bg-white hover:border-sky-100 group cursor-pointer"
                onClick={() => setNewSuscripcion({ ...newSuscripcion, activa: !newSuscripcion.activa })}
              >
                <div>
                  {newSuscripcion.activa
                    ? <ToggleRight size={32} style={{ color: newSuscripcion.color }} />
                    : <ToggleLeft size={32} className="text-slate-300" />
                  }
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">
                    {newSuscripcion.activa ? 'Activa' : 'Pausada'}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                    {newSuscripcion.activa ? 'Se incluye en el total mensual' : 'No afecta al total mensual'}
                  </p>
                </div>
              </div>

              <div className="pt-2 flex gap-6">
                <button
                  type="button"
                  onClick={closeSuscripcionModal}
                  className="flex-1 px-8 py-5 rounded-[1.5rem] border-2 border-slate-100 font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:bg-slate-50 active:scale-95 transition-all focus:outline-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-8 py-5 rounded-[1.5rem] bg-slate-900 text-white font-black uppercase tracking-[0.2em] text-[10px] hover:bg-slate-800 active:scale-95 transition-all shadow-[0_20px_50px_-15px_rgba(15,23,42,0.4)]"
                >
                  {editingSuscripcionId ? 'Guardar Cambios' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] animate-appear-up">
          <div className={`flex items-center gap-5 px-8 py-5 rounded-[2.5rem] shadow-[0_30px_80px_-15px_rgba(0,0,0,0.4)] border-4 border-white/10 backdrop-blur-xl ${
            toast.type === 'success' 
              ? 'bg-emerald-950/95 text-emerald-50' 
              : 'bg-rose-950/95 text-rose-50'
          }`}>
            <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shadow-inner ${toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              {toast.type === 'success' ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
            </div>
            <p className="text-xs font-black uppercase tracking-[0.2em]">{toast.message}</p>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-lg animate-fade-in" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[3.5rem] shadow-2xl w-full max-w-sm overflow-hidden border-4 border-white animate-in fade-in zoom-in duration-300">
            <div className="p-10 text-center">
              <div className="mx-auto w-20 h-20 rounded-[2rem] bg-amber-50 flex items-center justify-center mb-8 text-amber-600 shadow-inner">
                <AlertTriangle size={40} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 mb-4 uppercase tracking-tight leading-none">{confirmModal.title}</h3>
              <p className="text-sm font-bold text-slate-400 leading-relaxed px-4">{confirmModal.message}</p>
            </div>
            <div className="p-8 bg-slate-50/50 flex gap-4">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 px-6 py-5 rounded-[1.5rem] border-2 border-slate-100 bg-white font-black uppercase tracking-[0.2em] text-[10px] text-slate-400 hover:bg-white hover:border-slate-300 active:scale-95 transition-all shadow-sm"
              >
                Volver
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 px-6 py-5 rounded-[1.5rem] bg-slate-900 text-white font-black uppercase tracking-[0.2em] text-[10px] hover:bg-slate-800 active:scale-95 transition-all shadow-xl shadow-slate-900/30"
              >
                {confirmModal.confirmLabel ?? 'Borrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

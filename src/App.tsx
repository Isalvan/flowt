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
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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
} from 'lucide-react';
import { auth, db } from './firebase';

interface Movimiento {
  id: string;
  tipo: 'gasto' | 'ingreso';
  concepto: string;
  importe: number;
  fecha_operacion: any;
  hucha_id?: string;
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
}

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

const formatCurrency = (value: number) =>
  value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

const formatDate = (dateValue: any) => {
  const value = dateValue?.toDate?.();
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toLocaleDateString('es-ES')
    : '---';
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [huchas, setHuchas] = useState<Hucha[]>([]);
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

  // UI Feedback State
  const [toast, setToast] = useState<{message: string, type: 'error' | 'success'} | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    if (!import.meta.env.VITE_FIREBASE_API_KEY) {
      setIsFirebaseConfigured(false);
      setMovimientos(MOCK_MOVIMIENTOS);
      setHuchas(MOCK_HUCHAS);
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
      limit(20),
    );

    const unsubMov = onSnapshot(qMov, (snapshot) => {
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Movimiento));
      setMovimientos(docs);
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

    return () => {
      unsubMov();
      unsubHuchas();
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
      if (editingId) {
        await updateDoc(doc(db, 'huchas', editingId), huchaData);
      } else {
        await addDoc(collection(db, 'huchas'), {
          ...huchaData,
          saldo_acumulado: 0,
          orden: huchas.length + 1,
          created_at: serverTimestamp()
        });
      }
      closeModal();
      showToast(editingId ? "Cartera actualizada" : "Cartera creada", "success");
    } catch (error) {
      console.error("Error al procesar hucha:", error);
      showToast("Error al procesar la hucha. Revisa la consola.");
    }
  };

  const handleDeleteHucha = async (hucha: Hucha) => {
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

  const totalIngresos = useMemo(
    () => movimientos.filter((m) => m.tipo === 'ingreso').reduce((acc, m) => acc + m.importe, 0),
    [movimientos],
  );

  const totalGastos = useMemo(
    () => movimientos.filter((m) => m.tipo === 'gasto').reduce((acc, m) => acc + m.importe, 0),
    [movimientos],
  );

  const balance = totalIngresos - totalGastos;

  const chartData = useMemo(() => {
    const months: Record<string, { name: string; ingresos: number; gastos: number }> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const name = d.toLocaleDateString('es-ES', { month: 'short' });
      months[key] = { name, ingresos: 0, gastos: 0 };
    }
    movimientos.forEach((m) => {
      const date = m.fecha_operacion?.toDate?.() || new Date();
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (months[key]) {
        if (m.tipo === 'ingreso') months[key].ingresos += m.importe;
        else months[key].gastos += m.importe;
      }
    });
    return Object.values(months);
  }, [movimientos]);

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
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
        {!isFirebaseConfigured && (
          <div className="mb-8 flex items-center gap-4 rounded-3xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm animate-appear-up">
            <AlertTriangle className="text-amber-500 shrink-0" size={24} />
            <p className="text-sm font-bold text-amber-900 leading-tight">
              <span className="font-black uppercase tracking-widest text-[10px] block mb-0.5">Modo Demo</span> 
              Firebase no está configurado. Los datos mostrados son de ejemplo.
            </p>
          </div>
        )}

        <section className="animate-appear-up rounded-[2.5rem] border border-white bg-white/80 p-6 shadow-2xl shadow-slate-900/5 backdrop-blur-xl sm:p-10 transition-all hover:shadow-slate-900/10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
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

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <article className="rounded-3xl border border-white bg-white/50 p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">Balance</p>
                  <p className={`mt-2 text-2xl font-black tabular-nums ${balance >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                    {formatCurrency(balance)}
                  </p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group border-b-sky-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-sky-600 transition-colors">Ingresos</p>
                  <p className="mt-2 text-2xl font-black text-sky-600 tabular-nums">+{formatCurrency(totalIngresos)}</p>
                </article>
                <article className="rounded-3xl border border-white bg-white/50 p-6 shadow-sm transition-all hover:shadow-xl hover:scale-[1.03] active:scale-95 group border-b-orange-200">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-orange-600 transition-colors">Gastos</p>
                  <p className="mt-2 text-2xl font-black text-orange-600 tabular-nums">-{formatCurrency(totalGastos)}</p>
                </article>
              </div>
            </div>

            <div className="rounded-[2rem] border-4 border-white bg-slate-900 p-8 text-white shadow-[0_25px_60px_-15px_rgba(15,23,42,0.4)] transition-transform hover:scale-[1.02]">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Saldo Consolidado</p>
              <p className="mt-3 font-title text-5xl font-black tabular-nums tracking-tighter leading-none">{formatCurrency(balance)}</p>

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
            <h3 className="section-title text-slate-900 font-black uppercase tracking-widest text-[11px] mb-8">Evolución Semestral</h3>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
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
              <button className="h-10 px-5 rounded-2xl bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-200 hover:text-slate-900 active:scale-95 focus:outline-none focus:ring-4 focus:ring-slate-100">
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
                        <p className="text-sm font-black text-slate-900 tracking-tight">{m.concepto}</p>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{formatDate(m.fecha_operacion)}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <p className={`text-base font-black tabular-nums ${m.tipo === 'ingreso' ? 'text-sky-700' : 'text-orange-700'}`}>
                        {m.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(m.importe)}
                      </p>
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

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
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
                        <h4 className="font-black text-slate-900 text-xl leading-tight tracking-tight uppercase">{h.nombre}</h4>
                        <span className="mt-2 inline-block rounded-xl bg-slate-900 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-slate-900/20">
                          {allocationLabel}
                        </span>
                      </div>
                      
                      <div className="flex gap-2 opacity-0 transition-all group-hover:opacity-100 translate-y-2 group-hover:translate-y-0">
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
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

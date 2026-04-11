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
    } catch (error) {
      console.error("Error al procesar hucha:", error);
      alert("Error al procesar hucha. Revisa la consola.");
    }
  };

  const handleDeleteHucha = async (id: string) => {
    if (huchas.length === 1) {
      alert('No puedes eliminar tu única cartera. Crea otra primero.');
      return;
    }
    if (!confirm('¿Estás seguro de que quieres eliminar esta cartera?')) return;
    try {
      await deleteDoc(doc(db, 'huchas', id));
    } catch (error) {
      console.error("Error al eliminar hucha:", error);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !transferData.fromHuchaId || !transferData.toHuchaId || transferData.amount <= 0) return;
    if (transferData.fromHuchaId === transferData.toHuchaId) {
      alert('Debes seleccionar carteras distintas.');
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
    } catch (error: any) {
      console.error("Error en la transferencia:", error);
      alert(error.message || "Error al transferir fondos.");
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
    } catch (error) {
      console.error("Error cambiando hucha del movimiento:", error);
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
    
    // Initialize last 6 months
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
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="glass-panel flex items-center gap-4 rounded-2xl px-6 py-5 shadow-xl animate-appear-up">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
          <p className="text-sm font-semibold text-slate-700">Cargando tu panel financiero...</p>
        </div>
      </div>
    );
  }

  if (!user && isFirebaseConfigured) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div className="bg-orb-left" aria-hidden="true" />
        <div className="bg-orb-right" aria-hidden="true" />

        <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/60 bg-white/75 shadow-[0_24px_80px_-30px_rgba(2,6,23,0.55)] backdrop-blur-2xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative p-7 sm:p-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              <Sparkles size={14} />
              Automatizacion bancaria inteligente
            </span>

            <h1 className="mt-5 max-w-lg font-title text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
              Tus finanzas, con una imagen profesional y control real.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">
              Flowt organiza automaticamente tus movimientos, detecta tendencias y te muestra en segundos donde puedes mejorar.
            </p>

            <div className="mt-8 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              <article className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Seguridad</p>
                <p className="mt-2 font-semibold">Google Auth + Firebase</p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Analitica</p>
                <p className="mt-2 font-semibold">Resumen visual inmediato</p>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Objetivos</p>
                <p className="mt-2 font-semibold">Huchas con progreso</p>
              </article>
            </div>
          </section>

          <aside className="relative flex flex-col justify-center border-t border-slate-200/70 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-900 p-7 text-white sm:p-10 lg:border-l lg:border-t-0">
            <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <Wallet size={28} className="text-sky-200" />
            </div>
            <p className="text-sm font-medium text-slate-200">Acceso seguro a tu dashboard</p>
            <h2 className="mt-2 font-title text-3xl font-bold">Bienvenido a Flowt</h2>

            <button
              onClick={handleLogin}
              className="btn-primary mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white"
            >
              <LogIn size={19} />
              Entrar con Google
            </button>

            <p className="mt-4 text-xs text-slate-300">Solo necesitas un clic para acceder a tus datos.</p>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden pb-12">
      <div className="bg-orb-left" aria-hidden="true" />
      <div className="bg-orb-right" aria-hidden="true" />

      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
              <Wallet size={22} />
            </div>
            <div>
              <p className="font-title text-xl font-bold text-slate-900">Flowt</p>
              <p className="text-xs font-medium text-slate-500">Centro financiero personal</p>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-2 shadow-sm sm:gap-3 sm:px-3">
              <img
                src={user.photoURL || ''}
                alt="Perfil"
                className="h-9 w-9 rounded-full border border-slate-200 object-cover"
              />
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-slate-800">{user.displayName || 'Usuario'}</p>
                <p className="text-xs text-slate-500">Sesion activa</p>
              </div>
              <button
                onClick={handleLogout}
                className="btn-icon inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500"
                aria-label="Cerrar sesion"
              >
                <LogOut size={18} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6">
        {!isFirebaseConfigured && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50/85 px-4 py-3 text-sm text-amber-900">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <p>
              <span className="font-semibold">Modo Demo:</span> Firebase no esta configurado, asi que estamos mostrando datos de ejemplo.
            </p>
          </div>
        )}

        <section className="animate-appear-up rounded-3xl border border-white/70 bg-white/80 p-5 shadow-xl shadow-slate-900/5 backdrop-blur-xl sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <ReceiptText size={14} />
                Vista general
              </p>
              <h2 className="mt-4 font-title text-3xl font-bold text-slate-900 sm:text-4xl">
                Balance de este mes
              </h2>
              <p className="mt-2 text-sm text-slate-600 sm:text-base">
                Tu situacion actual de ingresos y gastos en tiempo real.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <article className="metric-card">
                  <p className="metric-label">Balance</p>
                  <p className={`metric-value ${balance >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                    {formatCurrency(balance)}
                  </p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">Ingresos</p>
                  <p className="metric-value text-sky-600">+{formatCurrency(totalIngresos)}</p>
                </article>
                <article className="metric-card">
                  <p className="metric-label">Gastos</p>
                  <p className="metric-value text-orange-600">-{formatCurrency(totalGastos)}</p>
                </article>
              </div>
            </div>

            <div className="rounded-2xl border border-white/25 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-900 p-6 text-white shadow-xl shadow-slate-900/30">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Saldo actual</p>
              <p className="mt-2 font-title text-4xl font-bold">{formatCurrency(balance)}</p>

              <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/20">
                  <p className="text-slate-300">Entradas</p>
                  <p className="mt-1 flex items-center gap-1 font-semibold text-sky-200">
                    <TrendingUp size={16} />
                    {formatCurrency(totalIngresos)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/10 p-3 ring-1 ring-white/20">
                  <p className="text-slate-300">Salidas</p>
                  <p className="mt-1 flex items-center gap-1 font-semibold text-orange-200">
                    <TrendingDown size={16} />
                    {formatCurrency(totalGastos)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <article className="glass-panel rounded-3xl p-5 shadow-lg sm:p-6">
            <h3 className="section-title">Resumen mensual</h3>
            <div className="mt-4 h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontWeight: 600 }} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{
                      borderRadius: '14px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 14px 36px -18px rgba(2, 6, 23, 0.45)',
                    }}
                    formatter={(value) => formatCurrency(Number(value))}
                  />
                  <Bar dataKey="ingresos" fill="#0ea5e9" radius={[6, 6, 0, 0]} barSize={24} />
                  <Bar dataKey="gastos" fill="#f97316" radius={[6, 6, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="glass-panel rounded-3xl p-5 shadow-lg sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="section-title">Ultimos movimientos</h3>
              <button className="btn-secondary rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                Ver todos
              </button>
            </div>

            <div className="space-y-3">
              {movimientos.length > 0 ? (
                movimientos.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/75 px-3 py-3 transition hover:border-slate-300 hover:bg-white"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-xl p-2.5 ${
                          m.tipo === 'ingreso'
                            ? 'bg-sky-50 text-sky-600 ring-1 ring-sky-100'
                            : 'bg-orange-50 text-orange-600 ring-1 ring-orange-100'
                        }`}
                      >
                        {m.tipo === 'ingreso' ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{m.concepto}</p>
                        <p className="text-xs text-slate-500">{formatDate(m.fecha_operacion)}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <p className={`text-sm font-bold ${m.tipo === 'ingreso' ? 'text-sky-700' : 'text-orange-700'}`}>
                        {m.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(m.importe)}
                      </p>
                      {m.tipo === 'gasto' && huchas.length > 0 && (
                        <select
                          className="text-[10px] font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded px-1.5 py-0.5 w-full max-w-[120px] focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                          value={m.hucha_id || ''}
                          onChange={(e) => handleChangeMovimientoHucha(m, e.target.value)}
                        >
                          <option value="" disabled>Asignar hucha...</option>
                          {huchas.map(h => (
                            <option key={h.id} value={h.id}>{h.nombre}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
                  Todavia no hay movimientos para mostrar.
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="mt-6 glass-panel rounded-3xl p-5 shadow-lg sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PiggyBank className="text-sky-600" size={22} />
              <h3 className="section-title">Mis huchas</h3>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsTransferModalOpen(true)}
                disabled={huchas.length < 2}
                className="btn-secondary inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRightLeft size={15} />
                Transferir
              </button>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="btn-dark inline-flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <PlusCircle size={15} />
                Nueva hucha
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {huchas.length > 0 ? (
              huchas.map((h) => {
                const progress = h.objetivo ? Math.min((h.saldo_acumulado / h.objetivo) * 100, 100) : 0;
                
                // Info for the badge
                const allocationLabel = h.tipo_aportacion === 'porcentaje' 
                  ? `${h.valor_aportacion}%` 
                  : h.tipo_aportacion === 'flat' 
                    ? `${h.valor_aportacion}€` 
                    : 'Resto';

                return (
                  <article
                    key={h.id}
                    className="group relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-slate-900">{h.nombre}</h4>
                        <span className="mt-1 inline-block rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700 ring-1 ring-sky-100">
                          {allocationLabel}
                        </span>
                      </div>
                      
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button 
                          onClick={() => openEditModal(h)}
                          className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                          title="Editar hucha"
                        >
                          <Edit size={14} />
                        </button>
                        <button 
                          onClick={() => handleDeleteHucha(h.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Eliminar hucha"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <p className="text-2xl font-bold text-slate-900">{formatCurrency(h.saldo_acumulado)}</p>
                    {h.objetivo && <p className="mt-1 text-sm text-slate-500">Objetivo: {formatCurrency(h.objetivo)}</p>}

                    {h.objetivo && (
                      <div className="mt-4">
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-right text-xs font-semibold text-slate-600">{Math.round(progress)}%</p>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white/70 p-10 text-center md:col-span-2 xl:col-span-3">
                <PiggyBank className="mx-auto mb-3 text-slate-300" size={36} />
                <p className="text-sm text-slate-500">Aun no has creado ninguna hucha.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Modal Nueva Hucha */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-appear-up">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">
                {editingId ? 'Editar Cartera' : 'Crear Nueva Hucha'}
              </h3>
              <button 
                onClick={closeModal}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleCreateOrUpdateHucha} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre de la hucha</label>
                <input
                  required
                  type="text"
                  placeholder="Ej: Viaje a Japon"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={newHucha.nombre}
                  onChange={(e) => setNewHucha({...newHucha, nombre: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Tipo de aportacion</label>
                <select
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={newHucha.tipo_aportacion}
                  onChange={(e) => setNewHucha({...newHucha, tipo_aportacion: e.target.value as any})}
                >
                  <option value="porcentaje">Porcentaje (%)</option>
                  <option value="flat">Importe Fijo (€)</option>
                  <option value="resto">Resto (Remanente)</option>
                </select>
              </div>

              {newHucha.tipo_aportacion !== 'resto' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {newHucha.tipo_aportacion === 'porcentaje' ? 'Porcentaje (%)' : 'Importe (€)'}
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step={newHucha.tipo_aportacion === 'porcentaje' ? "1" : "0.01"}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                    value={newHucha.valor_aportacion}
                    onChange={(e) => setNewHucha({...newHucha, valor_aportacion: Number(e.target.value)})}
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Objetivo (opcional)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Ej: 2000"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={newHucha.objetivo}
                  onChange={(e) => setNewHucha({...newHucha, objetivo: Number(e.target.value)})}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="es_principal"
                  className="w-5 h-5 rounded border-slate-300 text-sky-500 focus:ring-sky-500"
                  checked={newHucha.es_principal}
                  onChange={(e) => setNewHucha({...newHucha, es_principal: e.target.checked})}
                />
                <label htmlFor="es_principal" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Marcar como hucha principal
                </label>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition shadow-lg shadow-slate-900/20"
                >
                  {editingId ? 'Guardar Cambios' : 'Crear Hucha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Transferir */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-appear-up">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Transferir Fondos</h3>
              <button 
                onClick={() => {
                  setIsTransferModalOpen(false);
                  setTransferData({ fromHuchaId: '', toHuchaId: '', amount: 0 });
                }}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleTransfer} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Origen (Sale de)</label>
                <select
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={transferData.fromHuchaId}
                  onChange={(e) => setTransferData({...transferData, fromHuchaId: e.target.value})}
                >
                  <option value="" disabled>Selecciona la cartera origen</option>
                  {huchas.map(h => (
                    <option key={h.id} value={h.id} disabled={h.saldo_acumulado <= 0}>
                      {h.nombre} ({formatCurrency(h.saldo_acumulado)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Destino (Entra en)</label>
                <select
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={transferData.toHuchaId}
                  onChange={(e) => setTransferData({...transferData, toHuchaId: e.target.value})}
                >
                  <option value="" disabled>Selecciona la cartera destino</option>
                  {huchas.map(h => (
                    <option key={h.id} value={h.id} disabled={h.id === transferData.fromHuchaId}>
                      {h.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Importe a transferir (€)</label>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Ej: 50.00"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition"
                  value={transferData.amount || ''}
                  onChange={(e) => setTransferData({...transferData, amount: Number(e.target.value)})}
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsTransferModalOpen(false);
                    setTransferData({ fromHuchaId: '', toHuchaId: '', amount: 0 });
                  }}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!transferData.fromHuchaId || !transferData.toHuchaId || transferData.amount <= 0 || transferData.fromHuchaId === transferData.toHuchaId}
                  className="flex-1 px-4 py-3 rounded-xl bg-sky-600 text-white font-semibold hover:bg-sky-700 transition shadow-lg shadow-sky-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Transferir
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

import React, { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { collection, query, where, orderBy, limit, startAfter, getDocs, type DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useTheme } from './hooks/useTheme';
import { useFinanceData } from './hooks/useFinanceData';
import { type Hucha, type Suscripcion, type Movimiento } from './types';

// Tab subviews
import { DashboardView } from './components/dashboard/DashboardView';
import { SuscripcionesView } from './components/suscripciones/SuscripcionesView';
import { CalendarioView } from './components/calendario/CalendarioView';
import { ManualReviewView } from './components/manual/ManualReviewView';

// Modals
import { HuchaModal } from './components/modals/HuchaModal';
import { TransferModal } from './components/modals/TransferModal';
import { DeleteHuchaModal } from './components/modals/DeleteHuchaModal';
import { ConvertModal } from './components/modals/ConvertModal';
import { LinkModal } from './components/modals/LinkModal';
import { SuscripcionModal } from './components/modals/SuscripcionModal';
import { HistoryModal } from './components/modals/HistoryModal';
// Demo, Feedback, and Premium Visuals
import { DemoSimulator } from './components/demo/DemoSimulator';
import { Toast } from './components/common/Toast';
import { ConfirmModal } from './components/common/ConfirmModal';
import { DashboardSkeleton } from './components/dashboard/DashboardSkeleton';
import { ShortcutsHelpModal } from './components/common/ShortcutsHelpModal';
import { CelebrationConfetti } from './components/common/CelebrationConfetti';

// Icons
import { 
  LogOut, 
  Sun, 
  Moon, 
  TrendingUp, 
  Layers, 
  CalendarDays, 
  Key, 
  Sparkles,
  ShieldAlert,
  Mail,
  Eye,
  EyeOff
} from 'lucide-react';
import { PrivacyProvider, usePrivacy } from './context/PrivacyContext';
import { PinModal } from './components/common/PinModal';

const FlowtLogoSVG: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    className="overflow-visible pointer-events-none"
  >
    <style>{`
      @keyframes logo-coin-drop {
        0%, 100% { transform: translateY(-2px); }
        50% { transform: translateY(1.5px); }
      }
      .anim-logo-coin {
        animation: logo-coin-drop 2.5s ease-in-out infinite;
        transform-origin: 14px 4px;
      }
    `}</style>
    
    <defs>
      <linearGradient id="piggyStroke" x1="5" y1="5" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#38bdf8" />
      </linearGradient>
      <linearGradient id="logoGold" x1="12" y1="2" x2="16" y2="6" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    
    {/* Tail */}
    <path 
      d="M20.5 13c1-.6 1.8-.4 1.8.3s-.8 1.2-1.8.3" 
      fill="none" 
      stroke="url(#piggyStroke)" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
    />
    
    {/* Snout */}
    <path 
      d="M6.5 13H5.5a0.8 0 0 0-0.8 0.8v1.4a0.8 0 0 0 0.8 0.8h1" 
      fill="none" 
      stroke="url(#piggyStroke)" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
    />
    
    {/* Ears */}
    <path 
      d="M10 7.5l-1.5-2.2A0.8 0 0 0 7.8 5c-.4 0-.8.4-.8.8v1.7" 
      fill="none" 
      stroke="url(#piggyStroke)" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
    />
    
    {/* Main Body */}
    <path 
      d="M20.5 14A6.5 6.5 0 0 0 14 7.5h-1A6.5 6.5 0 0 0 6.5 14c0 2 1 3.8 2.5 5v1.8a1 1 0 0 0 2 0v-.8h5v.8a1 1 0 0 0 2 0V19c1.5-1.2 2.5-3 2.5-5z" 
      fill="none" 
      stroke="url(#piggyStroke)" 
      strokeWidth="1.5" 
      strokeLinejoin="round"
    />
    
    {/* Slot */}
    <line 
      x1="12" 
      y1="7.5" 
      x2="16" 
      y2="7.5" 
      stroke="url(#piggyStroke)" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
    />
    
    {/* Eye */}
    <circle cx="10" cy="11.5" r="0.75" fill="#6366f1" />

    {/* Gold Coin sliding in with bounce */}
    <circle 
      cx="14" 
      cy="4" 
      r="2.2" 
      fill="url(#logoGold)" 
      stroke="#d97706" 
      strokeWidth="0.5" 
      className="anim-logo-coin" 
      style={{ filter: 'drop-shadow(0px 1px 2px rgba(217,119,6,0.3))' }}
    />
  </svg>
);


const AppContent: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { isLocked, lock, openUnlockModal, hasPin, openCreateModal } = usePrivacy();

  // Demo mode can be forced from the login screen even when Firebase is configured
  const [forceDemo, setForceDemo] = useState(false);
  
  const {
    user,
    loading,
    isFirebaseConfigured,
    movimientos,
    chartMovements,
    huchas,
    suscripciones,
    pendingEmails,
    totalIngresos,
    totalGastos,
    balance,
    totalMensualSuscripciones,
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
    injectDemoMovement,
  } = useFinanceData(forceDemo);

  // Tab switching state
  const [activeTab, setActiveTab] = useState<'dashboard' | 'suscripciones' | 'calendario' | 'manual'>('dashboard');

  // Form modals state overlays
  const [isHuchaModalOpen, setIsHuchaModalOpen] = useState(false);
  const [editingHucha, setEditingHucha] = useState<Hucha | null>(null);
  
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  
  const [isDeleteHuchaModalOpen, setIsDeleteHuchaModalOpen] = useState(false);
  const [huchaToDelete, setHuchaToDelete] = useState<Hucha | null>(null);
  
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [movimientoToConvert, setMovimientoToConvert] = useState<Movimiento | null>(null);
  
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [movimientoToLink, setMovimientoToLink] = useState<Movimiento | null>(null);
  
  const [isSuscripcionModalOpen, setIsSuscripcionModalOpen] = useState(false);
  const [editingSuscripcion, setEditingSuscripcion] = useState<Suscripcion | null>(null);
  
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  // Symmetrical paging driver state
  const [historyMovements, setHistoryMovements] = useState<Movimiento[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<DocumentSnapshot | null>(null);
  const [demoOffset, setDemoOffset] = useState(15);

  // Reset pagination
  const initHistoryPagination = useCallback(async () => {
    setHistoryLoading(true);
    if (isFirebaseConfigured && user) {
      try {
        const q = query(
          collection(db, 'movimientos'),
          where('id_propietario', '==', user.uid),
          orderBy('fecha_operacion', 'desc'),
          limit(15)
        );
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento));
        setHistoryMovements(docs);
        setLastVisibleDoc(snap.docs[snap.docs.length - 1] || null);
        setHistoryHasMore(docs.length === 15);
      } catch (err) {
        console.error('Error loading history:', err);
        showToast('Error al cargar historial.');
      }
    } else {
      // Demo Mode slicer
      const slice = chartMovements.slice(0, 15);
      setHistoryMovements(slice);
      setDemoOffset(15);
      setHistoryHasMore(chartMovements.length > 15);
    }
    setHistoryLoading(false);
  }, [user, isFirebaseConfigured, chartMovements]);

  // Load more documents
  const handleLoadMoreHistory = useCallback(async () => {
    if (historyLoading) return;
    setHistoryLoading(true);

    if (isFirebaseConfigured && user) {
      if (!lastVisibleDoc) {
        setHistoryHasMore(false);
        setHistoryLoading(false);
        return;
      }
      try {
        const q = query(
          collection(db, 'movimientos'),
          where('id_propietario', '==', user.uid),
          orderBy('fecha_operacion', 'desc'),
          startAfter(lastVisibleDoc),
          limit(15)
        );
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento));
        if (docs.length > 0) {
          setHistoryMovements(prev => [...prev, ...docs]);
          setLastVisibleDoc(snap.docs[snap.docs.length - 1] || null);
        }
        setHistoryHasMore(docs.length === 15);
      } catch (err) {
        console.error('Error loading more history:', err);
        showToast('Error al cargar más historial.');
      }
    } else {
      // Demo Mode delay simulation
      await new Promise(resolve => setTimeout(resolve, 300));
      const nextOffset = demoOffset + 15;
      const slice = chartMovements.slice(0, nextOffset);
      setHistoryMovements(slice);
      setDemoOffset(nextOffset);
      setHistoryHasMore(chartMovements.length > nextOffset);
    }
    setHistoryLoading(false);
  }, [user, isFirebaseConfigured, lastVisibleDoc, demoOffset, chartMovements, historyLoading]);

  // Launch pagination init when modal opens
  useEffect(() => {
    if (isHistoryModalOpen) {
      initHistoryPagination();
    }
  }, [isHistoryModalOpen]);

  // Update history items live if local updates happen in Demo Mode
  useEffect(() => {
    if (isHistoryModalOpen && !isFirebaseConfigured) {
      setHistoryMovements(chartMovements.slice(0, demoOffset));
    }
  }, [chartMovements, isHistoryModalOpen, isFirebaseConfigured, demoOffset]);

  // Google authentication actions
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      showToast('Sesión iniciada correctamente', 'success');
    } catch (error) {
      console.error('Login failed:', error);
      showToast('Error al iniciar sesión con Google.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast('Sesión cerrada', 'success');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };
  const secureAction = (action: () => void) => {
    if (isLocked) {
      if (hasPin) {
        openUnlockModal((success) => {
          if (success) action();
        });
      } else {
        openCreateModal();
      }
    } else {
      action();
    }
  };

  const handlePrivacyToggle = () => {
    if (isLocked) {
      if (hasPin) {
        openUnlockModal();
      } else {
        openCreateModal();
      }
    } else {
      lock();
    }
  };

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toUpperCase();
      
      if (key === 'N') {
        e.preventDefault();
        handleOpenHuchaModal(null);
      } else if (key === 'T') {
        e.preventDefault();
        secureAction(() => setIsTransferModalOpen(true));
      } else if (key === 'H') {
        e.preventDefault();
        secureAction(() => setIsHistoryModalOpen(true));
      } else if (key === 'P') {
        e.preventDefault();
        handlePrivacyToggle();
      } else if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsHelpOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, hasPin, isShortcutsHelpOpen]);

  // Form wrappers
  const handleOpenHuchaModal = (hucha: Hucha | null) => {
    secureAction(() => {
      setEditingHucha(hucha);
      setIsHuchaModalOpen(true);
    });
  };

  const handleOpenDeleteHuchaModal = (hucha: Hucha) => {
    secureAction(() => {
      if (hucha.saldo_acumulado <= 0) {
        handleDeleteHucha(hucha);
      } else {
        setHuchaToDelete(hucha);
        setIsDeleteHuchaModalOpen(true);
      }
    });
  };

  const handleOpenConvertModal = (mov: Movimiento) => {
    secureAction(() => {
      setMovimientoToConvert(mov);
      setIsConvertModalOpen(true);
    });
  };

  const handleOpenLinkModal = (mov: Movimiento) => {
    secureAction(() => {
      setMovimientoToLink(mov);
      setIsLinkModalOpen(true);
    });
  };

  const handleOpenSuscripcionModal = (sub: Suscripcion | null) => {
    secureAction(() => {
      setEditingSuscripcion(sub);
      setIsSuscripcionModalOpen(true);
    });
  };
  // Safe wrapper for conversion
  const onSafeConvert = async (mov: Movimiento, rows?: any[], targetHuchaId?: string) => {
    await handleConvertMovimiento(mov, rows, targetHuchaId);
  };

  // Safe wrapper for hucha creation/updates with success celebration interceptor
  const onSaveHucha = async (newHucha: Omit<Hucha, 'id' | 'saldo_acumulado' | 'orden'>, editingId: string | null) => {
    await handleCreateOrUpdateHucha(newHucha, editingId);
    if (newHucha.objetivo && newHucha.objetivo > 0) {
      if (editingId) {
        const existing = huchas.find(h => h.id === editingId);
        // Celebrating 100% savings goal accomplishment!
        if (existing && existing.saldo_acumulado >= newHucha.objetivo) {
          setConfettiTrigger(prev => prev + 1);
        }
      }
    }
  };

  // Safe wrapper for transfer with success celebration interceptor
  const onSafeTransfer = async (fromId: string, toId: string, amount: number) => {
    await handleTransfer(fromId, toId, amount);
    const target = huchas.find(h => h.id === toId);
    if (target && target.objetivo && target.objetivo > 0) {
      const futureSaldo = target.saldo_acumulado + amount;
      if (futureSaldo >= target.objetivo && target.saldo_acumulado < target.objetivo) {
        setTimeout(() => {
          setConfettiTrigger(prev => prev + 1);
        }, 300);
      }
    }
  };

  // Safe wrapper for manual approval with success celebration interceptor
  const onApproveEmail = async (
    emailId: string, 
    movData: { tipo: 'ingreso' | 'gasto', concepto: string, importe: number, fecha_operacion: string, hucha_id?: string }
  ) => {
    await handleApprovePendingEmail(emailId, movData);
    setConfettiTrigger(prev => prev + 1);
  };

  // Rendering loading state
  if (loading) {
    return <DashboardSkeleton />;
  }

  // Rendering signed out view when firebase is active
  if (isFirebaseConfigured && !user) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-6 bg-slate-950 overflow-hidden font-sans">
        {/* Decorative glassmorphic ambient circles */}
        <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-blue-600/10 blur-[80px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-600/10 blur-[100px] pointer-events-none" />

        <div className="w-full max-w-md backdrop-blur-md bg-white/5 border border-white/10 rounded-[32px] p-8 sm:p-10 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
          {/* Glowing Brand Icon */}
          <div className="mb-6 flex items-center justify-center">
            <FlowtLogoSVG size={64} />
          </div>

          <h1 className="text-3xl font-black text-white tracking-tight uppercase">
            Flowt
          </h1>
          <p className="text-[10px] font-black tracking-[0.2em] text-indigo-400 uppercase mt-1 mb-6">
            Financial Tracker
          </p>

          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed mb-8">
            Control de gastos inteligente con reparto automático en carteras y gestión integral de tus suscripciones recurrentes.
          </p>

          {/* Login Action Button */}
          <button
            onClick={handleLogin}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-600 hover:from-sky-400 hover:to-violet-500 text-white font-extrabold text-xs uppercase tracking-widest shadow-lg shadow-indigo-500/15 hover:shadow-indigo-500/30 hover:shadow-2xl hover:scale-[1.01] active:scale-95 transition-all duration-200 border border-white/10 flex items-center justify-center gap-3 cursor-pointer"
          >
            <Key size={14} />
            Acceder con Google
          </button>

          {/* Demo mode bypass */}
          <div className="relative flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">o</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            onClick={() => setForceDemo(true)}
            className="w-full py-3 rounded-2xl border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 hover:bg-white/5 font-bold text-xs uppercase tracking-widest transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles size={13} className="text-indigo-400" />
            Explorar en modo Demo
          </button>

          {/* Secure details */}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-4 font-semibold uppercase tracking-wider">
            <ShieldAlert size={12} />
            Autenticación segura por Google Firebase
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 transition-colors duration-300 font-sans pb-24">
      {/* 1. Header Navbar */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-white/5 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          
          {/* Logo brand */}
          <div className="flex items-center gap-3">
            <FlowtLogoSVG size={32} />
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none uppercase text-slate-800 dark:text-white">
                Flowt
              </h1>
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-indigo-500 leading-none block mt-0.5">
                Financial Tracker
              </span>
            </div>
          </div>

          {/* Responsive View Tabs Orchestration */}
          <nav className="hidden md:flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200/40 dark:border-white/5 rounded-2xl">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                activeTab === 'dashboard'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
            >
              <TrendingUp size={14} />
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('suscripciones')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                activeTab === 'suscripciones'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
            >
              <Layers size={14} />
              Suscripciones
            </button>
            <button
              onClick={() => setActiveTab('calendario')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                activeTab === 'calendario'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
            >
              <CalendarDays size={14} />
              Calendario
            </button>
            <button
              onClick={() => secureAction(() => setActiveTab('manual'))}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider cursor-pointer transition-all duration-200 ${
                activeTab === 'manual'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              }`}
            >
              <Mail size={14} />
              Revisión
              {pendingEmails.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-black animate-pulse">
                  {pendingEmails.length}
                </span>
              )}
            </button>
          </nav>

          {/* Quick utility controls */}
          <div className="flex items-center gap-3">
            
            {/* Privacy switch */}
            <button
              onClick={handlePrivacyToggle}
              className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all cursor-pointer hover:scale-95 active:scale-90 ${
                isLocked
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/20 animate-pulse'
                  : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
              }`}
              title={isLocked ? (hasPin ? 'Desbloquear datos con PIN' : 'Crear PIN de privacidad') : 'Bloquear datos (Ocultar saldos)'}
            >
              {isLocked ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>

            {/* Theme switch */}
            <button
              onClick={toggleTheme}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-450 border border-slate-200/30 dark:border-white/5 flex items-center justify-center transition-all cursor-pointer hover:scale-95 active:scale-90"
              title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Signed User Badge / Demo Mode indicator */}
            {!isFirebaseConfigured ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider shadow-sm">
                  <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                  Modo Demo
                </div>
                {forceDemo && (
                  <button
                    onClick={() => setForceDemo(false)}
                    className="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                    title="Salir del modo Demo y volver al login"
                  >
                    <LogOut size={14} />
                  </button>
                )}
              </div>
            ) : (
              user && (
                <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-1 rounded-2xl bg-slate-150/40 dark:bg-slate-900 border border-slate-200/30 dark:border-white/5">
                  <div className="flex flex-col text-right shrink-0">
                    <span className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 leading-tight">
                      {user.displayName || 'Usuario'}
                    </span>
                    <span className="text-[8px] font-semibold text-slate-400 leading-none">
                      {user.email || 'Conectado'}
                    </span>
                  </div>
                  
                  <button
                    onClick={handleLogout}
                    className="w-8 h-8 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                    title="Cerrar sesión"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            movimientos={movimientos}
            chartMovements={chartMovements}
            huchas={huchas}
            suscripciones={suscripciones}
            totalIngresos={totalIngresos}
            totalGastos={totalGastos}
            balance={balance}
            totalMensualSuscripciones={totalMensualSuscripciones}
            chartData={chartData}
            onUpdateConcepto={handleUpdateMovimientoConcepto}
            onConvert={handleOpenConvertModal}
            onLink={handleOpenLinkModal}
            onUnlink={handleUnlinkMovimiento}
            onChangeHucha={handleChangeMovimientoHucha}
            onOpenHuchaModal={handleOpenHuchaModal}
            onDeleteHucha={handleOpenDeleteHuchaModal}
            onOpenTransferModal={() => secureAction(() => setIsTransferModalOpen(true))}
            onOpenHistoryModal={() => secureAction(() => setIsHistoryModalOpen(true))}
          />
        )}

        {activeTab === 'suscripciones' && (
          <SuscripcionesView
            suscripciones={suscripciones}
            huchas={huchas}
            onOpenSuscripcionModal={handleOpenSuscripcionModal}
            onDeleteSuscripcion={handleDeleteSuscripcion}
            onToggleSuscripcion={handleToggleSuscripcion}
            onCancelSuscripcion={handleCancelSuscripcion}
            onUndoCancelSuscripcion={handleUndoCancelSuscripcion}
          />
        )}

        {activeTab === 'calendario' && (
          <CalendarioView suscripciones={suscripciones} />
        )}

        {activeTab === 'manual' && (
          <ManualReviewView
            pendingEmails={pendingEmails}
            huchas={huchas}
            onApprove={onApproveEmail}
            onDiscard={handleDiscardPendingEmail}
          />
        )}
      </main>

      {/* 3. Mobile Bottom navigation tabs bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-t border-slate-200/50 dark:border-white/5 py-2 px-6 flex justify-around shadow-2xl">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activeTab === 'dashboard' ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          <TrendingUp size={20} />
          <span className="text-[9px] font-black uppercase tracking-wider">Dashboard</span>
        </button>

        <button
          onClick={() => setActiveTab('suscripciones')}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activeTab === 'suscripciones' ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          <Layers size={20} />
          <span className="text-[9px] font-black uppercase tracking-wider">Suscripciones</span>
        </button>

        <button
          onClick={() => setActiveTab('calendario')}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activeTab === 'calendario' ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          <CalendarDays size={20} />
          <span className="text-[9px] font-black uppercase tracking-wider">Calendario</span>
        </button>

        <button
          onClick={() => secureAction(() => setActiveTab('manual'))}
          className={`relative flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activeTab === 'manual' ? 'text-sky-500 dark:text-sky-400' : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          <Mail size={20} />
          <span className="text-[9px] font-black uppercase tracking-wider">Revisión</span>
          {pendingEmails.length > 0 && (
            <span className="absolute -top-1 right-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[7px] font-black animate-pulse">
              {pendingEmails.length}
            </span>
          )}
        </button>
      </div>

      {/* 4. Global Specialized Form Modals overlays mounting */}
      <HuchaModal
        isOpen={isHuchaModalOpen}
        onClose={() => {
          setIsHuchaModalOpen(false);
          setEditingHucha(null);
        }}
        onSave={onSaveHucha}
        editingHucha={editingHucha}
        allHuchas={huchas}
      />

      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onTransfer={onSafeTransfer}
        huchas={huchas}
      />

      <DeleteHuchaModal
        isOpen={isDeleteHuchaModalOpen}
        onClose={() => {
          setIsDeleteHuchaModalOpen(false);
          setHuchaToDelete(null);
        }}
        onConfirmDelete={handleDeleteHucha}
        huchaToDelete={huchaToDelete}
        allHuchas={huchas}
      />

      <ConvertModal
        isOpen={isConvertModalOpen}
        onClose={() => {
          setIsConvertModalOpen(false);
          setMovimientoToConvert(null);
        }}
        onConvert={onSafeConvert}
        movimiento={movimientoToConvert}
        huchas={huchas}
      />

      <LinkModal
        isOpen={isLinkModalOpen}
        onClose={() => {
          setIsLinkModalOpen(false);
          setMovimientoToLink(null);
        }}
        onLink={handleLinkMovimiento}
        gasto={movimientoToLink}
        allMovimientos={chartMovements}
      />

      <SuscripcionModal
        isOpen={isSuscripcionModalOpen}
        onClose={() => {
          setIsSuscripcionModalOpen(false);
          setEditingSuscripcion(null);
        }}
        onSave={handleCreateOrUpdateSuscripcion}
        editingSuscripcion={editingSuscripcion}
        huchas={huchas}
      />

      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        history={historyMovements}
        onLoadMore={handleLoadMoreHistory}
        hasMore={historyHasMore}
        isLoading={historyLoading}
        onUpdateConcepto={handleUpdateMovimientoConcepto}
        onUnlink={handleUnlinkMovimiento}
      />

      {/* 5. One-Click Mock Transaction Injector Panel for Demo Mode */}
      {!isFirebaseConfigured && (
        <DemoSimulator 
          injectDemoMovement={injectDemoMovement}
          huchas={huchas}
        />
      )}

      {/* PIN Security lockscreen modal */}
      <PinModal />

      {/* 6. Global Feedback overlay components */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full pointer-events-none">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
      {confirmModal && (
        <ConfirmModal
          isOpen={true}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmLabel}
          onConfirm={confirmModal.onConfirm}
          onClose={() => setConfirmModal(null)}
        />
      )}

      {/* Premium Canvas Confetti burst milestone celebrates */}
      <CelebrationConfetti trigger={confettiTrigger} />

      {/* Keyboard Shortcuts floating guide help panel */}
      <ShortcutsHelpModal 
        isOpen={isShortcutsHelpOpen} 
        onClose={() => setIsShortcutsHelpOpen(false)} 
      />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <PrivacyProvider>
      <AppContent />
    </PrivacyProvider>
  );
};

export default App;

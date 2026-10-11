import React, { useState, useEffect, useCallback } from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { collection, query, where, orderBy, limit, startAfter, getDocs, type DocumentSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useTheme } from './hooks/useTheme';
import { useFinanceData } from './hooks/useFinanceData';
import { type Hucha, type Suscripcion, type Movimiento } from './types';

// Tab subviews
import { DashboardView } from './components/dashboard/DashboardView';

// Demo, Feedback, and Premium Visuals
import { Toast } from './components/common/Toast';
import { DashboardSkeleton } from './components/dashboard/DashboardSkeleton';
import { MANUAL_LOGIN_PATH } from './components/auth/manualLoginPath';
import { LoginScreen } from './components/auth/LoginScreen';
import { FlowtLogo } from './components/common/FlowtLogo';

// Icons
import {
  LogOut,
  Sun,
  Moon,
  House,
  Mail,
  Eye,
  EyeOff,
  User,
  CalendarDays,
  Settings,
} from 'lucide-react';
import { PrivacyProvider, usePrivacy } from './context/PrivacyContext';
import { CategoriesProvider } from './context/CategoriesContext';
// The app always starts locked, so the PIN modal is on the critical path: keep it in the entry chunk.
import { PinModal } from './components/common/PinModal';
import { DeferredOverlay } from './components/common/DeferredOverlay';
import { TabLoading } from './components/common/TabLoading';
import { BentoMenu } from './components/common/BentoMenu';

const CalendarioView = React.lazy(() => import('./components/calendario/CalendarioView').then((m) => ({ default: m.CalendarioView })));
const CorreosOrchestrator = React.lazy(() => import('./components/correos/CorreosOrchestrator').then((m) => ({ default: m.CorreosOrchestrator })));
const AjustesOrchestrator = React.lazy(() => import('./components/ajustes/AjustesOrchestrator').then((m) => ({ default: m.AjustesOrchestrator })));
const HuchaModal = React.lazy(() => import('./components/modals/HuchaModal').then((m) => ({ default: m.HuchaModal })));
const TransferModal = React.lazy(() => import('./components/modals/TransferModal').then((m) => ({ default: m.TransferModal })));
const DeleteHuchaModal = React.lazy(() => import('./components/modals/DeleteHuchaModal').then((m) => ({ default: m.DeleteHuchaModal })));
const ConvertModal = React.lazy(() => import('./components/modals/ConvertModal').then((m) => ({ default: m.ConvertModal })));
const LinkModal = React.lazy(() => import('./components/modals/LinkModal').then((m) => ({ default: m.LinkModal })));
const SuscripcionModal = React.lazy(() => import('./components/modals/SuscripcionModal').then((m) => ({ default: m.SuscripcionModal })));
const HistoryModal = React.lazy(() => import('./components/modals/HistoryModal').then((m) => ({ default: m.HistoryModal })));
const ManualMovimientoModal = React.lazy(() => import('./components/modals/ManualMovimientoModal').then((m) => ({ default: m.ManualMovimientoModal })));
const ProfilePanel = React.lazy(() => import('./components/profile/ProfilePanel').then((m) => ({ default: m.ProfilePanel })));
const DemoSimulator = React.lazy(() => import('./components/demo/DemoSimulator').then((m) => ({ default: m.DemoSimulator })));
const ConfirmModal = React.lazy(() => import('./components/common/ConfirmModal').then((m) => ({ default: m.ConfirmModal })));
const ShortcutsHelpModal = React.lazy(() => import('./components/common/ShortcutsHelpModal').then((m) => ({ default: m.ShortcutsHelpModal })));
const CelebrationConfetti = React.lazy(() => import('./components/common/CelebrationConfetti').then((m) => ({ default: m.CelebrationConfetti })));
const ManualLogin = React.lazy(() => import('./components/auth/ManualLogin').then((m) => ({ default: m.ManualLogin })));

type AppTab = 'dashboard' | 'calendario' | 'correos' | 'ajustes';

const NAV_TABS: { id: AppTab; label: string; icon: typeof House }[] = [
  { id: 'dashboard', label: 'Inicio', icon: House },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'correos', label: 'Correos', icon: Mail },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
];

const headerIconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-soft transition-colors duration-150 hover:bg-surface-2 hover:text-ink';


const AppContent: React.FC<{ forceDemo: boolean; setForceDemo: React.Dispatch<React.SetStateAction<boolean>> }> = ({ forceDemo, setForceDemo }) => {
  const { theme, toggleTheme } = useTheme();
  const { isLocked, lock, openUnlockModal, hasPin, openCreateModal } = usePrivacy();

  // Demo mode can be forced from the login screen even when Firebase is configured
  
  const {
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
    balance,
    chartData,
    huchaMonthlyBudgets,
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
  } = useFinanceData(forceDemo);

  // Tab switching state
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [prevMobileIndex, setPrevMobileIndex] = useState(0);
  const [isSliding, setIsSliding] = useState(false);

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
  const [isManualMovimientoModalOpen, setIsManualMovimientoModalOpen] = useState(false);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
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
    if (isFirebaseConfigured && user && !isLocked) {
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

    if (isFirebaseConfigured && user && !isLocked) {
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
      queueMicrotask(() => void initHistoryPagination());
    }
  }, [isHistoryModalOpen]);

  // Update history items live if local updates happen in Demo Mode
  useEffect(() => {
    if (isHistoryModalOpen && !isFirebaseConfigured) {
      queueMicrotask(() => setHistoryMovements(chartMovements.slice(0, demoOffset)));
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
        secureAction(() => {
          setEditingHucha(null);
          setIsHuchaModalOpen(true);
        });
      } else if (key === 'M') {
        e.preventDefault();
        secureAction(() => setIsManualMovimientoModalOpen(true));
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
      if (hucha.saldo_acumulado <= 0 && !(hucha.deuda_pendiente && hucha.deuda_pendiente > 0)) {
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

  // Safe wrapper for conversion
  const onSafeConvert = async (
    mov: Movimiento,
    rows?: Array<{
      huchaId: string;
      tipoAportacion: 'flat' | 'porcentaje' | 'resto';
      value: number;
    }>,
    targetHuchaId?: string
  ) => {
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

  // Safe wrapper for movement deletion with confirmation modal
  const onDeleteMovimientoWrapper = (mov: Movimiento) => {
    secureAction(() => {
      setConfirmModal({
        title: 'Eliminar Movimiento',
        message: `¿Eliminar el movimiento "${mov.concepto}" de ${mov.importe.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}? Se revertirán los saldos de tus carteras.`,
        confirmLabel: 'Eliminar',
        onConfirm: async () => {
          await handleDeleteMovimiento(mov);
          setConfirmModal(null);
        }
      });
    });
  };

  // Rendering loading state
  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!user && window.location.pathname.replace(/\/$/, '') === MANUAL_LOGIN_PATH) {
    return (
      <React.Suspense fallback={<DashboardSkeleton />}>
        <ManualLogin configured={isFirebaseConfigured} />
      </React.Suspense>
    );
  }

  // Rendering signed out view when firebase is active
  if (isFirebaseConfigured && !user) {
    return <LoginScreen onLogin={handleLogin} onDemo={() => setForceDemo(true)} />;
  }

  const firstName = !isLocked ? user?.displayName?.trim().split(/\s+/)[0] : undefined;

  return (
    <div className="app-canvas min-h-screen max-w-full overflow-x-clip pb-28 font-sans md:pb-12">
      {/* 1. Header Navbar */}
      <header className="sticky top-0 z-30 border-b border-line bg-page/75 backdrop-blur-xl">
        <div className="flowt-container mx-auto flex h-14 items-center justify-between gap-3 sm:h-16">

          {/* Logo brand */}
          <div className="flex min-w-0 items-center gap-2.5">
            <FlowtLogo size={28} />
            <span className="font-display text-xl font-bold leading-none tracking-tight text-ink">
              Flowt
            </span>
          </div>

          {/* Desktop view tabs */}
          <nav
            aria-label="Secciones"
            className="segmented max-md:hidden"
          >
            {NAV_TABS.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              const badge = id === 'correos' ? pendingEmails.length : 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-current={isActive ? 'page' : undefined}
                  className="segmented-item"
                >
                  <Icon size={15} className={isActive ? 'text-brand-ink' : ''} />
                  {label}
                  {badge > 0 && (
                    <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-sun-500 px-1 text-[10px] font-extrabold leading-none text-slate-950">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Quick utility controls */}
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <BentoMenu />

            {/* Privacy switch */}
            <button
              type="button"
              onClick={handlePrivacyToggle}
              className={
                isLocked
                  ? 'grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500/10 text-rose-500 transition-colors duration-150 hover:bg-rose-500/15'
                  : headerIconButton
              }
              title={isLocked ? (hasPin ? 'Desbloquear datos con PIN' : 'Crear PIN de privacidad') : 'Bloquear datos (Ocultar saldos)'}
              aria-label={isLocked ? (hasPin ? 'Desbloquear datos con PIN' : 'Crear PIN de privacidad') : 'Bloquear datos'}
            >
              {isLocked ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>

            {/* Theme switch */}
            <button
              type="button"
              onClick={toggleTheme}
              className={headerIconButton}
              title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
              aria-label={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Signed User Badge / Demo Mode indicator */}
            {!isFirebaseConfigured ? (
              <div className="ml-1 flex items-center gap-1 rounded-full bg-sun-500/12 py-1 pl-3 pr-1 text-xs font-bold text-sun-600 dark:text-sun-300">
                <span className="h-1.5 w-1.5 rounded-full bg-sun-500" />
                <span className={forceDemo ? '' : 'pr-2'}>Demo</span>
                {forceDemo && (
                  <button
                    type="button"
                    onClick={() => setForceDemo(false)}
                    className="grid h-7 w-7 place-items-center rounded-full transition-colors duration-150 hover:bg-sun-500/20"
                    title="Salir del modo Demo y volver al login"
                    aria-label="Salir del modo Demo"
                  >
                    <LogOut size={13} />
                  </button>
                )}
              </div>
            ) : (
              user && (
                <button
                  type="button"
                  onClick={() => setIsProfilePanelOpen(true)}
                  aria-label="Abrir perfil"
                  className="group ml-1 flex items-center gap-2.5 rounded-full border border-transparent py-1 pl-1 pr-1 transition-colors duration-150 hover:border-line hover:bg-surface-2 lg:pr-3"
                >
                  <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-brand-tint text-brand-ink">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <User size={15} />
                    )}
                  </span>
                  <span className="hidden text-left leading-tight lg:block">
                    <span className="block text-xs font-bold text-ink">
                      {isLocked ? 'Usuario privado' : (user.displayName || 'Usuario')}
                    </span>
                    <span className="block text-[10px] text-ink-faint">
                      {isLocked ? '••••@••••.••' : (user.email || 'Conectado')}
                    </span>
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* 2. Main Content Container */}
      <main className="flowt-container mx-auto mt-5 sm:mt-8">
        {activeTab === 'dashboard' && (
          <DashboardView
            userName={firstName}
            hasPin={hasPin}
            onUnlock={handlePrivacyToggle}
            movimientos={movimientos}
            chartMovements={chartMovements}
            chartMovementsLoading={chartMovementsLoading}
            olderMovements={olderMovements}
            olderMovementsLoading={olderMovementsLoading}
            olderMovementsLoaded={olderMovementsLoaded}
            olderMovementsError={olderMovementsError}
            loadOlderMovements={loadOlderMovements}
            huchas={huchas}
            suscripciones={suscripciones}
            balance={balance}
            chartData={chartData}
            huchaMonthlyBudgets={huchaMonthlyBudgets}
            onUpdateConcepto={handleUpdateMovimientoConcepto}
            onUpdateCategoria={handleUpdateMovimientoCategoria}
            onAcceptCompensation={handleLinkMovimiento}
            onDismissCompensation={handleDismissCompensation}
            onConvert={handleOpenConvertModal}
            onLink={handleOpenLinkModal}
            onUnlink={handleUnlinkMovimiento}
            onChangeHucha={handleChangeMovimientoHucha}
            onOpenHuchaModal={handleOpenHuchaModal}
            onDeleteHucha={handleOpenDeleteHuchaModal}
            onOpenTransferModal={() => secureAction(() => setIsTransferModalOpen(true))}
            onOpenHistoryModal={() => secureAction(() => setIsHistoryModalOpen(true))}
            onOpenManualMovimientoModal={() => secureAction(() => setIsManualMovimientoModalOpen(true))}
            onOpenCalendar={() => setActiveTab('calendario')}
            onDeleteMovimiento={onDeleteMovimientoWrapper}
            onSubsanar={handleSubsanarHucha}
            onRevertirDeuda={handleRevertirDeuda}
          />
        )}

        {activeTab === 'calendario' && (
          <React.Suspense fallback={<TabLoading />}>
            <CalendarioView suscripciones={suscripciones} />
          </React.Suspense>
        )}

        {activeTab === 'correos' && (
          <React.Suspense fallback={<TabLoading />}>
            <CorreosOrchestrator
              pendingEmails={pendingEmails}
              historicoCorreos={historicoCorreos}
              huchas={huchas}
              onApprove={handleApprovePendingEmail}
              onDiscard={handleDiscardPendingEmail}
            />
          </React.Suspense>
        )}

        {activeTab === 'ajustes' && (
          <React.Suspense fallback={<TabLoading />}>
            <AjustesOrchestrator
              suscripciones={suscripciones}
              huchas={huchas}
              onOpenSuscripcionModal={(s) => {
                setEditingSuscripcion(s || null);
                setIsSuscripcionModalOpen(true);
              }}
              onDeleteSuscripcion={handleDeleteSuscripcion}
              onToggleSuscripcion={handleToggleSuscripcion}
              onCancelSuscripcion={handleCancelSuscripcion}
              onUndoCancelSuscripcion={handleUndoCancelSuscripcion}
              chartMovements={chartMovements}
              userStats={userStats}
              userId={user?.uid}
              onRestoreHucha={handleRestoreHucha}
            />
          </React.Suspense>
        )}
      </main>

      {/* 3. Mobile bottom navigation: a floating bar with a sliding marker */}
      {(() => {
        const activeMobileIndex = Math.max(0, NAV_TABS.findIndex(t => t.id === activeTab));
        const distance = Math.abs(activeMobileIndex - prevMobileIndex);
        const slideDuration = Math.min(420, Math.max(250, distance * 85));

        const handleMobileTabClick = (tabId: AppTab) => {
          const nextIndex = Math.max(0, NAV_TABS.findIndex(t => t.id === tabId));
          if (nextIndex !== activeMobileIndex) {
            setIsSliding(true);
            setActiveTab(tabId);
            window.scrollTo({ top: 0 });
            setTimeout(() => {
              setIsSliding(false);
              setPrevMobileIndex(nextIndex);
            }, slideDuration);
          }
        };

        return (
          <nav
            aria-label="Secciones"
            className="fixed inset-x-3 bottom-3 z-40 pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            <div className="relative flex h-16 items-center overflow-hidden rounded-[1.75rem] border border-line-strong bg-surface/90 shadow-[var(--shadow-pop)] backdrop-blur-xl">

              {/* Sliding marker */}
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1/5 p-1.5"
                style={{
                  transform: `translateX(${activeMobileIndex * 100}%)`,
                  transitionProperty: 'transform',
                  transitionDuration: `${slideDuration}ms`,
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                <div
                  className={`h-full w-full rounded-[1.3rem] bg-brand shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_18px_-8px_var(--brand)] transition-transform duration-200 ${
                    isSliding ? 'scale-x-110 scale-y-95' : ''
                  }`}
                />
              </div>

              {NAV_TABS.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                const badge = id === 'correos' ? pendingEmails.length : 0;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleMobileTabClick(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative z-10 flex h-full w-1/5 flex-col items-center justify-center gap-1 transition-colors duration-300 ${
                      isActive ? 'text-white' : 'text-ink-soft'
                    }`}
                  >
                    <span className="relative">
                      <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
                      {badge > 0 && (
                        <span className="absolute -right-2 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-sun-500 px-0.5 text-[8px] font-extrabold leading-none text-slate-950 ring-2 ring-surface">
                          {badge}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-bold leading-none">{label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        );
      })()}

      <DeferredOverlay active={isProfilePanelOpen}>
        <ProfilePanel
          isOpen={isProfilePanelOpen}
          onClose={() => setIsProfilePanelOpen(false)}
          user={user}
          onLogout={handleLogout}
        />
      </DeferredOverlay>

      {/* 4. Global Specialized Form Modals overlays mounting */}
      <DeferredOverlay active={isHuchaModalOpen}>
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
      </DeferredOverlay>

      <DeferredOverlay active={isTransferModalOpen}>
        <TransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          onTransfer={onSafeTransfer}
          huchas={huchas}
        />
      </DeferredOverlay>

      <DeferredOverlay active={isDeleteHuchaModalOpen}>
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
      </DeferredOverlay>

      <DeferredOverlay active={isConvertModalOpen}>
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
      </DeferredOverlay>

      <DeferredOverlay active={isLinkModalOpen}>
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
      </DeferredOverlay>

      <DeferredOverlay active={isSuscripcionModalOpen}>
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
      </DeferredOverlay>

      <DeferredOverlay active={isHistoryModalOpen}>
        <HistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          history={historyMovements}
          onLoadMore={handleLoadMoreHistory}
          hasMore={historyHasMore}
          isLoading={historyLoading}
          onUpdateConcepto={handleUpdateMovimientoConcepto}
          onUpdateCategoria={async (id, categoria) => {
            await handleUpdateMovimientoCategoria(id, categoria);
            setHistoryMovements(current => current.map(m => m.id === id ? { ...m, categoria } : m));
          }}
          onUnlink={handleUnlinkMovimiento}
          onDeleteMovimiento={onDeleteMovimientoWrapper}
        />
      </DeferredOverlay>

      <DeferredOverlay active={isManualMovimientoModalOpen}>
        <ManualMovimientoModal
          isOpen={isManualMovimientoModalOpen}
          onClose={() => setIsManualMovimientoModalOpen(false)}
          onSave={handleCreateManualMovimiento}
          huchas={huchas}
        />
      </DeferredOverlay>

      {/* 5. One-Click Mock Transaction Injector Panel for Demo Mode */}
      {!isFirebaseConfigured && (
        <React.Suspense fallback={null}>
          <DemoSimulator
            injectDemoMovement={injectDemoMovement}
            huchas={huchas}
          />
        </React.Suspense>
      )}

      {/* PIN Security lockscreen modal */}
      <PinModal />

      {/* 6. Global Feedback overlay components */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-3 bottom-24 z-50 md:inset-x-auto md:bottom-6 md:right-6 md:w-full md:max-w-sm">
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
      {confirmModal && (
        <React.Suspense fallback={null}>
          <ConfirmModal
            isOpen={true}
            title={confirmModal.title}
            message={confirmModal.message}
            confirmText={confirmModal.confirmLabel}
            onConfirm={confirmModal.onConfirm}
            onClose={() => setConfirmModal(null)}
          />
        </React.Suspense>
      )}

      {/* Premium Canvas Confetti burst milestone celebrates */}
      <DeferredOverlay active={confettiTrigger > 0}>
        <CelebrationConfetti trigger={confettiTrigger} />
      </DeferredOverlay>

      {/* Keyboard Shortcuts floating guide help panel */}
      <DeferredOverlay active={isShortcutsHelpOpen}>
        <ShortcutsHelpModal
          isOpen={isShortcutsHelpOpen}
          onClose={() => setIsShortcutsHelpOpen(false)}
        />
      </DeferredOverlay>
    </div>
  );
};

const App: React.FC = () => {
  const [forceDemo, setForceDemo] = useState(false);
  return (
    <PrivacyProvider>
      <CategoriesProvider forceDemo={forceDemo}>
        <AppContent forceDemo={forceDemo} setForceDemo={setForceDemo} />
      </CategoriesProvider>
    </PrivacyProvider>
  );
};

export default App;

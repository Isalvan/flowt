import { useMemo, useState, useCallback } from 'react';
import { type User } from 'firebase/auth';
import { type Movimiento, type Hucha, type Suscripcion, type PendingEmail, type CorreoHistorico } from '../types';
import { usePrivacy } from '../context/PrivacyContext';

import { getMovementWindowStart } from '../utils/periodStats';

export { parseMovimientoDate } from '../utils/periodStats';
export { SUBSCRIPTION_COLORS, FRECUENCIA_OPTIONS, CATEGORIA_OPTIONS, calcMensual } from './finance/constants';
import { createDemoStateHelpers, createDemoDistribution, createDemoSimulator } from './finance/demoData';
import { createWalletHandlers } from './finance/wallets';
import { createMovementHandlers } from './finance/movements';
import { createSubscriptionHandlers, useSubscriptionCleanup } from './finance/subscriptions';
import { createPendingEmailHandlers } from './finance/pendingEmails';
import { createMovementWriteHandlers } from './finance/movementWrites';
import { useFinanceListeners, useOlderSessionEffect } from './finance/listeners';
import { useFinanceStatistics } from './finance/statistics';

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
  const [historicoCorreos, setHistoricoCorreos] = useState<CorreoHistorico[]>([]);
  const [userStats, setUserStats] = useState<{ total_ingresos: number; total_gastos: number } | null>(null);

  const [windowStart] = useState(() => getMovementWindowStart());
  const [chartMovementsLoading, setChartMovementsLoading] = useState(true);
  const uid = user?.uid;
  // Each unlocked user session owns its cache and pending request.
  const olderSession = useMemo(() => ({ uid, isFirebaseConfigured, isLocked, forceDemo, active: true, requested: false }), [uid, isFirebaseConfigured, isLocked, forceDemo]);
  const [olderState, setOlderState] = useState<{
    session: typeof olderSession;
    movements: Movimiento[];
    status: 'loading' | 'loaded' | 'error';
  } | null>(null);
  useOlderSessionEffect({ olderSession, setOlderState });
  const currentOlderState = olderState?.session === olderSession ? olderState : null;
  const olderMovements = currentOlderState?.movements ?? [];
  const olderMovementsLoading = currentOlderState?.status === 'loading';
  const olderMovementsLoaded = !isFirebaseConfigured || forceDemo || currentOlderState?.status === 'loaded';
  const olderMovementsError = currentOlderState?.status === 'error';

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

  const context = {
    user,
    loading,
    isFirebaseConfigured,
    isLocked,
    forceDemo,
    windowStart,
    movimientos,
    chartMovements,
    huchas,
    suscripciones,
    pendingEmails,
    userStats,
    setUser,
    setLoading,
    setIsFirebaseConfigured,
    setMovimientos,
    setChartMovements,
    setChartMovementsLoading,
    setHuchas,
    setSuscripciones,
    setPendingEmails,
    setHistoricoCorreos,
    setUserStats,
    setConfirmModal,
    showToast,
    uid,
    olderSession,
    setOlderState,
  };
  const {
    loadDemoData,
    saveDemoState,
  } = createDemoStateHelpers(context);
  const {
    loadOlderMovements,
  } = useFinanceListeners({ ...context, loadDemoData });
  const {
    processLocalDistribution,
  } = createDemoDistribution(context);
  const {
    handleCreateOrUpdateHucha,
    handleDeleteHucha,
    handleRestoreHucha,
    handleTransfer,
    handleSubsanarHucha,
    handleRevertirDeuda,
  } = createWalletHandlers({ ...context, saveDemoState });
  const {
    handleUpdateMovimientoConcepto,
    handleConvertMovimiento,
    handleUpdateMovimientoCategoria,
    handleDismissCompensation,
    handleLinkMovimiento,
    handleUnlinkMovimiento,
    handleChangeMovimientoHucha,
  } = createMovementHandlers({ ...context, saveDemoState });
  const {
    queueSuscripcionesHuchaSync,
    syncSuscripcionesHucha,
    handleCreateOrUpdateSuscripcion,
    handleDeleteSuscripcion,
    handleToggleSuscripcion,
    handleCancelSuscripcion,
    handleUndoCancelSuscripcion,
  } = createSubscriptionHandlers({ ...context, saveDemoState });
  const {
    handleApprovePendingEmail,
    handleDiscardPendingEmail,
  } = createPendingEmailHandlers({ ...context, saveDemoState });
  const {
    handleCreateManualMovimiento,
    handleDeleteMovimiento,
  } = createMovementWriteHandlers({ ...context, saveDemoState, handleUnlinkMovimiento });
  useSubscriptionCleanup({ ...context, saveDemoState, syncSuscripcionesHucha, queueSuscripcionesHuchaSync });
  const {
    injectDemoMovement,
  } = createDemoSimulator({ ...context, saveDemoState, processLocalDistribution });
  const {
    totalIngresos,
    totalGastos,
    balance,
    mediaIngresos,
    huchaMonthlyBudgets,
    totalMensualSuscripciones,
    principalHucha,
    chartData,
  } = useFinanceStatistics(context);

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

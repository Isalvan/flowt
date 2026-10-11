import { type Suscripcion, type Hucha } from '../../types';
import { type WriteBatch, type DocumentReference, doc, collection, serverTimestamp, writeBatch, runTransaction } from 'firebase/firestore';
import { db } from '../../firebase';
import { toLocalDateKey, getNextSubscriptionChargeDate, isCancellationExpired } from '../../utils/subscriptions';
import type { FinanceContext } from './context';
import { calcMensual } from './constants';
import { useEffect } from 'react';

export const createSubscriptionHandlers = (context: Pick<
  FinanceContext,
  | 'user'
  | 'huchas'
  | 'isFirebaseConfigured'
  | 'suscripciones'
  | 'saveDemoState'
  | 'movimientos'
  | 'userStats'
  | 'showToast'
  | 'setConfirmModal'
>) => {
  const {
    user,
    huchas,
    isFirebaseConfigured,
    suscripciones,
    saveDemoState,
    movimientos,
    userStats,
    showToast,
    setConfirmModal,
  } = context;


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

  return { getRoundedSubscriptionTotal, queueSuscripcionesHuchaSync, syncSuscripcionesHucha, handleCreateOrUpdateSuscripcion, handleDeleteSuscripcion, handleToggleSuscripcion, handleCancelSuscripcion, handleUndoCancelSuscripcion };
};

export const useSubscriptionCleanup = (context: Pick<
  FinanceContext,
  | 'suscripciones'
  | 'isFirebaseConfigured'
  | 'syncSuscripcionesHucha'
  | 'saveDemoState'
  | 'movimientos'
  | 'huchas'
  | 'userStats'
  | 'user'
  | 'queueSuscripcionesHuchaSync'
>) => {
  const {
    suscripciones,
    isFirebaseConfigured,
    syncSuscripcionesHucha,
    saveDemoState,
    movimientos,
    huchas,
    userStats,
    user,
    queueSuscripcionesHuchaSync,
  } = context;


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
};

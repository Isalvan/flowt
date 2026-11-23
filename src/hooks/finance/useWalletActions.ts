import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  serverTimestamp,
  runTransaction,
  setDoc,
  deleteField,
  type Transaction,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { splitIncome, applySplit, cappedWalletCredit, roundMoney, isIncomeSplitError, type IncomeSplit } from '../../utils/incomeSplit';
import type { ConfirmModal } from './useFeedback';

type UserStats = { total_ingresos: number; total_gastos: number };

interface WalletActionsContext {
  user: User | null;
  isFirebaseConfigured: boolean;
  forceDemo: boolean;
  huchas: Hucha[];
  movimientos: Movimiento[];
  suscripciones: Suscripcion[];
  userStats: UserStats | null;
  saveDemoState: (newMovs: Movimiento[], newHuchas: Hucha[], newSubs: Suscripcion[], newStats: UserStats) => void;
  /** Reads the user's wallets inside a transaction, before any write. */
  readHuchas: (transaction: Transaction, extraIds?: string[]) => Promise<Hucha[]>;
  writeSplit: (transaction: Transaction, current: Hucha[], split: IncomeSplit) => void;
  showToast: (message: string, type?: 'error' | 'success') => void;
  setConfirmModal: Dispatch<SetStateAction<ConfirmModal | null>>;
}

/**
 * Wallets (huchas): create, edit, delete and restore them, move money between
 * them, lend from one to another, and settle or undo a debt. Works the same in
 * Firebase and in the demo.
 */
export const useWalletActions = ({
  user, isFirebaseConfigured, forceDemo, huchas, movimientos, suscripciones, userStats,
  saveDemoState, readHuchas, writeSplit, showToast, setConfirmModal,
}: WalletActionsContext) => {
  const handleCreateOrUpdateHucha = async (newHucha: Omit<Hucha, 'id' | 'saldo_acumulado' | 'orden'>, editingId: string | null) => {
    // Optional wallet settings: omitted fields leave the stored values untouched.
    const optionalSettings = {
      ...(newHucha.extra_importe !== undefined ? { extra_importe: newHucha.extra_importe === null ? null : roundMoney(Number(newHucha.extra_importe)) } : {}),
      ...(newHucha.extra_meses !== undefined ? { extra_meses: newHucha.extra_meses === null ? null : [...new Set(newHucha.extra_meses)].sort((a, b) => a - b) } : {}),
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
              ...optionalSettings,
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
          ...optionalSettings,
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
      ...optionalSettings,
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
                  deuda_con: hucha.deuda_con,
                  ...(!(h.deuda_pendiente && h.deuda_pendiente > 0) ? { deuda_cuota: hucha.deuda_cuota } : {}),
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
              ...(!(assignee.deuda_pendiente && assignee.deuda_pendiente > 0) ? { deuda_cuota: current.deuda_cuota ?? deleteField() } : {}),
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
        const delta = transferDeltas[h.id] || 0;
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

  const handlePrestamo = async (fromId: string, toId: string, amount: number, meses: number) => {
    try {
      if (fromId === toId) throw new Error('Debes seleccionar carteras distintas.');
      if (!Number.isFinite(amount) || amount <= 0 || roundMoney(amount) <= 0) throw new Error('El importe debe ser mayor que cero.');
      if (!Number.isInteger(meses) || meses < 1 || meses > 36) throw new Error('El plazo debe ser un número entero entre 1 y 36 meses.');
      const importe = roundMoney(amount);
      const cuota = Math.ceil(Math.round(importe * 100) / meses) / 100;
      const validate = (from: Hucha | undefined, to: Hucha | undefined) => {
        if (!from || !to || from.activa === false || to.activa === false || from.es_metalico || to.es_metalico) {
          throw new Error('Selecciona dos carteras activas que no sean de metálico.');
        }
        if ((to.deuda_pendiente || 0) > 0) throw new Error(`${to.nombre} ya tiene un préstamo pendiente; devuélvelo o revierte antes`);
        if (roundMoney(from.saldo_acumulado) < importe) throw new Error('Saldo insuficiente en la cartera de origen');
        return { from, to };
      };
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const legs = (from: Hucha, to: Hucha): Movimiento[] => [
        { id: `${transferId}-gasto`, tipo: 'gasto', concepto: `Préstamo a ${to.nombre}`, hucha_id: fromId, importe, fecha_operacion: new Date(), es_interno: true, transfer_id: transferId },
        { id: `${transferId}-ingreso`, tipo: 'ingreso', concepto: `Préstamo de ${from.nombre}`, hucha_id: toId, importe, fecha_operacion: new Date(), es_interno: true, transfer_id: transferId },
      ];

      if (!isFirebaseConfigured) {
        const { from, to } = validate(huchas.find(h => h.id === fromId), huchas.find(h => h.id === toId));
        const updated = huchas.map(h => h.id === fromId
          ? { ...h, saldo_acumulado: roundMoney(h.saldo_acumulado - importe) }
          : h.id === toId ? { ...h, saldo_acumulado: roundMoney(h.saldo_acumulado + importe), deuda_pendiente: importe, deuda_con: fromId, deuda_cuota: cuota } : h);
        saveDemoState([...legs(from, to), ...movimientos], updated, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        await runTransaction(db, async transaction => {
          const fromRef = doc(db, 'huchas', fromId);
          const toRef = doc(db, 'huchas', toId);
          const fromDoc = await transaction.get(fromRef);
          const toDoc = await transaction.get(toRef);
          const { from, to } = validate(
            fromDoc.exists() ? { ...fromDoc.data(), id: fromId } as Hucha : undefined,
            toDoc.exists() ? { ...toDoc.data(), id: toId } as Hucha : undefined,
          );
          transaction.update(fromRef, { saldo_acumulado: roundMoney(from.saldo_acumulado - importe), updated_at: serverTimestamp() });
          transaction.update(toRef, { saldo_acumulado: roundMoney(to.saldo_acumulado + importe), deuda_pendiente: importe, deuda_con: fromId, deuda_cuota: cuota, updated_at: serverTimestamp() });
          for (const leg of legs(from, to)) {
            const ref = doc(collection(db, 'movimientos'));
            transaction.set(ref, { ...leg, id: ref.id, id_propietario: user?.uid, fecha_operacion: serverTimestamp(), created_at: serverTimestamp() });
          }
        });
      }
      showToast('Préstamo completado', 'success');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Error al prestar fondos.');
      throw error;
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

    if ((hucha.deuda_pendiente || 0) > 0 && hucha.deuda_con !== lenderHuchaId) {
      showToast(`${hucha.nombre} ya debe dinero a otra cartera; revierte esa deuda antes`);
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
            deuda_con: lenderHuchaId,
            deuda_cuota: (h.deuda_pendiente || 0) > 0 ? h.deuda_cuota : undefined,
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

        if ((toDoc.data().deuda_pendiente || 0) > 0 && toDoc.data().deuda_con !== lenderHuchaId) {
          throw new Error(`${toDoc.data().nombre} ya debe dinero a otra cartera; revierte esa deuda antes`);
        }
        
        const fromBalance = fromDoc.data().saldo_acumulado || 0;
        const toBalance = toDoc.data().saldo_acumulado || 0;

        transaction.update(fromRef, { saldo_acumulado: fromBalance - amount, updated_at: serverTimestamp() });
        transaction.update(toRef, { 
          saldo_acumulado: toBalance + amount,
          deuda_pendiente: (toDoc.data().deuda_pendiente || 0) + amount,
          deuda_con: lenderHuchaId,
          ...(!(toDoc.data().deuda_pendiente > 0) ? { deuda_cuota: deleteField() } : {}),
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
      const updated = huchas.map(h => {
        if (h.id === lenderHuchaId) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + deuda).toFixed(2)) };
        }
        if (h.id === hucha.id) {
          const rest = { ...h };
          delete rest.deuda_pendiente;
          delete rest.deuda_con;
          delete rest.deuda_cuota;
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
          deuda_cuota: deleteField(),
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

  return {
    handleCreateOrUpdateHucha,
    handleDeleteHucha,
    handleRestoreHucha,
    handleTransfer,
    handlePrestamo,
    handleSubsanarHucha,
    handleRevertirDeuda,
  };
};

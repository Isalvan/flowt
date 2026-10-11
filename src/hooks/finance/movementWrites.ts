import { type Movimiento, type Hucha } from '../../types';
import { crearRetiradaEfectivo, cuentaEnEstadisticas } from '../../utils/movements';
import { runTransaction, doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import type { FinanceContext } from './context';
import { redirectOverflowToResto, refundHuchaId } from './distribution';

export const createMovementWriteHandlers = (context: Pick<
  FinanceContext,
  | 'showToast'
  | 'isFirebaseConfigured'
  | 'huchas'
  | 'saveDemoState'
  | 'movimientos'
  | 'suscripciones'
  | 'userStats'
  | 'user'
  | 'handleUnlinkMovimiento'
>) => {
  const {
    showToast,
    isFirebaseConfigured,
    huchas,
    saveDemoState,
    movimientos,
    suscripciones,
    userStats,
    user,
    handleUnlinkMovimiento,
  } = context;


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
  }) => {
    const amt = Number(movData.importe);
    const isIngreso = movData.tipo === 'ingreso';
    const isMetalico = !!movData.es_metalico;
    const isCashWithdrawal = !!movData.es_retirada_efectivo;
    const isInternal = !!movData.es_interno || isCashWithdrawal;

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
          // Auto-reparto estándar
          const deltas: Record<string, number> = {};
          let remaining = amt;
          const activeHuchas = nextHuchas.filter(h => h.activa !== false);
          // 1. Flat
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Porcentaje
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Resto
          const resto = activeHuchas.find(h => h.tipo_aportacion === 'resto') || activeHuchas.find(h => h.es_principal) || activeHuchas[0];
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
      if (cuentaEnEstadisticas(newMov)) {
        if (isIngreso) nextStats.total_ingresos += amt;
        else nextStats.total_gastos += amt;
      }

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
      showToast('Movimiento registrado correctamente', 'success');
      return;
    }

    // 2. MODO FIREBASE
    if (!user) return;
    try {
      await runTransaction(db, async (transaction) => {
        let targetHuchaId = movData.hucha_id;
        let createdCashHuchaId: string | null = null;
        let createdCashHuchaData: Record<string, unknown> | null = null;
        const nextHuchasState = [...huchas];

        // Provisionar hucha de Efectivo si es metálico y no existe
        if (isMetalico) {
          const cashHucha = nextHuchasState.find(h => h.activa !== false && (h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo')));
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

          transaction.update(originRef, { saldo_acumulado: originBalance - amt, updated_at: serverTimestamp() });
          if (targetHuchaId === createdCashHuchaId) {
            transaction.set(cashRef, { ...createdCashHuchaData!, saldo_acumulado: amt, updated_at: serverTimestamp() });
          } else {
            transaction.update(cashRef, { saldo_acumulado: (cashSnap!.data().saldo_acumulado || 0) + amt, updated_at: serverTimestamp() });
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
              transaction.update(huchaRef, { saldo_acumulado: bal - amt, updated_at: serverTimestamp() });
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
              transaction.update(huchaRef, { saldo_acumulado: bal + amt, updated_at: serverTimestamp() });
            }
          } else {
            // Auto-reparto bancario estándar
            let remaining = amt;
            const huchasRefs = nextHuchasState.map(h => doc(db, 'huchas', h.id));
            const huchasSnaps = [];
            for (const ref of huchasRefs) {
              if (ref.id === createdCashHuchaId) {
                huchasSnaps.push({ id: ref.id, exists: () => true, data: () => ({ id: ref.id, nombre: 'Efectivo', tipo_aportacion: 'flat', valor_aportacion: 0, saldo_acumulado: 0 }) });
              } else {
                const snap = await transaction.get(ref);
                // Archived wallets keep their rule but take no part in the split.
                if (snap.data()?.activa !== false) huchasSnaps.push(snap);
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
          es_interno: isInternal,
          created_at: serverTimestamp()
        });
      });

      showToast('Movimiento registrado correctamente', 'success');
    } catch (error) {
      console.error('Error creating manual movement:', error);
      showToast('Error al registrar el movimiento.');
    }
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
            transaction.update(snap.ref, { saldo_acumulado: balance + (deltasPorHucha[snap.id] || 0), updated_at: serverTimestamp() });
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

    // Auto-unlink if it has any connections
    if ((mov.tipo === 'gasto' && ((mov.compensado_por?.length ?? 0) > 0 || (mov.compensado_por_detalles?.length ?? 0) > 0)) ||
        (mov.tipo === 'ingreso' && (mov.compensa_movimiento_id || (mov.compensaciones_destinos?.length ?? 0) > 0))) {
      await handleUnlinkMovimiento(mov);
    }

    const amt = Number(mov.importe);
    const isIngreso = mov.tipo === 'ingreso';

    if (!isFirebaseConfigured) {
      // 1. MODO DEMO
      let nextHuchas = [...huchas];

      if (!isIngreso) {
        // Gasto: revertir sumando de vuelta
        const hid = refundHuchaId(mov.hucha_id, huchas);
        nextHuchas = nextHuchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
      } else {
        // Ingreso: revertir restando
        if (mov.hucha_id) {
          nextHuchas = nextHuchas.map(h => h.id === mov.hucha_id ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
        } else {
          // Revertir auto-reparto estándar
          const deltas: Record<string, number> = {};
          let remaining = amt;
          const activeHuchas = nextHuchas.filter(h => h.activa !== false);
          // 1. Flat
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Porcentaje
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Resto
          const resto = activeHuchas.find(h => h.tipo_aportacion === 'resto') || activeHuchas.find(h => h.es_principal) || activeHuchas[0];
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

        if (!isIngreso) {
          // Gasto: revertir sumando de vuelta
          const hid = refundHuchaId(mov.hucha_id, huchas);
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
              const snap = await transaction.get(ref);
              // Archived wallets keep their rule but take no part in the split.
              if (snap.data()?.activa !== false) huchasSnaps.push(snap);
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
      });

      showToast('Movimiento eliminado', 'success');
    } catch (error) {
      console.error('Error deleting movement:', error);
      showToast('Error al eliminar el movimiento.');
    }
  };

  return { handleCreateManualMovimiento, handleDeleteMovimiento };
};

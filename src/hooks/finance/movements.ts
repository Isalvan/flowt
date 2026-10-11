import { sanitizeConcepto } from '../../utils/sanitize';
import { hasReviewApi, editReviewedMovement } from '../../utils/reviewApi';
import { doc, runTransaction, arrayUnion, serverTimestamp, deleteField } from 'firebase/firestore';
import { db } from '../../firebase';
import { type Movimiento, type Hucha } from '../../types';
import { cuentaEnEstadisticas } from '../../utils/movements';
import { validCategory as validCatalogCategory, compensationUpdates, unlinkCompensationUpdates } from '../../utils/movementSuggestions';
import type { FinanceContext } from './context';
import { redirectOverflowToResto, refundHuchaId } from './distribution';

export const createMovementHandlers = (context: Pick<
  FinanceContext,
  | 'isFirebaseConfigured'
  | 'movimientos'
  | 'saveDemoState'
  | 'huchas'
  | 'suscripciones'
  | 'userStats'
  | 'showToast'
  | 'user'
>) => {
  const {
    isFirebaseConfigured,
    movimientos,
    saveDemoState,
    huchas,
    suscripciones,
    userStats,
    showToast,
    user,
  } = context;


  const handleUpdateMovimientoConcepto = async (movId: string, newConcepto: string) => {
    const cleanConcepto = sanitizeConcepto(newConcepto, 200);
    if (!cleanConcepto) return;
    
    if (!isFirebaseConfigured) {
      const updated = movimientos.map(m => m.id === movId ? { ...m, concepto: cleanConcepto, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'concepto'])) } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      showToast('Concepto actualizado', 'success');
      return;
    }

    try {
      if (hasReviewApi()) {
        await editReviewedMovement(movId, { name: cleanConcepto });
        showToast('Concepto actualizado', 'success');
        return;
      }
      const movRef = doc(db, 'movimientos', movId);
      await runTransaction(db, async (transaction) => {
        transaction.update(movRef, { concepto: cleanConcepto, review_protected_fields: arrayUnion('concepto'), updated_at: serverTimestamp() });
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
      const updatedStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
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

        // Only apply overflow rules to the new income shares
        const { adjusted: deltas, overflow } = redirectOverflowToResto(shares, updatedHuchas);

        // Revert the expenditure by adding it back directly (ignoring topes, since it was already in the hucha)
        const refundId = refundHuchaId(mov.hucha_id, updatedHuchas);
        if (refundId) {
          deltas[refundId] = (deltas[refundId] || 0) + amount;
        }

        if (overflow > 0.01) {
          showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
        }

        updatedHuchas = updatedHuchas.map(h => {
          const delta = deltas[h.id] || 0;
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
        });

        if (cuentaEnEstadisticas(mov)) {
          updatedStats.total_ingresos += amount;
          updatedStats.total_gastos = Math.max(0, updatedStats.total_gastos - amount);
        }
      } else {
        // Ingreso -> Gasto (symmetrically reverts the multi-pocket income distribution, and subtracts the new expense from the target pocket)
        if (!targetHuchaId) return;

        // Recalculate original income splits using pocket rules to cleanly revert them
        const incomeDeltas: Record<string, number> = {};
        // An income paid into one wallet is undone from that wallet; only auto-distributed ones are recomputed.
        if (mov.hucha_id) incomeDeltas[mov.hucha_id] = amount;
        let remIncome = mov.hucha_id ? 0 : amount;
        const activeHuchas = updatedHuchas.filter(h => h.activa !== false);
        // 1. Flat
        activeHuchas.forEach(h => {
          if (h.tipo_aportacion === 'flat' && remIncome > 0) {
            const val = h.valor_aportacion || 0;
            const toAdd = Math.min(val, remIncome);
            incomeDeltas[h.id] = toAdd;
            remIncome -= toAdd;
          }
        });
        // 2. Percentage
        activeHuchas.forEach(h => {
          if (h.tipo_aportacion === 'porcentaje' && remIncome > 0) {
            const perc = h.valor_aportacion || 0;
            const share = amount * (perc / 100);
            const toAdd = Math.min(share, remIncome);
            incomeDeltas[h.id] = (incomeDeltas[h.id] || 0) + toAdd;
            remIncome -= toAdd;
          }
        });
        // 3. Rest
        const resto = activeHuchas.find(h => h.tipo_aportacion === 'resto') || activeHuchas.find(h => h.es_principal) || activeHuchas[0];
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

        if (cuentaEnEstadisticas(mov)) {
          updatedStats.total_ingresos = Math.max(0, updatedStats.total_ingresos - amount);
          updatedStats.total_gastos += amount;
        }
      }

      // Update movement details
      const updatedMovs = movimientos.map(m => {
        if (m.id === mov.id) {
          if (mov.tipo === 'gasto') {
            return { ...m, tipo: 'ingreso' as const, hucha_id: undefined, categoria: undefined, categoria_sugerida: undefined, categoria_confianza: undefined };
          } else {
            return { ...m, tipo: 'gasto' as const, hucha_id: targetHuchaId, categoria: undefined, categoria_sugerida: undefined, categoria_confianza: undefined };
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

        let overflow = 0;
        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'movimientos', mov.id);
          const movementSnapshot = await transaction.get(movRef);
          const current = movementSnapshot.data();
          // Already converted elsewhere, or edited since: applying it again would hand the expense back twice.
          if (!current || current.id_propietario !== user?.uid || current.tipo !== 'gasto' || Number(current.importe) !== amount) throw new Error('Movimiento no válido para convertir');
          const ids = Array.from(new Set([...huchas.map(h => h.id), ...rows.map(r => r.huchaId), current.hucha_id].filter(Boolean))) as string[];
          const currentHuchas: Hucha[] = [];
          for (const id of ids) {
            const snapshot = await transaction.get(doc(db, 'huchas', id));
            if (snapshot.exists()) {
              if (snapshot.data().id_propietario !== user?.uid) throw new Error('Hucha no válida');
              currentHuchas.push({ ...snapshot.data(), id } as Hucha);
            }
          }

          // Apply overflow rules ONLY to the new income distribution shares
          const distribution = redirectOverflowToResto(shares, currentHuchas);
          overflow = distribution.overflow;
          const deltas = distribution.adjusted;

          // Revert the expenditure by adding it back directly (ignoring topes, since it was previously subtracted)
          const refundId = refundHuchaId(current.hucha_id, currentHuchas);
          if (refundId) {
            deltas[refundId] = (deltas[refundId] || 0) + amount;
          }

          for (const hucha of currentHuchas) {
            const delta = deltas[hucha.id] ?? 0;
            if (delta) transaction.update(doc(db, 'huchas', hucha.id), {
              saldo_acumulado: Number((Number(hucha.saldo_acumulado || 0) + delta).toFixed(2)),
              updated_at: serverTimestamp(),
            });
          }

          transaction.update(movRef, { tipo: 'ingreso', hucha_id: deleteField(), categoria: deleteField(), categoria_sugerida: deleteField(), categoria_confianza: deleteField(), review_protected_fields: arrayUnion('hucha_id', 'categoria') });
        });
        if (overflow > 0.01) {
          showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
        }
        showToast('Movimiento convertido a ingreso', 'success');
      } else {
        if (!targetHuchaId) return;
        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'movimientos', mov.id);
          const movementSnapshot = await transaction.get(movRef);
          const current = movementSnapshot.data();
          // Already converted elsewhere, or edited since: applying it again would charge the expense twice.
          if (!current || current.id_propietario !== user?.uid || current.tipo !== 'ingreso' || Number(current.importe) !== amount) throw new Error('Movimiento no válido para convertir');

          // Fetch all huchas in transaction to read their rules and balances
          const huchasRefs = Array.from(new Set([...huchas.map(h => h.id), current.hucha_id].filter(Boolean))).map(id => doc(db, 'huchas', id));
          const huchasSnaps = [];
          for (const ref of huchasRefs) {
            huchasSnaps.push(await transaction.get(ref));
          }

          // Calculate the original income distribution splits using the hucha rules to revert them
          const incomeDeltas: Record<string, number> = {};
          // An income paid into one wallet is undone from that wallet; only auto-distributed ones are recomputed.
          if (current.hucha_id) incomeDeltas[current.hucha_id] = amount;
          let remIncome = current.hucha_id ? 0 : amount;
          // Archived wallets keep their rule but took no part in the split being undone.
          const activeSnaps = huchasSnaps.filter(s => s.data()?.activa !== false);
          // 1. Flat
          activeSnaps.forEach((snap) => {
            const data = snap.data();
            if (data && data.tipo_aportacion === 'flat' && remIncome > 0) {
              const val = data.valor_aportacion || 0;
              const toAdd = Math.min(val, remIncome);
              incomeDeltas[snap.id] = toAdd;
              remIncome -= toAdd;
            }
          });
          // 2. Percentage
          activeSnaps.forEach((snap) => {
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
          const restoSnap = activeSnaps.find(s => s.exists() && s.data()?.tipo_aportacion === 'resto')
                         || activeSnaps.find(s => s.exists() && s.data()?.es_principal)
                         || activeSnaps[0];
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
          transaction.update(movRef, { tipo: 'gasto', hucha_id: targetHuchaId, categoria: deleteField(), categoria_sugerida: deleteField(), categoria_confianza: deleteField(), review_protected_fields: arrayUnion('hucha_id', 'categoria') });
        });
        showToast('Movimiento convertido a gasto', 'success');
      }
    } catch (error) {
      console.error('Error convirtiendo movimiento:', error);
      showToast('Error al convertir el movimiento');
    }
  };

  const handleUpdateMovimientoCategoria = async (movId: string, categoria: string) => {
    try {
      if (!isFirebaseConfigured) {
        const movimiento = movimientos.find(m => m.id === movId);
        const custom = JSON.parse(localStorage.getItem('flowt-demo-categories') ?? '[]');
        if (!movimiento || !validCatalogCategory(categoria, movimiento.tipo, custom)) throw new Error('Categoría no válida');
        saveDemoState(movimientos.map(m => m.id === movId ? { ...m, categoria, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'categoria'])) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        if (hasReviewApi()) {
          await editReviewedMovement(movId, { category: categoria });
          showToast('Categoría confirmada', 'success');
          return;
        }
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'movimientos', movId);
          const snap = await transaction.get(ref);
          if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('Movimiento no válido');
          if (!validCatalogCategory(categoria, snap.data().tipo)) {
            if (!/^custom_[a-f0-9]{64}$/.test(categoria)) throw new Error('Categoría no válida');
            const category = await transaction.get(doc(db, 'categorias', user.uid, 'items', categoria));
            if (!category.exists() || ![snap.data().tipo, 'ambos'].includes(category.data().tipo)) throw new Error('Categoría no válida');
          }
          transaction.update(ref, { categoria, review_protected_fields: arrayUnion('categoria'), updated_at: serverTimestamp() });
        });
      }
      showToast('Categoría confirmada', 'success');
    } catch (error) {
      showToast('No se ha podido guardar la categoría', 'error');
      throw error;
    }
  };

  const handleDismissCompensation = async (ingresoId: string, gastoId: string) => {
    if (!isFirebaseConfigured) {
      const updated = movimientos.map(m => m.id === ingresoId ? { ...m, compensaciones_descartadas: Array.from(new Set([...(m.compensaciones_descartadas || []), gastoId])) } : m);
      saveDemoState(updated, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      return;
    }
    if (!user) throw new Error('Inicia sesión para guardar');
    await runTransaction(db, async transaction => {
      const ref = doc(db, 'movimientos', ingresoId);
      const snap = await transaction.get(ref);
      if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('El ingreso no está disponible');
      const descartadas = snap.data().compensaciones_descartadas || [];
      if (descartadas.length >= 200 && !descartadas.includes(gastoId)) throw new Error('Se ha alcanzado el límite de propuestas descartadas para este ingreso');
      transaction.update(ref, { compensaciones_descartadas: Array.from(new Set([...descartadas, gastoId])), updated_at: serverTimestamp() });
    });
  };

  const handleLinkMovimiento = async (baseMov: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => {
    try {
      if (!isFirebaseConfigured) {
        const base = movimientos.find(m => m.id === baseMov.id);
        if (!base) throw new Error('El movimiento no está disponible');
        const currentAllocations = allocations.map(a => {
          const mov = movimientos.find(m => m.id === a.mov.id);
          if (!mov) throw new Error('Un movimiento no está disponible');
          return { mov, importe: a.importe };
        });
        const updates = compensationUpdates(base, currentAllocations);
        saveDemoState(movimientos.map(m => updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        await runTransaction(db, async transaction => {
          const refs = [doc(db, 'movimientos', baseMov.id), ...allocations.map(a => doc(db, 'movimientos', a.mov.id))];
          const snaps = await Promise.all(refs.map(ref => transaction.get(ref)));
          const current = snaps.map(snap => {
            if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('Un movimiento no está disponible');
            return { ...snap.data(), id: snap.id } as Movimiento;
          });
          const updates = compensationUpdates(current[0], allocations.map((a, i) => ({ mov: current[i + 1], importe: a.importe })));
          for (const [id, update] of updates) transaction.update(doc(db, 'movimientos', id), { ...update, updated_at: serverTimestamp() });
        });
      }
      showToast('Compensación registrada correctamente', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error al vincular', 'error');
      throw error;
    }
  };

  const handleUnlinkMovimiento = async (base: Movimiento, target?: Movimiento) => {
    const relatedIds = (m: Movimiento) => target ? [target.id] : Array.from(new Set(m.tipo === 'gasto'
      ? [...(m.compensado_por || []), ...(m.compensado_por_detalles || []).map(d => d.ingreso_id)]
      : [...(m.compensa_movimiento_id ? [m.compensa_movimiento_id] : []), ...(m.compensaciones_destinos || []).map(d => d.gasto_id)]));
    try {
      if (!isFirebaseConfigured) {
        const current = movimientos.find(m => m.id === base.id);
        if (!current) throw new Error('El movimiento no está disponible');
        const ids = relatedIds(current);
        const updates = unlinkCompensationUpdates(current, movimientos.filter(m => ids.includes(m.id)));
        saveDemoState(movimientos.map(m => updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m), huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      } else {
        if (!user) throw new Error('Inicia sesión para guardar');
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'movimientos', base.id);
          const snap = await transaction.get(ref);
          if (!snap.exists() || snap.data().id_propietario !== user.uid) throw new Error('El movimiento no está disponible');
          const current = { ...snap.data(), id: snap.id } as Movimiento;
          const relatedSnaps = await Promise.all(relatedIds(current).map(id => transaction.get(doc(db, 'movimientos', id))));
          const related = relatedSnaps.filter(s => s.exists()).map(s => {
            if (s.data().id_propietario !== user.uid) throw new Error('Un movimiento no está disponible');
            return { ...s.data(), id: s.id } as Movimiento;
          });
          const updates = unlinkCompensationUpdates(current, related);
          for (const [id, update] of updates) {
            const fields = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, value === undefined ? deleteField() : value]));
            transaction.update(doc(db, 'movimientos', id), { ...fields, updated_at: serverTimestamp() });
          }
        });
      }
      showToast('Compensación deshecha', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Error al desvincular', 'error');
    }
  };

  const handleChangeMovimientoHucha = async (mov: Movimiento, newHuchaId: string) => {
    if (!newHuchaId || mov.hucha_id === newHuchaId) return;
    const oldHuchaId = mov.hucha_id;

    // La hucha antigua recibe +importe (revertir el gasto). Pasar por el tope.
    const rawDeltas: Record<string, number> = oldHuchaId
      ? { [oldHuchaId]: mov.importe }
      : {};
    const { adjusted: changeDeltas, overflow: changeOverflow } =
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

      const updatedMovs = movimientos.map(m => m.id === mov.id ? { ...m, hucha_id: newHuchaId, review_protected_fields: Array.from(new Set([...(m.review_protected_fields ?? []), 'hucha_id'])) } : m);
      saveDemoState(updatedMovs, updatedHuchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 });
      if (changeOverflow > 0.01) {
        showToast(`${changeOverflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }
      showToast('Gasto reasignado', 'success');
      return;
    }

    try {
      if (hasReviewApi()) {
        await editReviewedMovement(mov.id, { hucha_id: newHuchaId });
        showToast('Gasto reasignado', 'success');
        return;
      }
      await runTransaction(db, async (transaction) => {
        const movRef = doc(db, 'movimientos', mov.id);
        const movementSnapshot = await transaction.get(movRef);
        const current = movementSnapshot.data();
        if (!current || current.id_propietario !== user?.uid || current.tipo !== 'gasto' || current.es_interno || current.es_metalico) throw new Error('Movimiento no válido para reasignar');
        if (current.hucha_id === newHuchaId) return;
        const ids = Array.from(new Set([...huchas.map(h => h.id), newHuchaId, current.hucha_id].filter(Boolean))) as string[];
        const currentHuchas: Hucha[] = [];
        for (const id of ids) {
          const snapshot = await transaction.get(doc(db, 'huchas', id));
          if (snapshot.exists()) {
            if (snapshot.data().id_propietario !== user?.uid) throw new Error('Hucha no válida');
            currentHuchas.push({ ...snapshot.data(), id } as Hucha);
          }
        }
        const target = currentHuchas.find(h => h.id === newHuchaId);
        if (!target || target.activa === false || target.es_metalico || target.es_interno) throw new Error('Elige una hucha activa');
        if (!current.hucha_id || !currentHuchas.some(h => h.id === current.hucha_id)) throw new Error('La hucha original ya no está disponible');
        const raw = { [current.hucha_id]: Number(current.importe) };
        const { adjusted } = redirectOverflowToResto(raw, currentHuchas);
        adjusted[newHuchaId] = (adjusted[newHuchaId] ?? 0) - Number(current.importe);
        if (Math.abs(Object.values(adjusted).reduce((total, amount) => total + amount, 0)) > 0.005) throw new Error('No hay capacidad para reasignar sin perder saldo');
        for (const hucha of currentHuchas) {
          const delta = adjusted[hucha.id] ?? 0;
          if (delta) transaction.update(doc(db, 'huchas', hucha.id), {
            saldo_acumulado: Number((Number(hucha.saldo_acumulado || 0) + delta).toFixed(2)),
            updated_at: serverTimestamp(),
          });
        }

        transaction.update(movRef, {
          hucha_id: newHuchaId,
          review_protected_fields: arrayUnion('hucha_id'),
          updated_at: serverTimestamp(),
        });
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

  return { handleUpdateMovimientoConcepto, handleConvertMovimiento, handleUpdateMovimientoCategoria, handleDismissCompensation, handleLinkMovimiento, handleUnlinkMovimiento, handleChangeMovimientoHucha };
};

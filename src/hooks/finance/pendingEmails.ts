import { type Movimiento } from '../../types';
import { runTransaction, doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeConcepto } from '../../utils/sanitize';
import type { FinanceContext } from './context';


export const createPendingEmailHandlers = (context: Pick<
  FinanceContext,
  | 'isFirebaseConfigured'
  | 'huchas'
  | 'movimientos'
  | 'userStats'
  | 'pendingEmails'
  | 'saveDemoState'
  | 'suscripciones'
  | 'showToast'
  | 'user'
>) => {
  const {
    isFirebaseConfigured,
    huchas,
    movimientos,
    userStats,
    pendingEmails,
    saveDemoState,
    suscripciones,
    showToast,
    user,
  } = context;


  const handleApprovePendingEmail = async (
    emailId: string, 
    movData: { tipo: 'ingreso' | 'gasto', concepto: string, importe: number, fecha_operacion: string, hucha_id?: string }
  ) => {
    const amt = Number(movData.importe);
    const isIngreso = movData.tipo === 'ingreso';

    if (!isFirebaseConfigured) {
      // Demo Mode Approval
      const id = 'm-' + Math.random().toString(36).substr(2, 9);
      const newMov: Movimiento = {
        id,
        tipo: movData.tipo,
        concepto: movData.concepto,
        importe: amt,
        fecha_operacion: new Date(movData.fecha_operacion),
        hucha_id: movData.hucha_id
      };

      let nextHuchas = [...huchas];
      if (!isIngreso) {
        const hid = movData.hucha_id || huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id;
        nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado - amt).toFixed(2)) } : h);
      } else {
        const hid = movData.hucha_id;
        if (hid) {
          nextHuchas = huchas.map(h => h.id === hid ? { ...h, saldo_acumulado: Number((h.saldo_acumulado + amt).toFixed(2)) } : h);
        } else {
          // Distribute
          const deltas: Record<string, number> = {};
          let remaining = amt;
          const activeHuchas = huchas.filter(h => h.activa !== false);
          // 1. Flat
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'flat' && remaining > 0) {
              const val = h.valor_aportacion || 0;
              const toAdd = Math.min(val, remaining);
              deltas[h.id] = toAdd;
              remaining -= toAdd;
            }
          });
          // 2. Percentage
          activeHuchas.forEach(h => {
            if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
              const perc = h.valor_aportacion || 0;
              const share = amt * (perc / 100);
              const toAdd = Math.min(share, remaining);
              deltas[h.id] = (deltas[h.id] || 0) + toAdd;
              remaining -= toAdd;
            }
          });
          // 3. Rest
          const resto = activeHuchas.find(h => h.tipo_aportacion === 'resto') || activeHuchas.find(h => h.es_principal) || activeHuchas[0];
          if (resto && remaining > 0) {
            deltas[resto.id] = (deltas[resto.id] || 0) + remaining;
          }
          // Add deltas
          nextHuchas = huchas.map(h => {
            const delta = deltas[h.id] || 0;
            return { ...h, saldo_acumulado: Number((h.saldo_acumulado + delta).toFixed(2)) };
          });
        }
      }

      const nextMovs = [newMov, ...movimientos];
      const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
      if (isIngreso) nextStats.total_ingresos += amt;
      else nextStats.total_gastos += amt;

      const nextPending = pendingEmails.filter(p => p.id !== emailId);

      saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats, nextPending);
      showToast('Movimiento aprobado y registrado', 'success');
      return;
    }

    // Firebase Mode Approval
    try {
      await runTransaction(db, async (transaction) => {
        const emailRef = doc(db, 'correos_pendientes', emailId);

        // 1. Idempotency Check: Fetch pending email doc inside transaction
        const emailSnap = await transaction.get(emailRef);
        if (!emailSnap.exists() || emailSnap.data()?.procesado === true) {
          throw new Error('EMAIL_ALREADY_PROCESSED');
        }

        const movRef = doc(collection(db, 'movimientos'));
        const statsRef = doc(db, 'stats', user!.uid);
        const statsSnap = await transaction.get(statsRef);

        // Get selected hucha (or principal)
        let targetHuchaId = movData.hucha_id;
        if (!isIngreso && !targetHuchaId) {
          targetHuchaId = huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id;
        }

        const distributions: Record<string, number> = {};

        if (!isIngreso) {
          // Expense
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal - amt, updated_at: serverTimestamp() });
            }
          }
        } else {
          // Income distribution
          if (targetHuchaId) {
            const huchaRef = doc(db, 'huchas', targetHuchaId);
            const huchaSnap = await transaction.get(huchaRef);
            if (huchaSnap.exists()) {
              const bal = huchaSnap.data().saldo_acumulado || 0;
              transaction.update(huchaRef, { saldo_acumulado: bal + amt, updated_at: serverTimestamp() });
            }
          } else {
            // Standard auto-reparto
            let remaining = amt;
            // Fetch current huchas in transaction
            const huchasRefs = huchas.map(h => doc(db, 'huchas', h.id));
            const huchasSnaps = [];
            for (const ref of huchasRefs) {
              const snap = await transaction.get(ref);
              // Archived wallets keep their rule but take no part in the split.
              if (snap.data()?.activa !== false) huchasSnaps.push(snap);
            }

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
            // 2. Percentage
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
            // 3. Rest
            const restoSnap = huchasSnaps.find(s => s.exists() && s.data()?.tipo_aportacion === 'resto')
                           || huchasSnaps.find(s => s.exists() && s.data()?.es_principal)
                           || huchasSnaps[0];
            if (restoSnap && remaining > 0) {
              distributions[restoSnap.id] = (distributions[restoSnap.id] || 0) + remaining;
            }

            // Apply balances updates
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

        // Create movement document
        transaction.set(movRef, {
          id_propietario: user!.uid,
          tipo: movData.tipo,
          concepto: sanitizeConcepto(movData.concepto, 200),
          importe: amt,
          fecha_operacion: new Date(movData.fecha_operacion),
          hucha_id: targetHuchaId || null,
          id_correo_origen: emailSnap.data().email_id,
          review_protected_fields: movData.hucha_id ? ['concepto', 'hucha_id'] : ['concepto'],
          created_at: serverTimestamp()
        });

        // Durable handoff is committed together with the approved movement.
        // The synchronizer publishes it only after validating initial processing.
        transaction.set(doc(db, 'review_handoffs', movRef.id), {
          id_propietario: user!.uid,
          movement_id: movRef.id,
          email_id: emailSnap.data().email_id,
          created_at: serverTimestamp(),
        });

        const currentStats = statsSnap.exists() ? statsSnap.data() : {};
        transaction.set(statsRef, {
          total_ingresos: Number(currentStats.total_ingresos || 0) + (isIngreso ? amt : 0),
          total_gastos: Number(currentStats.total_gastos || 0) + (isIngreso ? 0 : amt),
          updated_at: serverTimestamp(),
        }, { merge: true });

        // Delete pending email from manual queue
        transaction.delete(emailRef);
      });

      showToast('Movimiento aprobado y registrado', 'success');
    } catch (error: any) {
      if (error?.message === 'EMAIL_ALREADY_PROCESSED') {
        showToast('Este correo ya fue procesado o descartado en otra sesión.');
        return;
      }
      console.error('Error approving pending email:', error);
      showToast('Error al registrar el movimiento.');
    }
  };

  const handleDiscardPendingEmail = async (emailId: string) => {
    if (!isFirebaseConfigured) {
      const nextPending = pendingEmails.filter(p => p.id !== emailId);
      saveDemoState(movimientos, huchas, suscripciones, userStats || { total_ingresos: 0, total_gastos: 0 }, nextPending);
      showToast('Correo descartado', 'success');
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const emailRef = doc(db, 'correos_pendientes', emailId);
        const emailSnap = await transaction.get(emailRef);
        if (!emailSnap.exists()) {
          throw new Error('EMAIL_ALREADY_PROCESSED');
        }
        transaction.delete(emailRef);
      });
      showToast('Correo descartado', 'success');
    } catch (error: any) {
      if (error?.message === 'EMAIL_ALREADY_PROCESSED') {
        showToast('Este correo ya fue procesado o descartado en otra sesión.');
        return;
      }
      console.error('Error discarding email:', error);
      showToast('Error al descartar el correo.');
    }
  };

  return { handleApprovePendingEmail, handleDiscardPendingEmail };
};

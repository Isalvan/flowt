import { type Hucha, type Suscripcion, type Movimiento, type PendingEmail } from '../../types';
import type { FinanceContext } from './context';
import { redirectOverflowToResto } from './distribution';

// Initial Mock Data for outstanding user experience in Demo Mode
const MOCK_HUCHAS: Hucha[] = [
  { id: 'h-1', nombre: 'Fondo de Emergencia', saldo_acumulado: 4500, objetivo: 8000, tipo_aportacion: 'resto', orden: 1, es_principal: true, tope_objetivo: false },
  { id: 'h-2', nombre: 'Viaje a Japón', saldo_acumulado: 1200, objetivo: 4000, tipo_aportacion: 'porcentaje', valor_aportacion: 15, orden: 2, es_principal: false, tope_objetivo: true },
  { id: 'h-3', nombre: 'Suscripciones', saldo_acumulado: 45.97, objetivo: 45.97, tipo_aportacion: 'flat', valor_aportacion: 45.97, orden: 3, es_principal: false, es_suscripciones: true, tope_objetivo: true },
  { id: 'h-4', nombre: 'Inversiones', saldo_acumulado: 850, objetivo: 5000, tipo_aportacion: 'porcentaje', valor_aportacion: 20, orden: 4, es_principal: false, tope_objetivo: false },
];

const MOCK_SUSCRIPCIONES: Suscripcion[] = [
  { id: 's-1', nombre: 'Netflix Premium', importe: 17.99, frecuencia: 'mensual', dia_pago: 12, categoria: 'streaming', color: '#ef4444', activa: true, hucha_id: 'h-3' },
  { id: 's-2', nombre: 'Spotify Duo', importe: 14.99, frecuencia: 'mensual', dia_pago: 20, categoria: 'musica', color: '#22c55e', activa: true, hucha_id: 'h-3', mi_parte: 7.50 },
  { id: 's-3', nombre: 'Amazon Prime', importe: 49.90, frecuencia: 'anual', dia_pago: 5, categoria: 'streaming', color: '#0ea5e9', activa: true, hucha_id: 'h-3' },
  { id: 's-4', nombre: 'Gimnasio', importe: 29.99, frecuencia: 'mensual', dia_pago: 2, categoria: 'fitness', color: '#f97316', activa: false },
];

const MOCK_MOVIMIENTOS: Movimiento[] = [
  { id: 'm-1', tipo: 'ingreso', concepto: 'Nómina Abril', importe: 2450.00, fecha_operacion: new Date(2026, 3, 30) },
  { id: 'm-2', tipo: 'gasto', concepto: 'Súper Mercadona', importe: 84.50, fecha_operacion: new Date(2026, 4, 2), hucha_id: 'h-1' },
  { id: 'm-3', tipo: 'gasto', concepto: 'Netflix (Mensual)', importe: 17.99, fecha_operacion: new Date(2026, 4, 12), hucha_id: 'h-3' },
  { id: 'm-4', tipo: 'ingreso', concepto: 'Bizum: Cena de ayer (Compensación)', importe: 22.50, fecha_operacion: new Date(2026, 4, 16), compensa_movimiento_id: 'm-5' },
  { id: 'm-5', tipo: 'gasto', concepto: 'Cena Amigos Restaurante', importe: 45.00, fecha_operacion: new Date(2026, 4, 15), hucha_id: 'h-1', compensado_por: ['m-4'], importe_neto: 22.50 },
  { id: 'm-6', tipo: 'ingreso', concepto: 'Venta Wallapop', importe: 120.00, fecha_operacion: new Date(2026, 4, 18) },
];

const MOCK_PENDING_EMAILS: PendingEmail[] = [
  {
    id: 'pend-1',
    email_id: 'gmail-101',
    cuerpo: `Asunto: Notificación de cargo\nEstimado cliente,\nLe informamos de un cargo de 24,99 EUR en su tarjeta con fecha 22/05/2026 en el comercio DISCORD*NITRO.\nGracias por su confianza.`,
    fecha_envio: 'Sat, 22 May 2026 14:32:00 +0200',
    motivo: 'Fallo total en extracción automática',
    procesado: false,
    created_at: new Date()
  },
  {
    id: 'pend-2',
    email_id: 'gmail-102',
    cuerpo: `Asunto: Abono recibido\nHola! Te enviaron un Bizum de 12,00 EUR el 23/05/2026. Concepto: Cena de ayer.\nQue tengas un buen día!`,
    fecha_envio: 'Sun, 23 May 2026 09:15:00 +0200',
    motivo: 'Fallo total en extracción automática',
    procesado: false,
    created_at: new Date()
  }
];

export const createDemoStateHelpers = (context: Pick<
  FinanceContext,
  | 'setIsFirebaseConfigured'
  | 'setMovimientos'
  | 'setChartMovements'
  | 'setHuchas'
  | 'setSuscripciones'
  | 'setUserStats'
  | 'setPendingEmails'
  | 'setChartMovementsLoading'
  | 'setLoading'
  | 'pendingEmails'
>) => {
  const {
    setIsFirebaseConfigured,
    setMovimientos,
    setChartMovements,
    setHuchas,
    setSuscripciones,
    setUserStats,
    setPendingEmails,
    setChartMovementsLoading,
    setLoading,
    pendingEmails,
  } = context;


  /** Helper: loads demo data from localStorage or falls back to mocks */
  const loadDemoData = () => {
    setIsFirebaseConfigured(false);
    const localMovs = localStorage.getItem('flowt-demo-movimientos');
    const localHuchas = localStorage.getItem('flowt-demo-huchas');
    const localSubs = localStorage.getItem('flowt-demo-suscripciones');
    const localStats = localStorage.getItem('flowt-demo-stats');
    const localPending = localStorage.getItem('flowt-demo-pending');

    if (localMovs && localHuchas && localSubs && localStats && localPending) {
      setMovimientos(JSON.parse(localMovs));
      setChartMovements(JSON.parse(localMovs));
      setHuchas(JSON.parse(localHuchas));
      setSuscripciones(JSON.parse(localSubs));
      setUserStats(JSON.parse(localStats));
      setPendingEmails(JSON.parse(localPending));
    } else {
      setMovimientos(MOCK_MOVIMIENTOS);
      setChartMovements(MOCK_MOVIMIENTOS);
      setHuchas(MOCK_HUCHAS);
      setSuscripciones(MOCK_SUSCRIPCIONES);
      setPendingEmails(MOCK_PENDING_EMAILS);
      const initialStats = { total_ingresos: 2592.50, total_gastos: 147.49 };
      setUserStats(initialStats);
      localStorage.setItem('flowt-demo-movimientos', JSON.stringify(MOCK_MOVIMIENTOS));
      localStorage.setItem('flowt-demo-huchas', JSON.stringify(MOCK_HUCHAS));
      localStorage.setItem('flowt-demo-suscripciones', JSON.stringify(MOCK_SUSCRIPCIONES));
      localStorage.setItem('flowt-demo-stats', JSON.stringify(initialStats));
      localStorage.setItem('flowt-demo-pending', JSON.stringify(MOCK_PENDING_EMAILS));
    }
    setChartMovementsLoading(false);
    setLoading(false);
  };

  // Save Demo helper
  const saveDemoState = (
    newMovs: Movimiento[], 
    newHuchas: Hucha[], 
    newSubs: Suscripcion[], 
    newStats: { total_ingresos: number, total_gastos: number },
    newPending?: PendingEmail[]
  ) => {
    setMovimientos(newMovs);
    setChartMovements(newMovs);
    setHuchas(newHuchas);
    setSuscripciones(newSubs);
    setUserStats(newStats);
    
    const currentPending = newPending !== undefined ? newPending : pendingEmails;
    setPendingEmails(currentPending);
    localStorage.setItem('flowt-demo-pending', JSON.stringify(currentPending));
    
    localStorage.setItem('flowt-demo-movimientos', JSON.stringify(newMovs));
    localStorage.setItem('flowt-demo-huchas', JSON.stringify(newHuchas));
    localStorage.setItem('flowt-demo-suscripciones', JSON.stringify(newSubs));
    localStorage.setItem('flowt-demo-stats', JSON.stringify(newStats));
  };

  return { loadDemoData, saveDemoState };
};

export const createDemoDistribution = (context: Pick<
  FinanceContext,
  | 'huchas'
  | 'showToast'
>) => {
  const { huchas, showToast } = context;


  // Re-runs the income/expense allocations on Demo local memory
  const processLocalDistribution = (tipo: 'ingreso' | 'gasto', importe: number, huchaId?: string): Hucha[] => {
    let updatedHuchas = [...huchas];
    const activeHuchas = updatedHuchas.filter(h => h.activa !== false);
    if (tipo === 'gasto') {
      const targetHuchaId = huchaId || activeHuchas.find(h => h.es_principal)?.id || activeHuchas[0]?.id;
      updatedHuchas = updatedHuchas.map(h => {
        if (h.id === targetHuchaId) {
          return { ...h, saldo_acumulado: Math.max(0, h.saldo_acumulado - importe) };
        }
        return h;
      });
    } else {
      // Income distribution algorithm
      let remaining = importe;
      const rawDeltas: Record<string, number> = {};

      // 1. Flat amounts
      activeHuchas.forEach(h => {
        if (h.tipo_aportacion === 'flat' && remaining > 0) {
          const val = h.valor_aportacion || 0;
          let toAdd = Math.min(val, remaining);
          remaining -= toAdd;
          
          if ((h.deuda_pendiente || 0) > 0) {
            const payment = Math.min(h.deuda_pendiente!, toAdd);
            h.deuda_pendiente! -= payment;
            toAdd -= payment;
            if (h.deuda_con) {
              rawDeltas[h.deuda_con] = (rawDeltas[h.deuda_con] || 0) + payment;
            }
          }
          rawDeltas[h.id] = (rawDeltas[h.id] || 0) + toAdd;
        }
      });

      // 2. Percentages
      activeHuchas.forEach(h => {
        if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
          const perc = h.valor_aportacion || 0;
          const share = importe * (perc / 100);
          let toAdd = Math.min(share, remaining);
          remaining -= toAdd;

          if ((h.deuda_pendiente || 0) > 0) {
            const payment = Math.min(h.deuda_pendiente!, toAdd);
            h.deuda_pendiente! -= payment;
            toAdd -= payment;
            if (h.deuda_con) {
              rawDeltas[h.deuda_con] = (rawDeltas[h.deuda_con] || 0) + payment;
            }
          }
          rawDeltas[h.id] = (rawDeltas[h.id] || 0) + toAdd;
        }
      });

      // 3. Rest remainder
      const restoHucha = activeHuchas.find(h => h.tipo_aportacion === 'resto') 
                     || activeHuchas.find(h => h.es_principal)
                     || activeHuchas[0];
      if (restoHucha && remaining > 0) {
        let toAdd = remaining;
        remaining = 0;
        
        if ((restoHucha.deuda_pendiente || 0) > 0) {
          const payment = Math.min(restoHucha.deuda_pendiente!, toAdd);
          restoHucha.deuda_pendiente! -= payment;
          toAdd -= payment;
          if (restoHucha.deuda_con) {
            rawDeltas[restoHucha.deuda_con] = (rawDeltas[restoHucha.deuda_con] || 0) + payment;
          }
        }
        rawDeltas[restoHucha.id] = (rawDeltas[restoHucha.id] || 0) + toAdd;
      }

      // Apply redirect overflow boundaries (topes)
      const { adjusted: finalDeltas, overflow } = redirectOverflowToResto(rawDeltas, activeHuchas);
      if (overflow > 0.01) {
        showToast(`${overflow.toFixed(2)} € sin asignar: todas las huchas están llenas`);
      }

      updatedHuchas = updatedHuchas.map(h => {
        if (finalDeltas[h.id]) {
          return { ...h, saldo_acumulado: Number((h.saldo_acumulado + finalDeltas[h.id]).toFixed(2)) };
        }
        return h;
      });
    }
    return updatedHuchas;
  };

  return { processLocalDistribution };
};

export const createDemoSimulator = (context: Pick<
  FinanceContext,
  | 'isFirebaseConfigured'
  | 'huchas'
  | 'processLocalDistribution'
  | 'movimientos'
  | 'userStats'
  | 'saveDemoState'
  | 'suscripciones'
  | 'showToast'
>) => {
  const {
    isFirebaseConfigured,
    huchas,
    processLocalDistribution,
    movimientos,
    userStats,
    saveDemoState,
    suscripciones,
    showToast,
  } = context;


  // ----------------------------------------------------
  // Interactive Demo Simulator Method
  // ----------------------------------------------------
  const injectDemoMovement = (tipo: 'ingreso' | 'gasto', concepto: string, importe: number, selectedHuchaId?: string) => {
    if (isFirebaseConfigured) return; // Only allowed in Demo Mode

    const id = 'm-' + Math.random().toString(36).substr(2, 9);
    const addedMov: Movimiento = {
      id,
      tipo,
      concepto,
      importe,
      fecha_operacion: new Date(),
      hucha_id: tipo === 'gasto' ? (selectedHuchaId || huchas.find(h => h.es_principal && h.activa !== false)?.id || huchas.find(h => h.activa !== false)?.id) : undefined
    };

    const nextHuchas = processLocalDistribution(tipo, importe, addedMov.hucha_id);
    const nextMovs = [addedMov, ...movimientos];

    const nextStats = { ...(userStats || { total_ingresos: 0, total_gastos: 0 }) };
    if (tipo === 'ingreso') {
      nextStats.total_ingresos += importe;
    } else {
      nextStats.total_gastos += importe;
    }

    saveDemoState(nextMovs, nextHuchas, suscripciones, nextStats);
    showToast(`Movimiento inyectado: ${concepto} (${tipo === 'ingreso' ? '+' : '-'}${importe} €)`, 'success');
  };

  return { injectDemoMovement };
};

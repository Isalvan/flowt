import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { WriteBatch, DocumentReference } from 'firebase/firestore';
import type { Movimiento, Hucha, Suscripcion, PendingEmail, CorreoHistorico } from '../../types';

type Setter<T> = Dispatch<SetStateAction<T>>;
type Stats = { total_ingresos: number; total_gastos: number };
type ConfirmModal = { title: string; message: string; confirmLabel?: string; onConfirm: () => void };

type OlderSession = { uid: string | undefined; isFirebaseConfigured: boolean; isLocked: boolean; forceDemo: boolean; active: boolean; requested: boolean };
type OlderState = { session: OlderSession; movements: Movimiento[]; status: 'loading' | 'loaded' | 'error' };

export interface FinanceContext {
  uid: string | undefined;
  olderSession: OlderSession;
  setOlderState: Setter<OlderState | null>;
  user: User | null;
  loading: boolean;
  isFirebaseConfigured: boolean;
  isLocked: boolean;
  forceDemo: boolean;
  windowStart: Date;
  movimientos: Movimiento[];
  chartMovements: Movimiento[];
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  pendingEmails: PendingEmail[];
  userStats: Stats | null;
  setUser: Setter<User | null>;
  setLoading: Setter<boolean>;
  setIsFirebaseConfigured: Setter<boolean>;
  setMovimientos: Setter<Movimiento[]>;
  setChartMovements: Setter<Movimiento[]>;
  setChartMovementsLoading: Setter<boolean>;
  setHuchas: Setter<Hucha[]>;
  setSuscripciones: Setter<Suscripcion[]>;
  setPendingEmails: Setter<PendingEmail[]>;
  setHistoricoCorreos: Setter<CorreoHistorico[]>;
  setUserStats: Setter<Stats | null>;
  setConfirmModal: Setter<ConfirmModal | null>;
  showToast: (message: string, type?: 'error' | 'success') => void;
  loadDemoData: () => void;
  saveDemoState: (newMovs: Movimiento[], newHuchas: Hucha[], newSubs: Suscripcion[], newStats: Stats, newPending?: PendingEmail[]) => void;
  processLocalDistribution: (tipo: 'ingreso' | 'gasto', importe: number, huchaId?: string) => Hucha[];
  handleUnlinkMovimiento: (base: Movimiento, target?: Movimiento) => Promise<void>;
  syncSuscripcionesHucha: (updatedList: Suscripcion[], localHuchasState?: Hucha[]) => Promise<Hucha[] | undefined>;
  queueSuscripcionesHuchaSync: (batch: WriteBatch, updatedList: Suscripcion[], currentHuchas: Hucha[], preferredRef?: DocumentReference) => DocumentReference | null;
}

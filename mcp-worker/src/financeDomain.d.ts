/** Money is in euros on wallets and recorded movements, and cents in domain plans. */
export interface Wallet {
  activa?: boolean;
  orden?: number;
  tipo_aportacion?: 'flat' | 'porcentaje' | 'resto';
  valor_aportacion?: number;
  saldo_acumulado?: number;
  objetivo?: number | null;
  tope_objetivo?: boolean;
  extra_importe?: number | null;
  extra_meses?: number[] | null;
  extra_ultimo?: string | null;
  es_principal?: boolean;
  es_suscripciones?: boolean;
  es_metalico?: boolean;
  deuda_pendiente?: number;
  deuda_con?: string | null;
}

export interface Split {
  saldos: Record<string, number>;
  deudas: Record<string, { importe: number; con: string }>;
  extras?: Record<string, string>;
}

export function cents(value: number): number;
export function euros(value: number): number;
export function percentOf(amount: number, percent: number): number;
export function room(hucha: Wallet, pending?: number): number | null;
export function fallbackHucha(huchas: Record<string, Wallet>, exclude?: string[]): string | null;
export interface PayrollMovement {
  categoria?: string | null;
  categoria_sugerida?: string | null;
  concepto?: string;
  fecha_operacion?: unknown;
}
export function isPayroll(movement: PayrollMovement): boolean;
export function extraMonth(movement: PayrollMovement): string | null;
export function distributeIncome(amountCents: number, huchas: Record<string, Wallet>, plain?: boolean, extraMonth?: string | null): Split;
export function incomeReversal(movement: { importe: number; reparto_aplicado?: Split | null }, huchas: Record<string, Wallet>): Split;
export function recordedSplit(split: Split): Split;

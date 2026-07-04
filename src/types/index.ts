export interface Movimiento {
  id: string;
  tipo: 'gasto' | 'ingreso';
  concepto: string;
  importe: number;
  fecha_operacion: any; // Firestore Timestamp, Date, or string representation
  hucha_id?: string;
  id_propietario?: string;
  es_metalico?: boolean;
  // Compensación entre movimientos (Legacy 1:N)
  compensa_movimiento_id?: string | null; 
  compensado_por?: string[] | null;       
  
  // Compensación M:N (Nativo con cantidades)
  compensaciones_destinos?: { gasto_id: string; importe: number }[] | null; // solo en ingresos
  compensado_por_detalles?: { ingreso_id: string; importe: number }[] | null; // solo en gastos
  
  importe_neto?: number | null;           // solo en gastos compensados: importe efectivo restante
  created_at?: any;
  updated_at?: any;
}

export interface Hucha {
  id: string;
  nombre: string;
  saldo_acumulado: number;
  objetivo: number | null;
  tipo_aportacion: 'flat' | 'porcentaje' | 'resto';
  valor_aportacion?: number;
  orden: number;
  es_principal?: boolean;
  es_suscripciones?: boolean;
  es_metalico?: boolean;
  activa?: boolean;
  tope_objetivo?: boolean;
  id_propietario?: string;
  created_at?: any;
  updated_at?: any;
}

export interface Suscripcion {
  id: string;
  nombre: string;
  importe: number;
  frecuencia: 'mensual' | 'trimestral' | 'semestral' | 'anual';
  dia_pago: number;
  categoria: string;
  color: string;
  activa: boolean;
  cancelando?: boolean;
  hucha_id?: string | null;
  // Si la suscripción es compartida con otras personas, "mi_parte" es la cuota
  // real del usuario en € (el resto lo reembolsan los demás vía bizum, etc.).
  // Si null/undefined, la suscripción es íntegra del usuario.
  mi_parte?: number | null;
  id_propietario?: string;
  created_at?: any; // Firestore Timestamp or null for old records
  updated_at?: any;
}

export interface PendingEmail {
  id: string;
  email_id: string;
  cuerpo: string;
  fecha_envio: string;
  motivo: string;
  procesado: boolean;
  id_propietario?: string;
  created_at?: any;
}

export interface CorreoHistorico {
  id: string; // email_id
  id_propietario: string;
  cuerpo: string;
  fecha_envio: string;
  movimientos_generados: string[]; // array of movement IDs
  created_at?: any;
}

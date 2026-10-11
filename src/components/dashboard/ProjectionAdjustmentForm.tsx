import { useEffect, useId, useRef, useState } from "react";
import type { Suscripcion } from "../../types";
import type { ProjectionAdjustment } from "../../utils/predictive";
import { clampDayToMonth, parseSubscriptionDate, toLocalDateKey } from "../../utils/subscriptions";

export type NamedProjectionAdjustment = ProjectionAdjustment & { descripcion: string };

interface Props {
  subscriptions: Suscripcion[];
  onAdd: (adjustment: NamedProjectionAdjustment) => void;
  onClose: () => void;
}

export const ProjectionAdjustmentForm = ({ subscriptions, onAdd, onClose }: Props) => {
  const prefix = useId();
  const typeRef = useRef<HTMLSelectElement>(null);
  const [tipo, setTipo] = useState<ProjectionAdjustment["tipo"]>("puntual");
  const [descripcion, setDescripcion] = useState("");
  const [importe, setImporte] = useState("");
  const [direction, setDirection] = useState("gasto");
  const [fecha, setFecha] = useState(() => toLocalDateKey(new Date()));
  const [subscriptionId, setSubscriptionId] = useState(subscriptions[0]?.id ?? "");
  const today = new Date();
  const minDate = toLocalDateKey(today);
  const maxDate = toLocalDateKey(clampDayToMonth(today.getFullYear(), today.getMonth() + 60, today.getDate()));
  useEffect(() => { typeRef.current?.focus(); }, []);

  return (
    <form className="mb-4 space-y-3 rounded-xl bg-surface-2 p-3" aria-label="Añadir supuesto" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }} onSubmit={(event) => {
      event.preventDefault();
      const id = crypto.randomUUID();
      if (tipo === "cancelar_suscripcion") {
        const subscription = subscriptions.find((item) => item.id === subscriptionId);
        if (!subscription) return;
        onAdd({ id, tipo, suscripcionId: subscriptionId, descripcion: `Sin ${subscription.nombre}` });
      } else {
        const amount = Math.round(Number(importe) * 100) / 100;
        if (!Number.isFinite(amount) || amount <= 0) return;
        const signedAmount = direction === "gasto" ? -amount : amount;
        const name = descripcion.trim() || (direction === "gasto" ? "Gasto" : "Ingreso");
        if (tipo === "puntual") {
          const date = parseSubscriptionDate(fecha);
          if (!date || fecha < minDate || fecha > maxDate) return;
          onAdd({ id, tipo, importe: signedAmount, fecha: date, descripcion: name });
        } else {
          onAdd({ id, tipo, importe: signedAmount, desde: today, descripcion: name });
        }
      }
      onClose();
    }}>
      <div>
        <label htmlFor={`${prefix}-type`} className="field-label">Tipo de supuesto</label>
        <select ref={typeRef} id={`${prefix}-type`} className="field" value={tipo} onChange={(event) => setTipo(event.target.value as ProjectionAdjustment["tipo"])}>
          <option value="puntual">Gasto o ingreso puntual</option>
          <option value="mensual">Cambio mensual</option>
          <option value="cancelar_suscripcion">Cancelar una suscripción</option>
        </select>
      </div>
      {tipo === "cancelar_suscripcion" ? (
        <div>
          <label htmlFor={`${prefix}-subscription`} className="field-label">Suscripción</label>
          <select id={`${prefix}-subscription`} className="field" required value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)}>
            {!subscriptions.length && <option value="">No hay suscripciones activas</option>}
            {subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.nombre}</option>)}
          </select>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${prefix}-description`} className="field-label">Descripción (opcional)</label>
            <input id={`${prefix}-description`} className="field" value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
          </div>
          <div>
            <label htmlFor={`${prefix}-amount`} className="field-label">{tipo === "mensual" ? "Importe al mes (€)" : "Importe (€)"}</label>
            <input id={`${prefix}-amount`} className="field" type="number" inputMode="decimal" min="0.01" step="0.01" required value={importe} onChange={(event) => setImporte(event.target.value)} />
          </div>
          <div>
            <label htmlFor={`${prefix}-direction`} className="field-label">Gasto o ingreso</label>
            <select id={`${prefix}-direction`} className="field" value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="gasto">Gasto</option><option value="ingreso">Ingreso</option>
            </select>
          </div>
          {tipo === "puntual" && <div>
            <label htmlFor={`${prefix}-date`} className="field-label">Fecha</label>
            <input id={`${prefix}-date`} className="field" type="date" required min={minDate} max={maxDate} value={fecha} onChange={(event) => setFecha(event.target.value)} />
          </div>}
        </div>
      )}
      <div className="flex gap-2">
        <button className="dashboard-secondary-button" type="submit" disabled={tipo === "cancelar_suscripcion" && !subscriptions.length}>Añadir</button>
        <button className="dashboard-secondary-button" type="button" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  );
};

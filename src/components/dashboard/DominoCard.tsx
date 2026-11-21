import React, { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import type { Movimiento } from '../../types';
import { findDominoChains, type DominoCadena } from '../../utils/domino';
import { usePrivacy } from '../../context/PrivacyContext';

export interface DominoCardProps {
  movimientos: Movimiento[];
  now?: Date;
}

const veces = (n: number) => `${n} ${n === 1 ? 'vez' : 'veces'}`;
const deCadaDiez = (p: number) => `${Math.max(1, Math.round(p * 10))} de cada 10`;
const factor = (x: number) => x.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Una ficha de dominó: arriba el comercio, abajo el dato. */
const Ficha: React.FC<{ nombre: string; dato: string; principal?: boolean }> = ({ nombre, dato, principal }) => (
  <div
    className={`flex min-w-0 max-w-[11rem] flex-col rounded-xl border px-3 py-2 ${principal ? 'border-brand bg-brand-tint' : 'border-line bg-surface-2'}`}
  >
    <span className={`truncate text-[13px] font-bold first-letter:uppercase ${principal ? 'text-brand-ink' : 'text-ink'}`}>{nombre}</span>
    <span className="mt-1 border-t border-line pt-1 text-[11px] tabular-nums text-ink-soft">{dato}</span>
  </div>
);

export const DominoCard: React.FC<DominoCardProps> = ({ movimientos, now }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const [expanded, setExpanded] = useState(false);
  const { cadenas } = useMemo(() => findDominoChains(movimientos, { now }), [movimientos, now]);

  if (isLocked || cadenas.length === 0) return null;

  const [top, ...resto] = cadenas;
  const visibles = expanded ? resto : resto.slice(0, 3);
  const cuando = (c: DominoCadena) => (c.porHora ? 'en el mismo rato' : 'el mismo día');

  return (
    <section className="dashboard-surface min-w-0 p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink">
          <Link2 size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="dashboard-heading">Dominó</h3>
          <p className="dashboard-subtitle">Compras que suelen venir acompañadas · último año</p>
        </div>
      </div>

      <p className="text-[15px] font-bold leading-snug text-ink">
        Cuando compras en <span className="first-letter:uppercase">{top.nombre}</span>, el plan te suele salir por{' '}
        <span className="tabular-nums">{formatCurrency(top.costeConjunto)}</span>
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        Allí pagas de media {formatCurrency(top.importeMedio)}; con lo que suele acompañarlo {cuando(top)}, el conjunto
        sale {factor(top.multiplicador)} veces más caro.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label={`Cadena de ${top.nombre}`}>
        <Ficha nombre={top.nombre} dato={`${formatCurrency(top.importeMedio)} · ${veces(top.veces)}`} principal />
        {top.acompanantes.map((a) => (
          <React.Fragment key={a.clave}>
            <span aria-hidden="true" className="h-px w-3 bg-line" />
            <Ficha nombre={a.nombre} dato={`${deCadaDiez(a.probabilidad)} · ${formatCurrency(a.importeMedio)}`} />
          </React.Fragment>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-soft">
        En esas {veces(top.veces)} se fueron {formatCurrency(top.arrastreTotal)} en lo que vino con {top.nombre}.
      </p>

      {visibles.length > 0 && (
        <div className="mt-4 divide-y divide-line border-t border-line pt-1">
          {visibles.map((c) => (
            <div key={c.clave} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-ink first-letter:uppercase">{c.nombre}</p>
                <p className="truncate text-[11px] text-ink-soft">
                  con {c.acompanantes.map((a) => a.nombre).join(', ')} · {veces(c.veces)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-extrabold tabular-nums text-ink">×{factor(c.multiplicador)}</p>
                <p className="text-[11px] tabular-nums text-ink-soft">{formatCurrency(c.costeConjunto)} el plan</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {resto.length > 3 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 w-full rounded-xl py-2 text-center text-xs font-bold text-brand-ink transition-colors hover:bg-surface-2"
        >
          {expanded ? 'Ver menos' : 'Ver todas'}
        </button>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Cuenta los gastos del mismo rato (3 horas) cuando el banco da la hora, y del mismo día cuando no. Que coincidan no
        significa que una compra cause la otra.
      </p>
    </section>
  );
};

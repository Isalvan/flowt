import { useMemo } from 'react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import {
  clockHeadline,
  DIAS_SEMANA,
  hourLabel,
  spendingClock,
  weekdayPlural,
  windowLabel,
  type ClockHour,
  type ClockWindow,
} from '../../utils/spendingClock';

const SIZE = 240;
const C = SIZE / 2;
const INNER = 36;
const OUTER = 104;
const GAP = 1.6; // grados entre horas

const polar = (r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return `${(C + r * Math.cos(rad)).toFixed(2)} ${(C + r * Math.sin(rad)).toFixed(2)}`;
};
/** Sector de corona entre dos ángulos (0° arriba, sentido horario). */
const sector = (from: number, to: number, r0: number, r1: number) =>
  `M ${polar(r1, from)} A ${r1} ${r1} 0 0 1 ${polar(r1, to)} L ${polar(r0, to)} A ${r0} ${r0} 0 0 0 ${polar(r0, from)} Z`;

const inWindow = (hora: number, w: ClockWindow | null) =>
  !!w && ((hora - w.desde + 24) % 24) < ((w.hasta - w.desde + 24) % 24 || 24);
const compras = (n: number) => `${n} ${n === 1 ? 'compra' : 'compras'}`;
const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function Dial({ horas, franja, conHora }: { horas: ClockHour[]; franja: ClockWindow | null; conHora: number }) {
  const { formatCurrency } = usePrivacy();
  const max = Math.max(...horas.map(h => h.total), 0);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto h-auto w-full max-w-[240px]" role="img"
      aria-label={franja ? `Reloj de 24 horas: la franja con más gasto es ${windowLabel(franja)}` : 'Reloj de 24 horas del gasto'}>
      <circle cx={C} cy={C} r={OUTER} fill="none" stroke="var(--line-strong)" strokeDasharray="2 5" />
      <circle cx={C} cy={C} r={(INNER + OUTER) / 2} fill="none" stroke="var(--line)" strokeDasharray="2 5" />
      {horas.map(h => {
        const from = h.hora * 15 + GAP / 2;
        const to = (h.hora + 1) * 15 - GAP / 2;
        const r1 = max > 0 && h.total > 0 ? INNER + 6 + (OUTER - INNER - 6) * Math.sqrt(h.total / max) : INNER + 2;
        const peak = inWindow(h.hora, franja);
        return (
          <path key={h.hora} d={sector(from, to, INNER, r1)} data-hora={h.hora} data-pico={peak || undefined}
            fill={h.total > 0 ? 'var(--brand)' : 'var(--surface-2)'}
            fillOpacity={h.total > 0 ? (peak ? 0.95 : 0.38) : 1}>
            <title>{`${hourLabel(h.hora)}–${hourLabel((h.hora + 1) % 24)} · ${compras(h.count)} · ${formatCurrency(h.total)}`}</title>
          </path>
        );
      })}
      {[0, 6, 12, 18].map(hora => {
        const [x, y] = polar(OUTER + 11, hora * 15).split(' ');
        return <text key={hora} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700" fill="var(--ink-faint)">{String(hora).padStart(2, '0')}</text>;
      })}
      <text x={C} y={C - 6} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--ink)">{conHora}</text>
      <text x={C} y={C + 11} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--ink-faint)">con hora</text>
    </svg>
  );
}

export function SpendingClockView({ movimientos }: { movimientos: readonly Movimiento[] }) {
  const { formatCurrency } = usePrivacy();
  const clock = useMemo(() => spendingClock(movimientos), [movimientos]);

  if (!clock.gastos) {
    return <div className="dashboard-empty h-64"><p>Aún no hay gastos en este periodo</p></div>;
  }

  const maxMedia = Math.max(...clock.dias.map(d => d.media), 0);
  const { franja, diaPico } = clock;

  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center">
      {clock.horasFiables ? (
        <Dial horas={clock.horas} franja={franja} conHora={clock.conHora} />
      ) : (
        <div className="dashboard-empty min-h-40 px-4 text-center">
          <p className="dashboard-heading">Sin horas suficientes</p>
          <p className="mt-1 text-xs text-ink-soft">
            Solo {clock.conHora} de {clock.gastos} gastos traen la hora en el aviso del banco, así que te enseño los días de la semana.
          </p>
        </div>
      )}
      <div className="min-w-0">
        <p className="text-base font-bold text-ink">{clockHeadline(clock)}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {franja && (
            <span className="rounded-full bg-brand-tint px-2.5 py-1 font-bold text-brand-ink">
              {windowLabel(franja)} · {compras(franja.count)} · {formatCurrency(franja.total)}
            </span>
          )}
          {diaPico && (
            <span className="rounded-full bg-surface-2 px-2.5 py-1 font-bold text-ink-soft">
              Los {weekdayPlural(diaPico.nombre)} · {formatCurrency(diaPico.media)} de media
            </span>
          )}
        </div>
        <div className="mt-4 flex h-24 items-end gap-1.5" role="list" aria-label="Gasto medio por día de la semana">
          {clock.dias.map(d => {
            const peak = diaPico?.dia === d.dia;
            const height = maxMedia > 0 ? Math.max(4, Math.round((d.media / maxMedia) * 100)) : 4;
            return (
              <div key={d.dia} role="listitem" className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                aria-label={`${DIAS_SEMANA[d.dia]}: ${formatCurrency(d.media)} de media`} title={`${DIAS_SEMANA[d.dia]} · ${compras(d.count)} · ${formatCurrency(d.media)} de media`}>
                <div className={`w-full max-w-8 rounded-md ${peak ? 'bg-[var(--brand)]' : d.media > 0 ? 'bg-brand-tint' : 'bg-surface-2'}`} style={{ height: `${height}%` }} />
                <span className={`text-[10px] font-bold ${peak ? 'text-brand-ink' : 'text-ink-faint'}`}>{LETRAS[d.dia]}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          {clock.horasFiables ? `La hora sale del aviso del banco: ${clock.conHora} de ${clock.gastos} gastos la traen. ` : ''}
          Sin suscripciones ni movimientos entre tus huchas.
          {clock.bancosPorLotes.length > 0 && ` No uso la hora de ${clock.bancosPorLotes.map(b => b || 'los avisos sin banco').join(', ')}: sus avisos llegan por lotes.`}
        </p>
      </div>
    </div>
  );
}

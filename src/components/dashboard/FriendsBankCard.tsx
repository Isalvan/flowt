import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Users } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { buildFriendsBank, type FriendEntry } from '../../utils/friendsBank';

const VISIBLE = 4;
const shortDate = (date: Date | null) => date?.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) ?? '';
const daysLabel = (days: number) => days < 1 ? 'el mismo día' : `en ${Math.round(days)} ${Math.round(days) === 1 ? 'día' : 'días'}`;

const FriendRow: React.FC<{ person: FriendEntry; money: (n: number) => string }> = ({ person, money }) => {
  const flows = [
    person.recibido > 0 && <span key="in" className="inline-flex items-center gap-0.5"><ArrowDownLeft size={11} aria-hidden="true" />Te ha enviado {money(person.recibido)}</span>,
    person.enviado > 0 && <span key="out" className="inline-flex items-center gap-0.5"><ArrowUpRight size={11} aria-hidden="true" />Le has enviado {money(person.enviado)}</span>,
    person.diasDevolucion !== null && <span key="days">Te devuelve {daysLabel(person.diasDevolucion)}</span>,
  ].filter(Boolean);
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink">{person.nombre}</p>
          {flows.length > 0 && <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-ink-soft">{flows}</p>}
        </div>
        {person.teDebe > 0
          ? <span className="shrink-0 text-right text-[13px] font-extrabold tabular-nums text-sun-600 dark:text-sun-300">Te debe {money(person.teDebe)}</span>
          : person.adelantado > 0 && <span className="shrink-0 text-[12px] font-semibold text-ink-faint">Al día</span>}
      </div>
      {person.pendientes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-ink-faint" aria-label={`Pendiente de ${person.nombre}`}>
          {person.pendientes.slice(0, 2).map(p => <li key={p.gastoId}>{p.comercio}{p.fecha ? ` · ${shortDate(p.fecha)}` : ''} · {money(p.importe)}</li>)}
          {person.pendientes.length > 2 && <li>y {person.pendientes.length - 2} más</li>}
        </ul>
      )}
    </li>
  );
};

/** Cuánto te mueves con cada persona por Bizum y quién te debe parte de un ticket. */
export const FriendsBankCard: React.FC<{ movimientos: Movimiento[]; now?: Date }> = ({ movimientos, now }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const [expanded, setExpanded] = useState(false);
  const bank = useMemo(() => isLocked ? null : buildFriendsBank(movimientos, now), [isLocked, movimientos, now]);
  if (!bank || bank.personas.length === 0) return null;

  const debtors = bank.personas.filter(p => p.teDebe > 0).length;
  const visible = expanded ? bank.personas : bank.personas.slice(0, VISIBLE);
  const headline = bank.totalTeDeben > 0
    ? `Te deben ${formatCurrency(bank.totalTeDeben)} entre ${debtors} ${debtors === 1 ? 'persona' : 'personas'}`
    : 'Nadie te debe nada';

  return (
    <section className="dashboard-surface min-w-0 p-5" aria-label="Banco de amigos">
      <div className="mb-4 flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink"><Users size={18} /></span>
        <div className="min-w-0">
          <h3 className="dashboard-heading">Banco de amigos</h3>
          <p className="dashboard-subtitle">Bizum y tickets repartidos · último año</p>
        </div>
      </div>

      <p className="text-lg font-extrabold leading-snug text-ink">{headline}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-ink-soft">
        <div><dt>Te han enviado</dt><dd className="text-[15px] font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(bank.totalRecibido)}</dd></div>
        <div><dt>Adelantaste y te devolvieron</dt><dd className="text-[15px] font-extrabold tabular-nums text-ink">{formatCurrency(bank.totalAdelantado)}</dd></div>
      </dl>

      <ul className="mt-3 divide-y divide-line border-t border-line">
        {visible.map(person => <FriendRow key={person.clave} person={person} money={formatCurrency} />)}
      </ul>

      {bank.personas.length > VISIBLE && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}
          className="mt-2 w-full rounded-xl py-2 text-center text-xs font-bold text-brand-ink transition-colors hover:bg-surface-2">
          {expanded ? 'Ver menos' : `Ver las ${bank.personas.length} personas`}
        </button>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        El banco avisa de quién te envía dinero, pero no de a quién se lo envías tú
        {bank.enviadosSinNombre > 0 ? ` (${bank.enviadosSinNombre} ${bank.enviadosSinNombre === 1 ? 'Bizum enviado sin nombre' : 'Bizum enviados sin nombre'})` : ''}.
        Lo que te deben sale de los tickets repartidos sin pagar.
      </p>
    </section>
  );
};

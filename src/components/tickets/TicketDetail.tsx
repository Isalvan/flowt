import { Receipt } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { paidTicketPeople } from '../../utils/ticketPayments';
import { ticketMoney } from '../../utils/ticketSplit';

export function TicketDetail({ movimiento, movimientos }: { movimiento: Movimiento; movimientos: Movimiento[] }) {
  const { isLocked } = usePrivacy();
  const ticket = movimiento.ticket;
  if (isLocked || !ticket) return null;
  const paid = paidTicketPeople(movimiento, movimientos);
  return <details className="mt-3 min-w-0 rounded-xl bg-surface-2 p-3 text-xs text-ink-soft">
    <summary className="cursor-pointer font-semibold text-brand-ink"><Receipt size={14} className="mr-1 inline" /> Ver ticket · {ticket.comercio}</summary>
    <ul className="mt-3 space-y-2" aria-label={`Detalle del ticket de ${ticket.comercio}`}>
      {ticket.lineas.map((line, i) => <li key={i} className="flex min-w-0 items-start justify-between gap-3"><span className="min-w-0 break-words">{line.d}{line.p?.length && ticket.personas ? <small className="block text-ink-faint">{line.p.map(p => ticket.personas?.[p]?.nombre).filter(Boolean).join(', ')}</small> : null}</span><span className="shrink-0 tabular-nums">{ticketMoney(line.i, movimiento.moneda)}</span></li>)}
    </ul>
    {ticket.personas?.some(p => !p.yo) && <div className="mt-3 border-t border-line pt-3">
      <p className="font-semibold text-ink">Te deben:</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{ticket.personas.map((person, i) => person.yo ? null : <li key={i} className={paid.has(i) ? 'text-ink-faint' : ''}>
        <span className={paid.has(i) ? 'line-through' : ''}>{person.nombre} {ticketMoney(person.importe, movimiento.moneda)}</span>{paid.has(i) && <span className="sr-only"> · pagado</span>}
      </li>)}</ul>
    </div>}
  </details>;
}

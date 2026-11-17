import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plus, Share2, ScanLine } from 'lucide-react';
import { Modal } from '../common/Modal';
import type { Hucha, Movimiento, MovementTicket, TicketPersona, TicketScanResult } from '../../types';
import { DEMO_TICKET } from '../../utils/demoData';
import { hasTicketApi, scanTicket } from '../../utils/ticketApi';
import { prepareTicketImage } from '../../utils/ticketImage';
import { findTicketMatch, normalizeTicketText, splitTicket, ticketMoney, ticketSummaryText } from '../../utils/ticketSplit';
import { categoryOptions } from '../../utils/movementSuggestions';
import { parseMovimientoDate } from '../../utils/periodStats';

export interface TicketExpenseInput {
  tipo: 'gasto';
  concepto: string;
  importe: number;
  fecha_operacion: string;
  categoria: string;
  es_metalico: boolean;
  hucha_id?: string;
  ticket: MovementTicket;
}

export interface TicketModalProps {
  file?: File | null;
  demo?: boolean;
  uid: string;
  movimientos: Movimiento[];
  huchas: Hucha[];
  onSave: (data: TicketExpenseInput) => Promise<void>;
  onAttach: (id: string, ticket: MovementTicket) => Promise<void>;
  onClose: () => void;
  onManual: () => void;
}

function recentPeople(uid: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`flowt:ticket-people:${uid}`) ?? '[]');
    return Array.isArray(stored) ? stored.filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 40).slice(0, 12) : [];
  } catch { return []; }
}

const today = () => new Date().toLocaleDateString('en-CA');
const chip = 'rounded-full border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-2';
// One colour per person, legible on light and dark themes, so equal initials never look alike.
const PERSON_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#d946ef', '#84cc16', '#f97316', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7'];
const personColor = (index: number) => PERSON_COLORS[index % PERSON_COLORS.length];
const personChip = 'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold text-ink transition-colors';
const personStyle = (index: number, active: boolean): React.CSSProperties => ({
  borderColor: active ? personColor(index) : 'var(--line-strong)',
  backgroundColor: active ? `${personColor(index)}33` : 'transparent',
});
const Dot = ({ index }: { index: number }) => <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: personColor(index) }} />;

/** Mounted once per photo: closing drops the photo, scan result and unsaved split. */
export function TicketModal({ file, demo = false, uid, movimientos, huchas, onSave, onAttach, onClose, onManual }: TicketModalProps) {
  const [ticket, setTicket] = useState<TicketScanResult | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [split, setSplit] = useState(false);
  const [people, setPeople] = useState<Pick<TicketPersona, 'nombre' | 'yo'>[]>([{ nombre: 'Yo', yo: true }]);
  const [assignments, setAssignments] = useState<number[][]>([]);
  const [name, setName] = useState('');
  const [recent] = useState(() => recentPeople(uid));
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [ignoredMatch, setIgnoredMatch] = useState<string | null>(null);
  const [wallet, setWallet] = useState('efectivo_auto');
  const [shareStatus, setShareStatus] = useState('');
  const example = demo || !hasTicketApi();

  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      try {
        const prepared = file ? await prepareTicketImage(file) : null;
        if (controller.signal.aborted) return;
        if (prepared) setPreview(prepared.preview);
        if (!example && !prepared) throw new Error('Selecciona una foto del ticket.');
        const result = example ? structuredClone(DEMO_TICKET) : await scanTicket(prepared!.image, prepared!.mime, controller.signal);
        if (!controller.signal.aborted) setTicket({ ...result, fecha: result.fecha ?? today() });
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se ha podido leer el ticket.');
      }
    };
    void read();
    return () => controller.abort();
  }, [file, example, attempt]);

  const possibleMatch = ticket ? findTicketMatch(movimientos, ticket) : null;
  const match = possibleMatch?.id === ignoredMatch ? null : possibleMatch;
  const valid = ticket !== null && ticket.comercio.trim().length > 0 && !!ticket.fecha &&
    ticket.fecha <= today() && Number.isFinite(ticket.total) && ticket.total > 0 && ticket.total <= 10000 &&
    ticket.lineas.every(l => l.descripcion.trim().length > 0 && Number.isFinite(l.importe));
  const shares = ticket && valid ? splitTicket(ticket, people, assignments) : [];
  const lineTotal = ticket?.lineas.reduce((sum, l) => sum + Math.round(l.importe * 100), 0) ?? 0;
  const mismatch = ticket && Math.abs(Math.round(ticket.total * 100) - lineTotal) > 5;

  const addPerson = (value: string) => {
    const clean = value.trim().slice(0, 40);
    if (!clean || people.length >= 12 || people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(clean))) return;
    setPeople([...people, { nombre: clean }]);
    setName('');
  };
  const toggleAssignment = (line: number, person: number) => {
    setAssignments(current => {
      const next = [...current];
      const selected = next[line] ?? [];
      next[line] = selected.includes(person) ? selected.filter(i => i !== person) : [...selected, person].sort((a, b) => a - b);
      return next;
    });
  };
  const save = async () => {
    if (!ticket || !valid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const detail: MovementTicket = {
      comercio: ticket.comercio.trim(),
      lineas: ticket.lineas.map((l, i) => ({ d: l.descripcion.trim(), i: Math.round(l.importe * 100) / 100, ...(split && assignments[i]?.length ? { p: assignments[i] } : {}) })),
      ...(split ? { personas: shares } : {}),
    };
    try {
      if (match) await onAttach(match.id, detail);
      else await onSave({
        tipo: 'gasto', concepto: detail.comercio, importe: Math.round(ticket.total * 100) / 100,
        fecha_operacion: ticket.fecha!, categoria: ticket.categoria_sugerida,
        es_metalico: wallet === 'efectivo_auto', ...(wallet !== 'efectivo_auto' ? { hucha_id: wallet } : {}), ticket: detail,
      });
      if (split) {
        try {
          const names = [...people.filter(p => !p.yo).map(p => p.nombre), ...recent];
          localStorage.setItem(`flowt:ticket-people:${uid}`, JSON.stringify(names.filter((n, i) => names.findIndex(other => normalizeTicketText(other) === normalizeTicketText(n)) === i).slice(0, 12)));
        } catch { /* Private browsing may disable storage; the expense is already saved. */ }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar el gasto. Inténtalo de nuevo.');
    } finally { savingRef.current = false; setSaving(false); }
  };
  const share = async () => {
    if (!ticket || !valid) return;
    const text = ticketSummaryText(ticket, shares);
    setShareStatus('');
    try {
      if (navigator.share) await navigator.share({ title: `Ticket ${ticket.comercio}`, text });
      else { await navigator.clipboard.writeText(text); setShareStatus('Reparto copiado al portapapeles.'); }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setShareStatus('No se ha podido compartir. Prueba de nuevo.');
    }
  };

  return <Modal isOpen onClose={() => { if (!savingRef.current) onClose(); }} title={<span className="flex items-center gap-2"><ScanLine size={21} /> Ticket</span>} size="lg">
    {!ticket ? <div className="space-y-4 py-4 text-center">
      {preview && <img src={preview} alt="Foto del ticket" className="mx-auto max-h-40 max-w-full rounded-xl object-contain" />}
      {!error && <p role="status" className="flex items-center justify-center gap-2 text-sm text-ink"><LoaderCircle size={18} className="animate-spin" /> Leyendo ticket…</p>}
      {error && <>
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="dashboard-primary-button" onClick={() => { setError(''); setAttempt(a => a + 1); }}>Reintentar</button>
          <button type="button" className="dashboard-secondary-button" onClick={onManual}>Escribirlo a mano</button>
        </div>
      </>}
    </div> : <form onSubmit={e => { e.preventDefault(); void save(); }} className="min-w-0">
      {/* The modal body is the only scroll area; the footer sticks to its bottom edge. */}
      <fieldset disabled={saving} className="min-w-0 space-y-4 pb-4">
        {example && <p className="text-xs text-ink-soft">Ticket de ejemplo · {demo ? 'modo demo' : 'lector sin configurar'}</p>}
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="col-span-2 min-w-0"><span className="field-label">Comercio</span><input className="field min-w-0" value={ticket.comercio} maxLength={120} required onChange={e => setTicket({ ...ticket, comercio: e.target.value })} /></label>
          <label className="min-w-0"><span className="field-label">Fecha</span><input className="field min-w-0 !px-2" type="date" required max={today()} value={ticket.fecha ?? ''} onChange={e => setTicket({ ...ticket, fecha: e.target.value })} /></label>
          <label className="min-w-0"><span className="field-label">Total ({ticket.moneda})</span><input className="field min-w-0 tabular-nums" type="number" inputMode="decimal" min="0.01" max="10000" step="0.01" required value={ticket.total} onChange={e => setTicket({ ...ticket, total: Number(e.target.value) })} /></label>
          <label className="col-span-2 min-w-0"><span className="field-label">Categoría</span><select className="field" value={ticket.categoria_sugerida} onChange={e => setTicket({ ...ticket, categoria_sugerida: e.target.value })}>{categoryOptions('gasto').map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
        </div>
        {match ? <div className="rounded-xl bg-brand-tint p-3 text-sm text-ink">
          <p className="font-semibold">Ya está en Flowt: {match.concepto} · {parseMovimientoDate(match.fecha_operacion)?.toLocaleDateString('es-ES')} · {ticketMoney(match.importe, ticket.moneda)}</p>
          <button type="button" className="mt-2 text-xs font-semibold text-brand-ink underline" onClick={() => setIgnoredMatch(match.id)}>Es otro gasto</button>
        </div> : <details className="rounded-xl bg-surface-2 p-3 text-xs text-ink-soft">
          <summary className="cursor-pointer font-semibold">{wallet === 'efectivo_auto' ? 'Efectivo · cambiar cartera' : `${huchas.find(h => h.id === wallet)?.nombre ?? 'Cartera'} · cambiar`}</summary>
          <label className="mt-3 block"><span className="field-label">Cartera del gasto</span><select className="field" value={wallet} onChange={e => setWallet(e.target.value)}>
            <option value="efectivo_auto">Efectivo (automática)</option>
            {huchas.filter(h => h.activa !== false && !h.es_metalico && !h.es_interno).map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select></label>
          <p className="mt-2">Los pagos con tarjeta ya llegan por correo. Comprueba si el gasto está registrado.</p>
        </details>}
        {mismatch && <p role="note" className="rounded-xl bg-amber-500/10 p-3 text-xs text-ink-soft">Las líneas suman {ticketMoney(lineTotal / 100, ticket.moneda)} y el total es {ticketMoney(ticket.total, ticket.moneda)}; la diferencia se reparte proporcionalmente.</p>}
        <label className="flex items-center gap-3 text-sm font-semibold text-ink"><input type="checkbox" role="switch" checked={split} onChange={e => setSplit(e.target.checked)} className="h-5 w-5 accent-brand" /> Repartir entre personas</label>
        {split && <div className="space-y-3">
          <div className="flex flex-wrap gap-2" aria-label="Personas del reparto">{people.map((p, i) => <button type="button" key={i} aria-pressed={selectedPerson === i} onClick={() => setSelectedPerson(selectedPerson === i ? null : i)} className={personChip} style={personStyle(i, selectedPerson === i)}><Dot index={i} /><span className="truncate">{p.nombre}</span></button>)}</div>
          <p className="text-xs text-ink-soft">{selectedPerson === null ? 'Elige una persona y toca líneas para asignarlas. Sin asignar: todos.' : `Toca una línea para asignarla a ${people[selectedPerson].nombre}.`}</p>
          {people.length < 12 && <div className="flex min-w-0 gap-2"><input aria-label="Nombre de persona" value={name} maxLength={40} placeholder="Añadir nombre" className="field min-w-0 flex-1" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPerson(name); } }} /><button type="button" className="dashboard-secondary-button shrink-0" aria-label="Añadir persona" disabled={!name.trim()} onClick={() => addPerson(name)}><Plus size={18} /></button></div>}
          {people.length < 12 && recent.some(n => !people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(n))) && <div className="flex flex-wrap gap-2" aria-label="Personas recientes">{recent.filter(n => !people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(n))).map(n => <button type="button" className={chip} key={n} onClick={() => addPerson(n)}>{n}</button>)}</div>}
        </div>}
        <ul className="divide-y divide-line" aria-label="Líneas del ticket">
          {ticket.lineas.map((line, i) => <li key={i} className="min-w-0 py-3">
            {editingLine === i ? <div className="space-y-2">
              <input aria-label={`Descripción de línea ${i + 1}`} className="field" maxLength={120} required value={line.descripcion} onChange={e => setTicket({ ...ticket, lineas: ticket.lineas.map((l, j) => j === i ? { ...l, descripcion: e.target.value } : l) })} />
              <div className="flex min-w-0 gap-2"><input aria-label={`Importe de línea ${i + 1}`} type="number" inputMode="decimal" step="0.01" className="field min-w-0 flex-1" value={line.importe} onChange={e => setTicket({ ...ticket, lineas: ticket.lineas.map((l, j) => j === i ? { ...l, importe: Number(e.target.value) } : l) })} /><button type="button" className="dashboard-secondary-button" onClick={() => setEditingLine(null)}>Listo</button></div>
            </div> : <div className="flex min-w-0 items-start gap-2">
              <button type="button" aria-label={`${split && selectedPerson !== null ? 'Asignar' : 'Editar'} ${line.descripcion}`} className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left text-sm text-ink" onClick={() => { if (split && selectedPerson !== null) toggleAssignment(i, selectedPerson); else setEditingLine(i); }}><span className="min-w-0 break-words">{line.descripcion}</span><span className="shrink-0 tabular-nums">{ticketMoney(line.importe, ticket.moneda)}</span></button>
              {split && selectedPerson !== null && <button type="button" aria-label={`Editar línea ${i + 1}`} className="text-xs text-brand-ink underline" onClick={() => setEditingLine(i)}>Editar</button>}
            </div>}
            {split && <>
            {!assignments[i]?.length && <p className="mt-1 text-xs text-ink-faint">Sin asignar: entre todos</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {people.map((p, index) => <button type="button" key={index} title={p.nombre} aria-label={`${p.nombre}, línea ${i + 1}`} aria-pressed={assignments[i]?.includes(index) ?? false} className={`${personChip} !px-3`} style={personStyle(index, assignments[i]?.includes(index) ?? false)} onClick={() => toggleAssignment(i, index)}><Dot index={index} /><span className="max-w-[7rem] truncate">{p.nombre}</span></button>)}
            </div>
            </>}
          </li>)}
        </ul>
      </fieldset>
      <footer className="sticky bottom-0 z-10 space-y-3 border-t border-line bg-surface pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {split && <div aria-label="Totales por persona" aria-live="polite" className="grid max-h-32 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto text-xs text-ink">{shares.map((p, i) => <p key={i} className="flex min-w-0 items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5"><Dot index={i} /><span className="truncate">{p.nombre}</span></span><strong className="shrink-0 tabular-nums">{ticketMoney(p.importe, ticket.moneda)}</strong></p>)}</div>}
        {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        {shareStatus && <p role="status" className="text-xs text-ink-soft">{shareStatus}</p>}
        <div className="flex flex-wrap gap-2">
          {split && <button type="button" className="dashboard-secondary-button" disabled={!valid || saving} onClick={() => void share()}><Share2 size={15} /> Compartir</button>}
          <button type="submit" className="dashboard-primary-button min-w-0 flex-1 !whitespace-normal" disabled={!valid || saving}>{saving ? 'Guardando…' : match ? 'Añadir el detalle a ese gasto' : 'Guardar gasto'}</button>
        </div>
      </footer>
    </form>}
  </Modal>;
}

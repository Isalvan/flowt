import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, LoaderCircle, Pencil, Plus, ScanLine, Share2, Users, X } from 'lucide-react';
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

type Step = 'review' | 'people' | 'assign' | 'summary';
const STEPS: { id: Step; label: string }[] = [
  { id: 'review', label: 'Revisar ticket' },
  { id: 'people', label: 'Personas' },
  { id: 'assign', label: 'Asignar líneas' },
  { id: 'summary', label: 'Resumen' },
];

// One colour per person, legible on light and dark themes, so similar names never look alike.
const PERSON_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#d946ef', '#84cc16', '#f97316', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7'];
const personColor = (index: number) => PERSON_COLORS[index % PERSON_COLORS.length];
const Dot = ({ index, size = 'h-3 w-3' }: { index: number; size?: string }) =>
  <span aria-hidden="true" className={`${size} shrink-0 rounded-full`} style={{ backgroundColor: personColor(index) }} />;

function recentPeople(uid: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`flowt:ticket-people:${uid}`) ?? '[]');
    return Array.isArray(stored) ? stored.filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 40).slice(0, 12) : [];
  } catch { return []; }
}

const today = () => new Date().toLocaleDateString('en-CA');
const primary = 'dashboard-primary-button min-h-12 min-w-0 flex-1 !whitespace-normal';
const secondary = 'dashboard-secondary-button min-h-12';

/**
 * Full-screen sheet on phones, centred card from `sm` up. One task per step, so the
 * fixed footer only ever holds the next action and, while assigning, the totals.
 * Mounted once per photo: closing drops the photo, scan result and unsaved split.
 */
export function TicketModal({ file, demo = false, uid, movimientos, huchas, onSave, onAttach, onClose, onManual }: TicketModalProps) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [ticket, setTicket] = useState<TicketScanResult | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [step, setStep] = useState<Step>('review');
  const [people, setPeople] = useState<Pick<TicketPersona, 'nombre' | 'yo'>[]>([{ nombre: 'Yo', yo: true }]);
  const [assignments, setAssignments] = useState<number[][]>([]);
  const [name, setName] = useState('');
  const [recent] = useState(() => recentPeople(uid));
  const [activePerson, setActivePerson] = useState(1);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [ignoredMatch, setIgnoredMatch] = useState<string | null>(null);
  const [wallet, setWallet] = useState('efectivo_auto');
  const [shareStatus, setShareStatus] = useState('');
  const example = demo || !hasTicketApi();
  const close = () => { if (!savingRef.current) onClose(); };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

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

  // Sheet behaviour: lock the page behind it, close on Escape, keep focus inside.
  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const controls = sheet.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => { body.current?.scrollTo?.({ top: 0 }); }, [step]);

  const possibleMatch = ticket ? findTicketMatch(movimientos, ticket) : null;
  const match = possibleMatch?.id === ignoredMatch ? null : possibleMatch;
  const valid = ticket !== null && ticket.comercio.trim().length > 0 && !!ticket.fecha &&
    ticket.fecha <= today() && Number.isFinite(ticket.total) && ticket.total > 0 && ticket.total <= 10000 &&
    ticket.lineas.every(l => l.descripcion.trim().length > 0 && Number.isFinite(l.importe));
  const shares = ticket && valid ? splitTicket(ticket, people, assignments) : [];
  const lineTotal = ticket?.lineas.reduce((sum, l) => sum + Math.round(l.importe * 100), 0) ?? 0;
  const mismatch = ticket && Math.abs(Math.round(ticket.total * 100) - lineTotal) > 5;
  const splitting = step !== 'review';
  const stepIndex = STEPS.findIndex(s => s.id === step);
  const saveLabel = saving ? 'Guardando…' : match ? 'Añadir el detalle a ese gasto' : 'Guardar gasto';

  const addPerson = (value: string) => {
    const clean = value.trim().slice(0, 40);
    if (!clean || people.length >= 12 || people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(clean))) return;
    setPeople([...people, { nombre: clean }]);
    setName('');
  };
  const removePerson = (index: number) => {
    setPeople(people.filter((_, i) => i !== index));
    // Shift later indices down so each line keeps pointing at the same people.
    setAssignments(current => current.map(line => line?.filter(i => i !== index).map(i => (i > index ? i - 1 : i)) ?? []));
    setActivePerson(1);
  };
  const toggleAssignment = (line: number, person: number) => {
    setAssignments(current => {
      const next = [...current];
      const selected = next[line] ?? [];
      next[line] = selected.includes(person) ? selected.filter(i => i !== person) : [...selected, person].sort((a, b) => a - b);
      return next;
    });
  };
  const updateLine = (index: number, change: Partial<TicketScanResult['lineas'][number]>) =>
    ticket && setTicket({ ...ticket, lineas: ticket.lineas.map((l, j) => (j === index ? { ...l, ...change } : l)) });

  const save = async () => {
    if (!ticket || !valid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    const detail: MovementTicket = {
      comercio: ticket.comercio.trim(),
      lineas: ticket.lineas.map((l, i) => ({ d: l.descripcion.trim(), i: Math.round(l.importe * 100) / 100, ...(splitting && assignments[i]?.length ? { p: assignments[i] } : {}) })),
      ...(splitting ? { personas: shares } : {}),
    };
    try {
      if (match) await onAttach(match.id, detail);
      else await onSave({
        tipo: 'gasto', concepto: detail.comercio, importe: Math.round(ticket.total * 100) / 100,
        fecha_operacion: ticket.fecha!, categoria: ticket.categoria_sugerida,
        es_metalico: wallet === 'efectivo_auto', ...(wallet !== 'efectivo_auto' ? { hucha_id: wallet } : {}), ticket: detail,
      });
      if (splitting) {
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
  const goTo = (next: Step) => { setEditingLine(null); setStep(next); };
  const goBack = () => goTo(STEPS[Math.max(0, stepIndex - 1)].id);

  // --- Steps -------------------------------------------------------------------

  const linesList = (assigning: boolean) => ticket && <ul className="divide-y divide-line rounded-2xl border border-line" aria-label="Líneas del ticket">
    {ticket.lineas.map((line, i) => {
      const owners = assignments[i] ?? [];
      const mine = owners.includes(activePerson);
      if (editingLine === i) return <li key={i} className="space-y-2 p-3">
        <input aria-label={`Descripción de línea ${i + 1}`} className="field" maxLength={120} required value={line.descripcion} onChange={e => updateLine(i, { descripcion: e.target.value })} />
        <div className="flex min-w-0 gap-2">
          <input aria-label={`Importe de línea ${i + 1}`} type="number" inputMode="decimal" step="0.01" className="field min-w-0 flex-1" value={line.importe} onChange={e => updateLine(i, { importe: Number(e.target.value) })} />
          <button type="button" className={secondary} onClick={() => setEditingLine(null)}>Listo</button>
        </div>
      </li>;
      return <li key={i} className="flex min-w-0 items-stretch">
        {assigning ? <button type="button" aria-label={`Asignar ${line.descripcion}`} aria-pressed={mine}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors"
          style={mine ? { backgroundColor: `${personColor(activePerson)}26`, boxShadow: `inset 4px 0 0 ${personColor(activePerson)}` } : undefined}
          onClick={() => toggleAssignment(i, activePerson)}>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-medium text-ink">{line.descripcion}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
              {owners.length ? owners.map(o => <span key={o} className="inline-flex items-center gap-1 text-ink-soft"><Dot index={o} size="h-2.5 w-2.5" />{people[o]?.nombre}</span>) : 'Entre todos'}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{ticketMoney(line.importe, ticket.moneda)}</span>
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: personColor(activePerson), backgroundColor: mine ? personColor(activePerson) : 'transparent' }}>
            {mine && <Check size={14} className="text-white" strokeWidth={3} />}
          </span>
        </button> : <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2">
          <span className="min-w-0 flex-1 break-words text-sm text-ink">{line.descripcion}</span>
          <span className="shrink-0 text-sm tabular-nums text-ink">{ticketMoney(line.importe, ticket.moneda)}</span>
          <button type="button" aria-label={`Editar línea ${i + 1}`} className="dashboard-icon-button shrink-0" onClick={() => setEditingLine(i)}><Pencil size={15} /></button>
        </div>}
      </li>;
    })}
  </ul>;

  const mismatchNote = mismatch && ticket && <p role="note" className="rounded-xl bg-amber-500/10 p-3 text-xs text-ink-soft">Las líneas suman {ticketMoney(lineTotal / 100, ticket.moneda)} y el total es {ticketMoney(ticket.total, ticket.moneda)}; la diferencia se reparte proporcionalmente.</p>;

  const review = ticket && <div className="space-y-5">
    {example && <p className="text-xs text-ink-soft">Ticket de ejemplo · {demo ? 'modo demo' : 'lector sin configurar'}</p>}
    {match && <div className="rounded-2xl bg-brand-tint p-4 text-sm text-ink">
      <p className="font-semibold">Ya está en Flowt</p>
      <p className="mt-1 text-ink-soft">{match.concepto} · {parseMovimientoDate(match.fecha_operacion)?.toLocaleDateString('es-ES')} · {ticketMoney(match.importe, ticket.moneda)}</p>
      <p className="mt-1 text-xs text-ink-soft">Se añadirá el detalle del ticket a ese gasto, sin duplicarlo.</p>
      <button type="button" className="mt-2 text-xs font-semibold text-brand-ink underline" onClick={() => setIgnoredMatch(match.id)}>Es otro gasto</button>
    </div>}
    <div className="grid min-w-0 grid-cols-2 gap-3">
      <label className="col-span-2 min-w-0"><span className="field-label">Comercio</span><input className="field min-w-0" value={ticket.comercio} maxLength={120} required onChange={e => setTicket({ ...ticket, comercio: e.target.value })} /></label>
      <label className="min-w-0"><span className="field-label">Fecha</span><input className="field min-w-0 !px-2" type="date" required max={today()} value={ticket.fecha ?? ''} onChange={e => setTicket({ ...ticket, fecha: e.target.value })} /></label>
      <label className="min-w-0"><span className="field-label">Total ({ticket.moneda})</span><input className="field min-w-0 tabular-nums" type="number" inputMode="decimal" min="0.01" max="10000" step="0.01" required value={ticket.total} onChange={e => setTicket({ ...ticket, total: Number(e.target.value) })} /></label>
      <label className="col-span-2 min-w-0"><span className="field-label">Categoría</span><select className="field" value={ticket.categoria_sugerida} onChange={e => setTicket({ ...ticket, categoria_sugerida: e.target.value })}>{categoryOptions('gasto').map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
      {!match && <label className="col-span-2 min-w-0"><span className="field-label">Pagado con</span><select className="field" value={wallet} onChange={e => setWallet(e.target.value)}>
        <option value="efectivo_auto">Efectivo</option>
        {huchas.filter(h => h.activa !== false && !h.es_metalico && !h.es_interno).map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
      </select><span className="field-hint block">Los pagos con tarjeta ya llegan solos por correo.</span></label>}
    </div>
    {mismatchNote}
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink">Líneas del ticket <span className="font-normal text-ink-faint">({ticket.lineas.length})</span></h3>
      {linesList(false)}
    </section>
  </div>;

  const peopleStep = <div className="space-y-5">
    <p className="text-sm text-ink-soft">¿Entre quién se reparte? Tú ya estás incluido.</p>
    <ul className="space-y-2" aria-label="Personas del reparto">
      {people.map((p, i) => <li key={i} className="flex min-h-12 items-center gap-3 rounded-2xl border border-line px-4">
        <Dot index={i} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{p.nombre}</span>
        {!p.yo && <button type="button" aria-label={`Quitar a ${p.nombre}`} className="dashboard-icon-button shrink-0" onClick={() => removePerson(i)}><X size={16} /></button>}
      </li>)}
    </ul>
    {people.length < 12 && <form className="flex min-w-0 gap-2" onSubmit={e => { e.preventDefault(); addPerson(name); }}>
      <input aria-label="Nombre de persona" value={name} maxLength={40} placeholder="Nombre" autoComplete="off" enterKeyHint="done" className="field min-h-12 min-w-0 flex-1" onChange={e => setName(e.target.value)} />
      <button type="submit" className={`${secondary} shrink-0 !px-4`} aria-label="Añadir persona" disabled={!name.trim()}><Plus size={18} /> Añadir</button>
    </form>}
    {people.length < 12 && recent.some(n => !people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(n))) && <div>
      <p className="field-label">Recientes</p>
      <div className="flex flex-wrap gap-2" aria-label="Personas recientes">{recent.filter(n => !people.some(p => normalizeTicketText(p.nombre) === normalizeTicketText(n))).map(n =>
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink" key={n} onClick={() => addPerson(n)}><Plus size={14} />{n}</button>)}</div>
    </div>}
  </div>;

  const assignStep = <div className="space-y-4">
    <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-line bg-surface px-4 pt-4 pb-3">
      <p className="mb-2 text-sm text-ink-soft">Elige a alguien y toca sus líneas. Lo que no asignes se reparte entre todos.</p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Persona activa">
        {people.map((p, i) => <button type="button" role="radio" aria-checked={activePerson === i} key={i} onClick={() => setActivePerson(i)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold text-ink transition-colors"
          style={{ borderColor: activePerson === i ? personColor(i) : 'var(--line-strong)', backgroundColor: activePerson === i ? `${personColor(i)}33` : 'transparent' }}>
          <Dot index={i} />{p.nombre}
        </button>)}
      </div>
    </div>
    {linesList(true)}
  </div>;

  const summaryStep = ticket && <div className="space-y-4">
    {mismatchNote}
    <ul className="space-y-2" aria-label="Resumen por persona">
      {shares.map((p, i) => {
        const own = ticket.lineas.filter((_, l) => assignments[l]?.includes(i)).length;
        const common = ticket.lineas.some((_, l) => !assignments[l]?.length);
        return <li key={i} className="flex items-center gap-3 rounded-2xl border border-line p-4">
          <Dot index={i} size="h-4 w-4" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-ink">{p.nombre}</span>
            <span className="block text-xs text-ink-faint">{[own ? `${own} ${own === 1 ? 'línea' : 'líneas'}` : '', common ? 'parte común' : ''].filter(Boolean).join(' + ') || 'Sin líneas'}</span>
          </span>
          <strong className="shrink-0 text-lg tabular-nums text-ink">{ticketMoney(p.importe, ticket.moneda)}</strong>
        </li>;
      })}
    </ul>
    <p className="flex justify-between px-1 text-sm text-ink-soft"><span>Total del ticket</span><span className="tabular-nums">{ticketMoney(ticket.total, ticket.moneda)}</span></p>
  </div>;

  // --- Footer: only the next action ---------------------------------------------

  const footer = ticket && <>
    {step === 'assign' && <div aria-label="Totales por persona" aria-live="polite" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
      {shares.map((p, i) => <span key={i} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-ink">
        <Dot index={i} size="h-2.5 w-2.5" /><span className="max-w-[6rem] truncate">{p.nombre}</span><strong className="tabular-nums">{ticketMoney(p.importe, ticket.moneda)}</strong>
      </span>)}
    </div>}
    {error && <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    {shareStatus && <p role="status" className="mb-2 text-xs text-ink-soft">{shareStatus}</p>}
    <div className="flex gap-2">
      {step === 'review' && <>
        <button type="button" className={`${secondary} shrink-0`} disabled={!valid || saving} onClick={() => goTo('people')}><Users size={16} /> Repartir</button>
        <button type="button" className={primary} disabled={!valid || saving} onClick={() => void save()}>{saveLabel}</button>
      </>}
      {step === 'people' && <button type="button" className={primary} disabled={people.length < 2} onClick={() => { setActivePerson(1); goTo('assign'); }}>{people.length < 2 ? 'Añade al menos una persona' : 'Asignar líneas'}</button>}
      {step === 'assign' && <button type="button" className={primary} onClick={() => goTo('summary')}>Ver resumen</button>}
      {step === 'summary' && <>
        <button type="button" className={`${secondary} shrink-0`} disabled={!valid || saving} onClick={() => void share()}><Share2 size={16} /> Compartir</button>
        <button type="button" className={primary} disabled={!valid || saving} onClick={() => void save()}>{saveLabel}</button>
      </>}
    </div>
  </>;

  return createPortal(<div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
    <div aria-hidden="true" className="absolute inset-0 hidden bg-slate-950/45 backdrop-blur-sm sm:block dark:bg-black/65" onClick={close} />
    <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      className="relative flex h-[100dvh] w-full flex-col bg-surface outline-none sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:overflow-hidden sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl">
      <header className="shrink-0 border-b border-line px-2 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center gap-1">
          {splitting
            ? <button type="button" aria-label="Atrás" className="dashboard-icon-button shrink-0" onClick={goBack}><ArrowLeft size={18} /></button>
            : <span className="flex h-10 w-10 shrink-0 items-center justify-center text-ink"><ScanLine size={20} /></span>}
          <div className="min-w-0 flex-1 px-1">
            <h2 id={titleId} className="truncate font-title text-base font-bold text-ink">{ticket ? (splitting ? STEPS[stepIndex].label : ticket.comercio || 'Ticket') : 'Ticket'}</h2>
            {ticket && <p className="truncate text-xs text-ink-faint">{splitting ? `Paso ${stepIndex} de 3 · ${ticket.comercio}` : `${ticketMoney(ticket.total, ticket.moneda)} · ${ticket.lineas.length} líneas`}</p>}
          </div>
          <button type="button" aria-label="Cerrar" className="dashboard-icon-button shrink-0" onClick={close}><X size={18} /></button>
        </div>
        {splitting && <div className="flex gap-1 px-2 pb-2" aria-hidden="true">{[1, 2, 3].map(n => <span key={n} className={`h-1 flex-1 rounded-full ${n <= stepIndex ? 'bg-brand' : 'bg-surface-2'}`} />)}</div>}
      </header>

      <div ref={body} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {!ticket ? <div className="flex min-h-full flex-col items-center justify-center gap-4 py-8 text-center">
          {preview && <img src={preview} alt="Foto del ticket" className="max-h-56 max-w-full rounded-2xl object-contain" />}
          {!error && <p role="status" className="flex items-center gap-2 text-sm text-ink"><LoaderCircle size={18} className="animate-spin" /> Leyendo ticket…</p>}
          {error && <>
            <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            <div className="flex w-full max-w-xs flex-col gap-2">
              <button type="button" className={primary} onClick={() => { setError(''); setAttempt(a => a + 1); }}>Reintentar</button>
              <button type="button" className={secondary} onClick={onManual}>Escribirlo a mano</button>
            </div>
          </>}
        </div> : <fieldset disabled={saving} className="min-w-0">
          {step === 'review' && review}
          {step === 'people' && peopleStep}
          {step === 'assign' && assignStep}
          {step === 'summary' && summaryStep}
        </fieldset>}
      </div>

      {ticket && <footer className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>}
    </div>
  </div>, document.body);
}


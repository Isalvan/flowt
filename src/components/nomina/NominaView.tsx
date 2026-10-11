import type { ReactNode } from 'react';
import { CalendarClock, History, Hourglass, LockKeyhole, Split, type LucideIcon } from 'lucide-react';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { payrollSummary } from '../../utils/payrollSummary';
import { periodRangeLabel } from '../../utils/periods';
import { walletAccent } from '../../utils/walletAccent';
import { ServiceIcon } from '../dashboard/ServiceIcon';

interface NominaViewProps { movimientos: Movimiento[]; huchas: Hucha[]; suscripciones: Suscripcion[] }
const green = 'text-emerald-600 dark:text-emerald-400';
const rose = 'text-rose-500 dark:text-rose-400';
const longDate = (date: Date) => date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

function CardHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return <div className="mb-4 flex items-center gap-3">
    <span className="dashboard-icon bg-brand-tint text-brand-ink"><Icon size={18} /></span>
    <div className="min-w-0"><h3 className="dashboard-heading">{title}</h3><p className="dashboard-subtitle">{subtitle}</p></div>
  </div>;
}

function MoneyRow({ label, children, color = 'text-ink', strong = false }: { label: string; children: ReactNode; color?: string; strong?: boolean }) {
  return <div className="flex items-center justify-between py-3 text-sm">
    <span className={strong ? 'font-bold text-ink' : 'font-semibold text-ink-soft'}>{label}</span>
    <span className={`font-extrabold tabular-nums ${color}`}>{children}</span>
  </div>;
}

export function NominaView({ movimientos, huchas, suscripciones }: NominaViewProps) {
  const { formatCurrency, isLocked, openUnlockModal } = usePrivacy();
  const summary = isLocked ? null : payrollSummary(movimientos, huchas, suscripciones);
  const activeWallets = huchas.filter(hucha => hucha.activa !== false);
  const days = summary?.proxima.dias ?? 0;
  const remainingLabel = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
  return <div className="space-y-6 animate-in fade-in duration-500">
    <div>
      <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">Tu nómina</h2>
      {summary && <p className="dashboard-subtitle">Cobrada el {longDate(summary.nomina.fecha)} · la siguiente, hacia el {longDate(summary.proxima.fecha)} ({remainingLabel})</p>}
    </div>
    {isLocked ? <section className="dashboard-surface p-5">
      <div className="py-8 text-center"><p className="mb-4 text-sm text-ink-soft">Desbloquea Flowt para ver tu nómina.</p>
        <button type="button" className="dashboard-primary-button" onClick={() => openUnlockModal()}><LockKeyhole size={16} />Desbloquear</button>
      </div>
    </section> : !summary ? <section className="dashboard-surface p-5">
      <div className="dashboard-empty py-10"><p className="dashboard-heading">Aún no hemos visto ninguna nómina</p>
        <p className="mt-1 max-w-sm text-center text-xs text-ink-soft">Cuando llegue un ingreso con la categoría Nómina, aquí verás cómo se reparte y cuánto te queda hasta la siguiente.</p>
      </div>
    </section> : <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <section className="dashboard-surface p-5">
          <p className="eyebrow">Última nómina</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
            <p className="figure text-4xl text-ink sm:text-5xl">{formatCurrency(summary.nomina.importe)}</p>
            {summary.diferencia !== null && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${summary.diferencia > 0 ? `bg-emerald-500/10 ${green}` : summary.diferencia < 0 ? `bg-rose-500/10 ${rose}` : 'bg-surface-2 text-ink-soft'}`}>
              {summary.diferencia === 0 ? 'Igual que la anterior' : `${summary.diferencia > 0 ? '+' : '−'}${formatCurrency(Math.abs(summary.diferencia))} respecto a la anterior`}
            </span>}
          </div>
          {/* Three across needs room for a full amount; on a phone they read better as rows. */}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([['Ahorro', summary.ahorro], ['Suscripciones', summary.suscripciones], ['Libre', summary.libre]] as const).map(([label, amount]) => <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 sm:block sm:py-2">
              <p className="text-[11px] font-semibold text-ink-soft">{label}</p><p className="text-sm font-extrabold tabular-nums text-ink">{formatCurrency(amount)}</p>
            </div>)}
          </div>
        </section>
        <section className="dashboard-surface p-5">
          <CardHeader icon={Split} title="Cómo se repartió" subtitle="Entre tus carteras, según tus reglas" />
          <div className="space-y-3">{summary.reparto.map((row, index) => {
            const walletIndex = activeWallets.findIndex(hucha => hucha.id === row.huchaId);
            return <div key={row.huchaId}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-bold text-ink">{row.nombre}</span>
                <div className="shrink-0 text-right"><span className="mr-2 text-[11px] tabular-nums text-ink-soft">{row.porcentaje.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %</span><span className="text-[13px] font-extrabold tabular-nums text-ink">{formatCurrency(row.importe)}</span></div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${walletAccent(walletIndex < 0 ? index : walletIndex).fill}`} style={{ width: `${Math.min(100, Math.max(2, row.porcentaje))}%` }} /></div>
            </div>;
          })}</div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">{summary.repartoRegistrado ? 'Reparto aplicado al registrar el ingreso.' : 'Calculado con tus reglas actuales: este ingreso es anterior a que Flowt guardara el reparto.'}</p>
        </section>
      </div>
      <div className="min-w-0 space-y-4">
        <section className="dashboard-surface p-5">
          <CardHeader icon={Hourglass} title="Hasta la próxima nómina" subtitle="Lo que te queda de la parte libre" />
          <div className="divide-y divide-line">
            <MoneyRow label="Libre de esta nómina">{formatCurrency(summary.libre)}</MoneyRow>
            <MoneyRow label="Gastado desde entonces" color={rose}>{formatCurrency(summary.gastado)}</MoneyRow>
            <MoneyRow label="Te queda" strong color={summary.queda >= 0 ? green : rose}>{formatCurrency(summary.queda)}</MoneyRow>
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">{summary.porDia !== null ? `${days} ${days === 1 ? 'día' : 'días'} · ${formatCurrency(summary.porDia)} al día` : summary.queda < 0 ? 'Has gastado más que la parte libre de esta nómina.' : days === 0 ? 'La siguiente nómina debería llegar hoy.' : null}</p>
        </section>
        <section className="dashboard-surface p-5">
          <CardHeader icon={CalendarClock} title="Cargos antes de la próxima" subtitle="Suscripciones que se cobran hasta entonces" />
          {summary.cargos.length ? <>
            <div className="divide-y divide-line">{summary.cargos.map(({ sub, fecha, importe }) => <div key={`${sub.id}-${fecha.getTime()}`} className="flex items-center gap-3 py-3">
              <ServiceIcon name={sub.nombre} color={sub.color} />
              <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold text-ink">{sub.nombre}</p><p className="text-[11px] text-ink-soft">{fecha.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '')}</p></div>
              <span className="text-[13px] font-extrabold tabular-nums text-ink">{formatCurrency(importe)}</span>
            </div>)}</div>
            <div className="mt-1 flex items-center justify-between border-t border-line pt-3"><span className="text-xs font-bold text-ink-soft">Total</span><span className="text-sm font-extrabold tabular-nums text-ink">{formatCurrency(summary.totalCargos)}</span></div>
            {huchas.some(hucha => hucha.es_suscripciones) && <p className="mt-1 text-[11px] text-ink-faint">Salen de tu cartera de suscripciones.</p>}
          </> : <div className="dashboard-empty"><p>No hay cargos antes de la próxima nómina</p></div>}
        </section>
      </div>
      {/* Closes the page across both columns, so neither column ends in a gap. */}
      {summary.periodoAnterior && <section className="dashboard-surface p-5 lg:col-span-3">
        <CardHeader icon={History} title="El periodo anterior" subtitle={periodRangeLabel(summary.periodoAnterior.period)} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            ['Ingresos', summary.periodoAnterior.ingresos, green],
            ['Gastos', summary.periodoAnterior.gastos, rose],
            [summary.periodoAnterior.neto >= 0 ? 'Te sobraron' : 'Gastaste de más', Math.abs(summary.periodoAnterior.neto), summary.periodoAnterior.neto >= 0 ? green : rose],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 sm:block">
              <p className="text-[11px] font-semibold text-ink-soft">{label}</p>
              <p className={`text-sm font-extrabold tabular-nums sm:mt-0.5 sm:text-base ${color}`}>{formatCurrency(value)}</p>
            </div>
          ))}
        </div>
      </section>}
    </div>}
  </div>;
}

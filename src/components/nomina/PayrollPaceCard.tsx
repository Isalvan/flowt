import { Gauge } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';
import { usePrivacy } from '../../context/PrivacyContext';
import { dayCount, paceHeadline, type PacePoint, type PayrollPace } from '../../utils/payrollPace';

const green = 'text-emerald-600 dark:text-emerald-400';
const rose = 'text-rose-500 dark:text-rose-400';
const percent = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;

export function PayrollPaceCard({ pace }: { pace: PayrollPace }) {
  const { formatCurrency } = usePrivacy();
  const value = (amount: number) => pace.unidad === 'porcentaje' ? percent(amount) : formatCurrency(amount);
  const hasGhost = pace.ciclos >= 2;
  const lead = pace.diasDeVentaja;
  const detail = pace.fantasmaHoy === null ? null : pace.unidad === 'porcentaje'
    ? `Llevas el ${percent(pace.actual)} de la parte libre; normalmente a estas alturas llevas el ${percent(pace.fantasmaHoy)}.`
    : `Llevas ${formatCurrency(pace.actual)} gastados; normalmente a estas alturas llevas ${formatCurrency(pace.fantasmaHoy)}.`;

  const renderTooltip = ({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) => {
    const point = payload?.[0]?.payload as PacePoint | undefined;
    if (!active || !point) return null;
    return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-bold text-ink">Día {point.dia}</p>
      {point.actual !== undefined && <p className="text-ink">Tú: <span className="font-bold tabular-nums">{value(point.actual)}</span>
        {pace.unidad === 'porcentaje' && point.actualImporte !== undefined && <span className="text-ink-soft"> · {formatCurrency(point.actualImporte)}</span>}</p>}
      {point.fantasma !== undefined && <p className="text-ink-soft">Habitual: <span className="font-bold tabular-nums">{value(point.fantasma)}</span></p>}
      {point.banda && <p className="text-ink-faint">Entre {value(point.banda[0])} y {value(point.banda[1])}</p>}
    </div>;
  };

  return <section className="dashboard-surface p-5 lg:col-span-3">
    <div className="mb-4 flex items-center gap-3">
      <span className="dashboard-icon bg-brand-tint text-brand-ink"><Gauge size={18} /></span>
      <div className="min-w-0">
        <h3 className="dashboard-heading">Tu ritmo de gasto</h3>
        <p className="dashboard-subtitle">{hasGhost ? `Comparado con tus últimas ${pace.ciclos} nóminas` : 'Comparado con tus nóminas anteriores'}</p>
      </div>
    </div>
    {!hasGhost ? <div className="dashboard-empty py-6">
      <p className="dashboard-heading">Aún no hay con qué comparar</p>
      <p className="mt-1 max-w-sm text-center text-xs text-ink-soft">Cuando tengas dos nóminas completas anteriores, aquí verás si gastas más deprisa o más despacio de lo habitual.</p>
    </div> : <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-base font-bold text-ink">{paceHeadline(pace)}</p>
        {lead !== null && lead !== 0 && pace.hoy > 0 && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${lead > 0 ? `bg-emerald-500/10 ${green}` : `bg-rose-500/10 ${rose}`}`}>
          {lead > 0 ? '+' : '−'}{dayCount(Math.abs(lead))}
        </span>}
      </div>
      {detail && <p className="mt-1 text-xs text-ink-soft">{detail}</p>}
      <div className="mt-4 h-44" role="img" aria-label={`${paceHeadline(pace)}.${detail ? ` ${detail}` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pace.puntos} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--line-strong)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dia" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-faint)', fontSize: 11 }} tickFormatter={(day: number) => `día ${day}`} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--ink-faint)', fontSize: 11 }}
              tickFormatter={(amount: number) => pace.unidad === 'porcentaje' ? `${amount} %` : formatCurrency(amount)} />
            <Tooltip content={renderTooltip} cursor={{ stroke: 'var(--line-strong)' }} />
            <Area type="monotone" dataKey={(point: PacePoint) => point.banda} name="Rango habitual" stroke="none" fill="var(--ink-faint)" fillOpacity={0.15} isAnimationActive={false} />
            <Line type="monotone" dataKey="fantasma" name="Habitual" stroke="var(--ink-soft)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" name="Tú" stroke="var(--brand)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft" aria-hidden="true">
        <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-[var(--brand)]" />Tú</span>
        <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-[var(--ink-soft)]" />Habitual</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-5 rounded-sm bg-[var(--ink-faint)] opacity-30" />Rango habitual</span>
      </div>
      {pace.reglasActuales && <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">Alguna nómina anterior no guardó su reparto: su parte libre está calculada con tus reglas actuales.</p>}
    </>}
  </section>;
}

import { Rewind } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import type { EchoItem, YearEcho } from '../../utils/yearEcho';
import { ServiceIcon } from '../dashboard/ServiceIcon';

const green = 'text-emerald-600 dark:text-emerald-400';
const amber = 'text-amber-600 dark:text-amber-400';
const shortDate = (date: Date) => date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
const times = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} veces`;

const whenLabel = (dias: number): string =>
  dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;

function detail(item: EchoItem): string {
  const lastYear = `Hace un año, el ${shortDate(item.fechaPasada)}`;
  if (item.tipo === 'pico') return `${lastYear} · ${item.veces ? `${times(item.veces)} lo normal` : 'más de lo normal'}`;
  return `${lastYear} · ${whenLabel(item.dias)}`;
}

export function YearEchoCard({ echo }: { echo: YearEcho }) {
  const { formatCurrency } = usePrivacy();
  const pending = echo.items.filter(item => !item.pagado);
  return <section className="dashboard-surface p-5">
    <div className="mb-4 flex items-center gap-3">
      <span className="dashboard-icon bg-brand-tint text-brand-ink"><Rewind size={18} /></span>
      <div className="min-w-0">
        <h3 className="dashboard-heading">El eco del año pasado</h3>
        <p className="dashboard-subtitle">Lo que pagaste por estas fechas hace un año</p>
      </div>
    </div>
    {!echo.items.length ? <div className="dashboard-empty">
      <p>Hace un año, en las próximas semanas, no hubo gastos fuera de lo normal</p>
    </div> : <>
      <p className="text-sm font-bold text-ink">
        {pending.length
          ? `Podrían volver ${formatCurrency(echo.pendiente)} en los próximos ${echo.horizonte} días`
          : 'Lo de estas fechas ya está pagado este año'}
      </p>
      <div className="mt-2 divide-y divide-line">{echo.items.map(item => <div key={item.key} className="flex items-center gap-3 py-3">
        <ServiceIcon name={item.nombre} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink">{item.nombre}</p>
          <p className="text-[11px] text-ink-soft">{detail(item)}</p>
          {item.pagado
            ? <p className={`text-[11px] font-semibold ${green}`}>Ya pagado el {shortDate(item.pagado.fecha)} ({formatCurrency(item.pagado.importe)})</p>
            : item.antesDeNomina && <p className={`text-[11px] font-semibold ${amber}`}>Antes de tu próxima nómina</p>}
        </div>
        <span className={`shrink-0 text-[13px] font-extrabold tabular-nums ${item.pagado ? 'text-ink-faint line-through' : 'text-ink'}`}>
          {item.tipo === 'pico' ? '+' : ''}{formatCurrency(item.importe)}
        </span>
      </div>)}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        No cuenta suscripciones: esas ya salen en «Cargos antes de la próxima». Con «+», lo que gastaste de más frente a lo habitual en ese sitio.
      </p>
    </>}
  </section>;
}

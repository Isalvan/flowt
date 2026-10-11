import React from 'react';
import { CheckCircle, CreditCard, Edit3, Gift, Lock, PiggyBank, Trash2, User, Wallet, WalletCards } from 'lucide-react';
import { CountUp } from '../common/CountUp';
import { type Hucha } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { walletAccent } from '../../utils/walletAccent';

interface HuchaCardProps {
  hucha: Hucha;
  /** Position among the active wallets; picks the wallet's colour. */
  index?: number;
  onEdit: (hucha: Hucha) => void;
  onDelete: (hucha: Hucha) => void;
  onSubsanar?: (hucha: Hucha) => void;
  onRevertirDeuda?: (hucha: Hucha) => void;
}

const normalizeHuchaName = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const renderHuchaIcon = (hucha: Hucha) => {
  const name = normalizeHuchaName(hucha.nombre);
  if (hucha.es_suscripciones || name.includes('suscrip')) return <CreditCard size={18} />;
  if (hucha.es_metalico || name.includes('efectivo') || name.includes('metalico')) return <Wallet size={18} />;
  if (name.includes('personal')) return <User size={18} />;
  if (name.includes('intocable')) return <Lock size={18} />;
  if (name.includes('ahorro') || hucha.objetivo) return <PiggyBank size={18} />;
  return <WalletCards size={18} />;
};

export const HuchaCard: React.FC<HuchaCardProps> = ({ hucha, index = 0, onEdit, onDelete, onSubsanar, onRevertirDeuda }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const accent = walletAccent(index);
  const months = [...(hucha.extra_meses || [])].sort((a, b) => a - b).map(month => monthNames[month - 1]);
  const extraMonths = months.length > 1 ? `${months.slice(0, -1).join(', ')} y ${months[months.length - 1]}` : months[0];
  const hasGoal = Boolean(hucha.objetivo && hucha.objetivo > 0);
  const full = hasGoal && hucha.saldo_acumulado >= (hucha.objetivo || 0);
  const percent = hasGoal ? Math.min(100, Math.max(0, Math.round((hucha.saldo_acumulado / (hucha.objetivo || 1)) * 100))) : 0;
  const rule =
    hucha.tipo_aportacion === 'porcentaje'
      ? `${hucha.valor_aportacion}% de cada ingreso`
      : hucha.tipo_aportacion === 'flat'
        ? `${isLocked ? '••' : hucha.valor_aportacion} € de cada ingreso`
        : 'El resto de cada ingreso';

  return (
    <article className="dashboard-surface is-liftable group relative flex h-full flex-col p-4">
      <div className="flex items-start gap-3">
        <span className={`dashboard-icon ${accent.chip}`}>{renderHuchaIcon(hucha)}</span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-bold text-ink" title={hucha.nombre}>{hucha.nombre}</h4>
          <p className="mt-0.5 truncate text-[11px] text-ink-soft">{rule}</p>
        </div>
        {/* Always there on touch; on a pointer it steps in over the title on hover or focus */}
        <div className="flex shrink-0 gap-0.5 rounded-xl sm:absolute sm:right-3 sm:top-3 sm:bg-surface sm:opacity-0 sm:shadow-[0_0_0_6px_var(--surface)] sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button type="button" aria-label={`Editar ${hucha.nombre}`} onClick={() => onEdit(hucha)} className="dashboard-icon-button">
            <Edit3 size={14} />
          </button>
          <button type="button" aria-label={`Eliminar ${hucha.nombre}`} onClick={() => onDelete(hucha)} className="dashboard-icon-button is-danger">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <p className={`figure text-2xl ${hucha.saldo_acumulado < 0 ? 'text-rose-500' : 'text-ink'}`}>
          {isLocked ? '•••• €' : <CountUp end={hucha.saldo_acumulado} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1} />}
        </p>
        {full && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle size={14} /> Completa
          </span>
        )}
      </div>

      {hasGoal ? (
        <div className="mt-4">
          <div className="flow-meter">
            {percent > 0 && <i className={accent.ink} style={{ width: `${percent}%` }} />}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-soft">
            <span className="truncate">
              de {isLocked ? '•• €' : <CountUp end={hucha.objetivo || 0} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1} />}
            </span>
            <span className="font-bold tabular-nums text-ink">
              {isLocked ? <Lock size={12} /> : `${percent}%`}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-ink-faint">Sin objetivo</p>
      )}

      {/* At the foot of the card, so every wallet keeps its balance on the same line. */}
      {(hucha.extra_importe || 0) > 0 && months.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-ink-soft">
          <Gift size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-faint" />
          <span>Paga extra de {formatCurrency(hucha.extra_importe!)} en {extraMonths}</span>
        </p>
      )}

      {(hucha.deuda_pendiente || 0) > 0 && (
        <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-rose-500">
          Deuda: {isLocked ? '•• €' : formatCurrency(hucha.deuda_pendiente || 0)}
          {onRevertirDeuda && (
            <button type="button" onClick={() => onRevertirDeuda(hucha)} className="underline underline-offset-2">
              Revertir
            </button>
          )}
        </div>
      )}
      {hucha.saldo_acumulado < (hucha.subsanar_hasta || 0) && onSubsanar && (
        <button type="button" onClick={() => onSubsanar(hucha)} className="mt-3 self-start text-[11px] font-bold text-rose-600 underline underline-offset-2 dark:text-rose-400">
          Subsanar deuda
        </button>
      )}
    </article>
  );
};

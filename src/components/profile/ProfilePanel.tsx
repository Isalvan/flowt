import React, { useEffect } from 'react';
import { User, LogOut, Key, ShieldOff, X } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { usePreferences } from '../../context/PreferencesContext';
import type { Hucha, Movimiento } from '../../types';
import { payrollDates } from '../../utils/periods';

interface ProfilePanelProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  onLogout: () => void;
  movimientos?: Movimiento[];
  huchas?: Hucha[];
}

export const ProfilePanel: React.FC<ProfilePanelProps> = ({
  isOpen,
  onClose,
  user,
  onLogout,
  movimientos = [],
  huchas = [],
}) => {
  const { hasPin, openCreateModal, removePin, isLocked } = usePrivacy();
  const { horasSemanales, umbralCompraPequena, inicioPeriodo, cifraDestacada, updatePreferences } = usePreferences();
  const wallets = huchas.filter(h => h.activa !== false);

  const savePreference = (input: HTMLInputElement, field: 'horasSemanales' | 'umbralCompraPequena') => {
    const previous = field === 'horasSemanales' ? horasSemanales : umbralCompraPequena;
    const value = input.value === '' && field === 'horasSemanales' ? null : input.valueAsNumber;
    if (!input.validity.valid || (value !== null && !Number.isFinite(value))) {
      input.value = previous === null ? '' : String(previous);
      return;
    }
    if (value !== previous) void updatePreferences({ [field]: value });
  };

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleChangePin = () => {
    onClose();
    if (isLocked) {
      // If locked, we need to unlock first before changing, but openCreateModal overwrites it immediately.
      // Wait, openCreateModal sets mode to 'create'. 
      openCreateModal();
    } else {
      openCreateModal();
    }
  };

  const handleRemovePin = async () => {
    await removePin();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 animate-in fade-in duration-300 cursor-pointer"
        onClick={onClose}
      />
      
      {/* Slide-over Panel */}
      <div className="absolute top-0 right-0 h-full w-full max-w-sm bg-surface border-l border-line shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header Area */}
        <div className="relative shrink-0 border-b border-line bg-surface-2 p-6">
          {/* Close Button */}
          <button 
            type="button"
            onClick={onClose}
            className="dashboard-icon-button absolute top-5 right-5"
            aria-label="Cerrar panel"
          >
            <X size={16} />
          </button>

          {/* User Info */}
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-brand-tint text-brand-ink flex items-center justify-center shrink-0">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Foto de perfil" className="h-full w-full rounded-2xl object-cover" />
              ) : (
                <User size={28} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="dashboard-heading truncate">
                {user?.displayName || 'Usuario'}
              </h2>
              <p className="dashboard-subtitle truncate">
                {user?.email || 'Modo demo'}
              </p>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar">
          
          {/* Preferences Section */}
          <section className="flex flex-col gap-3">
            <h3 className="dashboard-label">Preferencias</h3>
            <div className="rounded-2xl bg-surface-2 p-5 flex flex-col gap-5">
              {wallets.length > 0 && <div>
                <label className="field-label" htmlFor="profile-featured">Cifra destacada</label>
                <select id="profile-featured" className="field" aria-describedby="profile-featured-hint"
                  value={wallets.some(h => h.id === cifraDestacada) ? cifraDestacada! : ''}
                  onChange={event => { void updatePreferences({ cifraDestacada: event.target.value || null }); }}>
                  <option value="">Saldo total</option>
                  {wallets.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                </select>
                <p id="profile-featured-hint" className="field-hint">La cifra grande al abrir Flowt. El saldo total queda a un toque.</p>
              </div>}
              <div>
                <label className="field-label" htmlFor="profile-period-start">Inicio de tu periodo</label>
                <select id="profile-period-start" className="field"
                  value={inicioPeriodo === 'nomina' ? 'nomina' : inicioPeriodo === 1 ? 'natural' : 'fixed'}
                  aria-describedby="profile-period-hint"
                  onChange={event => { void updatePreferences({ inicioPeriodo: event.target.value === 'nomina' ? 'nomina' : event.target.value === 'fixed' ? 28 : 1 }); }}>
                  <option value="natural">Día 1 (mes natural)</option>
                  <option value="nomina">Cuando cobro la nómina</option>
                  <option value="fixed">Un día fijo</option>
                </select>
                {typeof inicioPeriodo === 'number' && inicioPeriodo !== 1 && <>
                  <label className="field-label mt-3" htmlFor="profile-period-day">Día de inicio</label>
                  <input key={`period-${inicioPeriodo}`} id="profile-period-day" className="field" type="number"
                    min={2} max={28} step={1} required defaultValue={inicioPeriodo} aria-describedby="profile-period-hint"
                    onBlur={event => {
                      const input = event.currentTarget;
                      if (input.validity.valid && Number.isInteger(input.valueAsNumber)) void updatePreferences({ inicioPeriodo: input.valueAsNumber });
                      else input.value = String(inicioPeriodo);
                    }}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
                </>}
                <p id="profile-period-hint" className="field-hint">{inicioPeriodo === 'nomina' && !payrollDates(movimientos).length
                  ? 'Aún no hemos visto ninguna nómina; mientras tanto se usa el mes natural.'
                  : 'Tus resúmenes y comparativas irán de este día al mismo del mes siguiente.'}</p>
              </div>
              <div>
                <label className="field-label" htmlFor="profile-weekly-hours">Horas de trabajo a la semana</label>
                <input
                  key={`hours-${horasSemanales}`}
                  id="profile-weekly-hours"
                  className="field"
                  type="number"
                  min={1}
                  max={80}
                  step="any"
                  defaultValue={horasSemanales ?? ''}
                  aria-describedby="profile-weekly-hours-hint"
                  onBlur={event => savePreference(event.currentTarget, 'horasSemanales')}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                />
                <p id="profile-weekly-hours-hint" className="field-hint">Para ver cuánto tiempo de trabajo cuesta un gasto. Déjalo vacío para no mostrarlo.</p>
              </div>
              <div>
                <label className="field-label" htmlFor="profile-small-purchase">Compra pequeña</label>
                <div className="relative">
                  <input
                    key={`threshold-${umbralCompraPequena}`}
                    id="profile-small-purchase"
                    className="field has-unit"
                    type="number"
                    min={1}
                    max={100}
                    step="any"
                    required
                    defaultValue={umbralCompraPequena}
                    aria-describedby="profile-small-purchase-hint"
                    onBlur={event => savePreference(event.currentTarget, 'umbralCompraPequena')}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">€</span>
                </div>
                <p id="profile-small-purchase-hint" className="field-hint">Las compras por debajo de este importe se suman aparte.</p>
              </div>
            </div>
          </section>

          {/* Security Section */}
          <section className="flex flex-col gap-3">
            <h3 className="dashboard-label">
              Seguridad de la cuenta
            </h3>
            
            <div className="rounded-2xl bg-surface-2 p-2 flex flex-col gap-1">
              <button 
                type="button"
                onClick={handleChangePin}
                className="w-full flex items-center gap-3.5 p-3 rounded-xl hover:bg-surface transition-colors text-left"
              >
                <span className="dashboard-icon bg-brand-tint text-brand-ink">
                  <Key size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-ink">
                    {hasPin ? 'Cambiar PIN actual' : 'Crear un nuevo PIN'}
                  </span>
                  <span className="block text-xs text-ink-soft mt-0.5">
                    Protege tus saldos con código de 4 dígitos
                  </span>
                </div>
              </button>

              {hasPin && (
                <button 
                  type="button"
                  onClick={handleRemovePin}
                  className="w-full flex items-center gap-3.5 p-3 rounded-xl hover:bg-surface transition-colors text-left"
                >
                  <span className="dashboard-icon bg-rose-500/10 text-rose-500 dark:text-rose-400">
                    <ShieldOff size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-ink">
                      Eliminar PIN
                    </span>
                    <span className="block text-xs text-ink-soft mt-0.5">
                      Desactivar la protección por código
                    </span>
                  </div>
                </button>
              )}
            </div>
          </section>

          {/* Account Actions */}
          <section className="mt-auto">
             <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="dashboard-secondary-button w-full !py-3 !text-rose-500 dark:!text-rose-400 hover:!bg-rose-500/10"
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
          </section>

        </div>
      </div>
    </div>
  );
};

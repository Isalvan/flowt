import React, { useState } from 'react';
import { MailOpen, Clock, Fingerprint, ChevronDown, ChevronUp, Link } from 'lucide-react';
import type { CorreoHistorico } from '../../types';

interface HistoricoCorreosViewProps {
  historicoCorreos: CorreoHistorico[];
}

export const HistoricoCorreosView: React.FC<HistoricoCorreosViewProps> = ({ historicoCorreos }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink">
          <MailOpen size={18} />
        </span>
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
            Histórico de correos
          </h2>
          <p className="dashboard-subtitle">
            Registro de notificaciones procesadas y sus movimientos vinculados.
          </p>
        </div>
      </div>

      {historicoCorreos.length === 0 ? (
        <div className="dashboard-empty p-12">
          <MailOpen size={32} className="text-ink-faint" />
          <h3 className="dashboard-heading">No hay correos en el historial</h3>
          <p className="max-w-md text-xs text-ink-soft">
            Aquí aparecerán todos los correos que se han procesado exitosamente y han generado movimientos en tus huchas (tanto los automáticos como los aprobados manualmente).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {historicoCorreos.map((correo) => {
            const isExpanded = expandedId === correo.id;

            return (
              <div 
                key={correo.id}
                className="dashboard-surface overflow-hidden"
              >
                {/* Header / Summary */}
                <div 
                  className="flex flex-col md:flex-row gap-4 p-5 cursor-pointer relative z-10"
                  onClick={() => toggleExpand(correo.id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Clock size={16} className="text-brand-ink" />
                      <span className="text-sm font-bold text-ink">
                        {formatDate(correo.fecha_envio)}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-2 text-ink-soft border border-line flex items-center gap-1.5">
                        <Fingerprint size={12} />
                        ID: {correo.id.slice(0, 8)}…
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {correo.movimientos_generados?.map((movId, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                          <Link size={12} />
                          Mov: {movId.slice(0, 6)}…
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end md:justify-center w-12 shrink-0">
                    <button type="button" className="dashboard-icon-button" aria-label={isExpanded ? 'Plegar' : 'Desplegar'}>
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Content: HTML Render */}
                <div 
                  className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                >
                  <div className="overflow-hidden">
                    <div className="p-5 pt-0 border-t border-line bg-surface-2 relative">
                      <h4 className="text-xs font-bold text-ink-soft my-3">
                        Contenido original
                      </h4>
                      
                      <div className="relative rounded-2xl bg-surface border border-line overflow-hidden h-[600px] custom-scrollbar">
                        <iframe
                          srcDoc={`<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:1.5rem;color:#334155;}@media(prefers-color-scheme:dark){body{color:#cbd5e1;}}</style></head><body>${correo.cuerpo}</body></html>`}
                          title={`Correo ${correo.id}`}
                          sandbox=""
                          className="w-full h-full bg-transparent border-0"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

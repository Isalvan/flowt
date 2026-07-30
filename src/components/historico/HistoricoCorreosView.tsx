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
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <MailOpen size={28} className="drop-shadow-sm" />
          </div>
          Histórico de Correos
        </h2>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 pl-14">
          Registro de notificaciones procesadas y sus movimientos vinculados.
        </p>
      </div>

      {historicoCorreos.length === 0 ? (
        <div className="relative overflow-hidden rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl p-12 text-center shadow-xl">
          <div className="mx-auto w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
            <MailOpen size={32} className="text-slate-400 dark:text-slate-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-700 dark:text-slate-300 mb-2">No hay correos en el historial</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Aquí aparecerán todos los correos que se han procesado exitosamente y han generado movimientos en tus huchas (tanto los automáticos como los aprobados manualmente).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {historicoCorreos.map((correo) => {
            const isExpanded = expandedId === correo.id;

            return (
              <div 
                key={correo.id}
                className="group relative overflow-hidden rounded-[2rem] border border-slate-200/50 dark:border-white/10 bg-white/60 dark:bg-slate-900/60 backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition-all duration-300 hover:shadow-[0_8px_40px_rgba(99,102,241,0.08)]"
              >
                {/* Header / Summary */}
                <div 
                  className="flex flex-col md:flex-row gap-4 p-6 cursor-pointer relative z-10"
                  onClick={() => toggleExpand(correo.id)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Clock size={16} className="text-indigo-500" />
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {formatDate(correo.fecha_envio)}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/5 flex items-center gap-1.5">
                        <Fingerprint size={12} />
                        ID: {correo.id.slice(0, 8)}...
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      {correo.movimientos_generados?.map((movId, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold shadow-sm">
                          <Link size={12} />
                          Mov: {movId.slice(0, 6)}...
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end md:justify-center w-12 shrink-0">
                    <button className="w-10 h-10 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 transition-colors">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Content: HTML Render */}
                <div 
                  className={`grid transition-all duration-500 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                >
                  <div className="overflow-hidden">
                    <div className="p-6 pt-0 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-slate-950/50 relative">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                        Contenido Original
                        <div className="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-slate-800 to-transparent" />
                      </h4>
                      
                      {/* Premium Glass Container for Email Body */}
                      <div className="relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-inner overflow-hidden h-[600px] custom-scrollbar">
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

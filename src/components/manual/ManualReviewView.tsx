import React, { useState, useEffect } from 'react';
import { Card } from '../common/Card';
import { type PendingEmail, type Hucha } from '../../types';
import { 
  Inbox, 
  Trash2, 
  CheckCircle, 
  Mail, 
  ArrowUpRight, 
  ArrowDownRight, 
  FileText, 
  Info,
  Sparkles,
  AlertTriangle
} from 'lucide-react';

interface ManualReviewViewProps {
  pendingEmails: PendingEmail[];
  huchas: Hucha[];
  onApprove: (emailId: string, data: { tipo: 'ingreso' | 'gasto', concepto: string, importe: number, fecha_operacion: string, hucha_id?: string }) => Promise<void>;
  onDiscard: (emailId: string) => Promise<void>;
}

export const ManualReviewView: React.FC<ManualReviewViewProps> = ({
  pendingEmails,
  huchas,
  onApprove,
  onDiscard,
}) => {
  const [selectedEmail, setSelectedEmail] = useState<PendingEmail | null>(null);
  const [viewMode, setViewMode] = useState<'text' | 'html'>('text');

  // Check if current body has HTML tags
  const isHtml = selectedEmail ? /<[a-z][\s\S]*>/i.test(selectedEmail.cuerpo) : false;

  // Automatically update viewMode based on HTML detection when selected email changes
  useEffect(() => {
    if (selectedEmail) {
      const hasHtml = /<[a-z][\s\S]*>/i.test(selectedEmail.cuerpo);
      setViewMode(hasHtml ? 'html' : 'text');
    }
  }, [selectedEmail]);
  
  // Form states
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [tipo, setTipo] = useState<'ingreso' | 'gasto'>('gasto');
  const [fecha, setFecha] = useState('');
  const [selectedHuchaId, setSelectedHuchaId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);



  // Helper to extract a clean date string yyyy-mm-dd from raw email date
  const parseDateToISO = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
      return d.toISOString().slice(0, 10);
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };

  // Automatically pre-fill the form whenever the selected email changes
  useEffect(() => {
    if (selectedEmail) {
      // 1. Try to extract clean details using simple regex from raw body
      const body = selectedEmail.cuerpo;
      const lowerBody = body.toLowerCase();
      
      // Basic type extraction
      let inferredType: 'ingreso' | 'gasto' = 'gasto';
      if (lowerBody.includes('abono') || lowerBody.includes('transferencia recibida') || lowerBody.includes('ingreso') || lowerBody.includes('bizum de')) {
        inferredType = 'ingreso';
      }
      
      // Basic amount extraction (EUR or €)
      let inferredAmount = '';
      const amountRegex = /(\d+(?:[.,]\d{2})?)\s*(?:eur|€)/i;
      const match = body.match(amountRegex);
      if (match && match[1]) {
        inferredAmount = match[1].replace(',', '.');
      }

      // Basic concept/merchant extraction
      let inferredConcept = '';
      if (inferredType === 'gasto') {
        const merchantRegex = /(?:comercio|establecimiento|en|de)\s+([A-Z0-9*_\-\s]{3,20})(?:\.|\n|\s)/i;
        const merchantMatch = body.match(merchantRegex);
        if (merchantMatch && merchantMatch[1]) {
          inferredConcept = `Cargo ${merchantMatch[1].trim()}`;
        } else {
          inferredConcept = 'Gasto Manual';
        }
      } else {
        const bizumSenderRegex = /(?:bizum de|de)\s+([A-Z\s]{3,25})(?:\s+el|\.|\n)/i;
        const bizumMatch = body.match(bizumSenderRegex);
        if (bizumMatch && bizumMatch[1]) {
          inferredConcept = `Bizum de ${bizumMatch[1].trim()}`;
        } else {
          inferredConcept = 'Abono Manual';
        }
      }

      setConcepto(inferredConcept);
      setImporte(inferredAmount);
      setTipo(inferredType);
      setFecha(parseDateToISO(selectedEmail.fecha_envio));
      setSelectedHuchaId(inferredType === 'gasto' ? (huchas.find(h => h.es_principal)?.id || '') : '');
    } else {
      setConcepto('');
      setImporte('');
      setTipo('gasto');
      setFecha('');
      setSelectedHuchaId('');
    }
  }, [selectedEmail, huchas]);

  const handleApproveClick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmail || isSubmitting) return;

    if (!concepto.trim()) {
      alert('Por favor introduce un concepto.');
      return;
    }
    const amt = parseFloat(importe);
    if (Number.isNaN(amt) || amt <= 0) {
      alert('Por favor introduce un importe válido.');
      return;
    }
    if (!fecha) {
      alert('Por favor selecciona una fecha.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onApprove(selectedEmail.id, {
        tipo,
        concepto: concepto.trim(),
        importe: amt,
        fecha_operacion: new Date(fecha).toISOString(),
        hucha_id: selectedHuchaId || undefined
      });
      setSelectedEmail(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDiscardClick = async () => {
    if (!selectedEmail || isSubmitting) return;
    if (confirm(`¿Descartar este correo? Se eliminará de la cola definitivamente.`)) {
      setIsSubmitting(true);
      try {
        await onDiscard(selectedEmail.id);
        setSelectedEmail(null);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Header */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
          Revisión Manual
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-500">
          Correos bancarios que requirieron revisión o tuvieron baja confianza en el parseo automático
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Left Side: Pending Emails List (1/3 width) */}
        <div className="space-y-4">
          <h3 className="font-extrabold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Inbox className="w-4 h-4" />
            Bandeja de Pendientes ({pendingEmails.length})
          </h3>
          
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {pendingEmails.length > 0 ? (
              pendingEmails.map((email) => {
                const dateLabel = new Date(email.fecha_envio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                return (
                  <button
                    key={email.id}
                    onClick={() => setSelectedEmail(email)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                      selectedEmail?.id === email.id
                        ? 'bg-indigo-500/10 border-indigo-500/30 text-slate-800 dark:text-slate-100 shadow-md ring-2 ring-indigo-500/10'
                        : 'bg-white/40 dark:bg-slate-900/20 border-white/5 hover:border-slate-350 dark:hover:border-white/10 hover:bg-white/80 dark:hover:bg-slate-950/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-indigo-500 dark:text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded-lg border border-indigo-500/10 shrink-0">
                        <Mail className="w-3 h-3" /> Gmail ID
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 tabular-nums">{dateLabel}</span>
                    </div>
                    
                    <p className="text-xs text-slate-500 dark:text-slate-450 line-clamp-2 leading-relaxed font-semibold italic mt-2">
                      "{email.cuerpo.slice(0, 120)}..."
                    </p>
                    
                    <div className="flex items-center gap-1 text-[8.5px] font-bold text-rose-500 dark:text-rose-400 mt-3 uppercase tracking-wider bg-rose-500/5 px-2.5 py-1 rounded-xl border border-rose-500/10 w-fit">
                      <AlertTriangle className="w-3 h-3" />
                      {email.motivo}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center p-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 text-center">
                <CheckCircle className="w-10 h-10 text-emerald-500 mb-3 animate-pulse" />
                <p className="font-extrabold text-sm text-slate-400 dark:text-slate-600 uppercase tracking-widest">¡Todo al día!</p>
                <p className="text-xs text-slate-400 mt-1">No hay correos pendientes de revisión manual.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Split Screen Workspace (2/3 width) */}
        <div className="lg:col-span-2">
          {selectedEmail ? (
            <div className="grid gap-6 md:grid-cols-2 h-full">
              
              {/* Left Workspace Panel: Raw Email Content */}
              <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl p-5 flex flex-col justify-between h-full">
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between gap-4 mb-4 border-b border-slate-150/40 dark:border-white/5 pb-3 shrink-0">
                    <div className="flex items-center gap-1.5 font-extrabold text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      Correo Bancario
                    </div>
                    
                    {isHtml && (
                      <div className="flex items-center bg-slate-100/70 dark:bg-slate-900/50 p-0.5 rounded-xl border border-slate-200/40 dark:border-white/5 shadow-inner">
                        <button
                          type="button"
                          onClick={() => setViewMode('html')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                            viewMode === 'html'
                              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600 dark:text-slate-505 dark:hover:text-slate-300'
                          }`}
                        >
                          <Sparkles className="w-3 h-3" />
                          Formateado
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('text')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-200 cursor-pointer ${
                            viewMode === 'text'
                              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600 dark:text-slate-505 dark:hover:text-slate-300'
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          Plano
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-h-[420px] max-h-[420px] flex">
                    {viewMode === 'html' ? (
                      <iframe
                        srcDoc={selectedEmail.cuerpo}
                        title="Formatted Email Preview"
                        sandbox="allow-popups"
                        className="w-full h-full bg-white rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-inner overflow-hidden select-text"
                      />
                    ) : (
                      <div className="w-full h-full overflow-y-auto pr-1 bg-slate-100/40 dark:bg-slate-950/20 border border-slate-200/50 dark:border-white/5 p-4 rounded-2xl text-[11px] leading-relaxed font-mono whitespace-pre-wrap select-text text-slate-700 dark:text-slate-300">
                        {selectedEmail.cuerpo}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/5 flex gap-2.5 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 text-[9.5px] leading-relaxed text-indigo-700 dark:text-indigo-300 shrink-0">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <span>
                    El remitente y la fecha del correo (`{new Date(selectedEmail.fecha_envio).toLocaleString()}`) se utilizan como metadatos de validación.
                  </span>
                </div>
              </Card>

              {/* Right Workspace Panel: Approval and Adjustment Form */}
              <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl p-5 flex flex-col justify-between h-full">
                <form onSubmit={handleApproveClick} className="space-y-4 h-full flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 font-extrabold text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-3">
                      <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                      Ajuste de Transacción
                    </div>

                    <div className="space-y-4">
                      {/* Type toggle selection */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Tipo de Movimiento</label>
                        <div className="flex bg-slate-100/60 dark:bg-slate-900 p-1 rounded-2xl border border-slate-200/40 dark:border-white/5">
                          <button
                            type="button"
                            onClick={() => setTipo('gasto')}
                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 ${
                              tipo === 'gasto'
                                ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-sm'
                                : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350'
                            }`}
                          >
                            <ArrowDownRight size={14} />
                            Gasto
                          </button>
                          <button
                            type="button"
                            onClick={() => setTipo('ingreso')}
                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 ${
                              tipo === 'ingreso'
                                ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm'
                                : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-350'
                            }`}
                          >
                            <ArrowUpRight size={14} />
                            Ingreso
                          </button>
                        </div>
                      </div>

                      {/* Concept input */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Concepto</label>
                        <input
                          type="text"
                          required
                          value={concepto}
                          onChange={(e) => setConcepto(e.target.value)}
                          placeholder="Ej: Nómina Mayo, Compra Super..."
                          className="w-full text-xs font-bold bg-white/40 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Import and Date row */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Importe (€)</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            placeholder="0.00"
                            value={importe}
                            onChange={(e) => setImporte(e.target.value)}
                            className="w-full text-xs font-bold bg-white/40 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Fecha Operación</label>
                          <input
                            type="date"
                            required
                            value={fecha}
                            onChange={(e) => setFecha(e.target.value)}
                            className="w-full text-xs font-bold bg-white/40 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      </div>

                      {/* Hucha selector */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                          {tipo === 'gasto' ? 'Cartera Destino (Gasto)' : 'Cartera Destino (Ingreso)'}
                        </label>
                        <select
                          value={selectedHuchaId}
                          onChange={(e) => setSelectedHuchaId(e.target.value)}
                          className="w-full text-xs font-bold bg-white/40 dark:bg-slate-950/20 text-slate-755 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-3 py-2.5 focus:outline-none cursor-pointer"
                        >
                          {tipo === 'ingreso' ? (
                            <>
                              <option value="">Distribuir automáticamente (Nómina)</option>
                              {huchas.map(h => (
                                <option key={h.id} value={h.id}>Meter todo en: {h.nombre}</option>
                              ))}
                            </>
                          ) : (
                            huchas
                              .filter(h => !h.es_suscripciones)
                              .map(h => (
                                <option key={h.id} value={h.id}>{h.nombre}</option>
                              ))
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex gap-2.5 pt-4 border-t border-white/5 mt-4">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-450 hover:to-teal-500 text-white font-extrabold text-xs uppercase tracking-widest rounded-2xl active:scale-95 shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Registrar
                    </button>
                    
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleDiscardClick}
                      className="py-3 px-4 border border-rose-500/20 hover:bg-rose-500 text-rose-500 hover:text-white font-bold text-xs uppercase tracking-widest rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Descartar correo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </Card>

            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 text-center h-[520px]">
              <Mail className="w-16 h-16 text-indigo-500/30 dark:text-indigo-400/20 mb-4 animate-bounce" />
              <h3 className="font-extrabold text-base text-slate-700 dark:text-slate-350 uppercase tracking-wider">Espacio de Revisión</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                Selecciona un correo bancario de la bandeja de entrada de la izquierda para analizarlo y registrarlo manualmente.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

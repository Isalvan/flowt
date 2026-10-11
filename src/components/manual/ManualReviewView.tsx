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
          inferredConcept = 'Gasto manual';
        }
      } else {
        const bizumSenderRegex = /(?:bizum de|de)\s+([A-Z\s]{3,25})(?:\s+el|\.|\n)/i;
        const bizumMatch = body.match(bizumSenderRegex);
        if (bizumMatch && bizumMatch[1]) {
          inferredConcept = `Bizum de ${bizumMatch[1].trim()}`;
        } else {
          inferredConcept = 'Abono manual';
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
        <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
          Revisión manual
        </h2>
        <p className="dashboard-subtitle">
          Correos bancarios que requirieron revisión o tuvieron baja confianza en el parseo automático
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Left Side: Pending Emails List (1/3 width) */}
        <div className="space-y-4">
          <h3 className="dashboard-heading flex items-center gap-2">
            <Inbox className="h-4 w-4 text-ink-faint" />
            Pendientes ({pendingEmails.length})
          </h3>
          
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {pendingEmails.length > 0 ? (
              pendingEmails.map((email) => {
                const dateLabel = new Date(email.fecha_envio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                return (
                  <button
                    key={email.id}
                    type="button"
                    onClick={() => setSelectedEmail(email)}
                    aria-pressed={selectedEmail?.id === email.id}
                    className="choice-card w-full"
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-brand-ink bg-brand-tint px-2 py-0.5 rounded-lg shrink-0">
                        <Mail className="w-3.5 h-3.5" /> Gmail ID
                      </span>
                      <span className="text-[11px] font-semibold text-ink-faint tabular-nums">{dateLabel}</span>
                    </div>
                    
                    <p className="text-xs text-ink-soft line-clamp-2 leading-relaxed font-semibold italic mt-1">
                      "{email.cuerpo.slice(0, 120)}…"
                    </p>
                    
                    <div className="flex items-center gap-1 text-[11px] font-bold text-rose-500 dark:text-rose-400 mt-2 bg-rose-500/10 px-2.5 py-1 rounded-xl">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {email.motivo}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="dashboard-empty p-8">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
                <p className="dashboard-heading">¡Todo al día!</p>
                <p className="text-xs text-ink-soft">No hay correos pendientes de revisión manual.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Split Screen Workspace (2/3 width) */}
        <div className="lg:col-span-2">
          {selectedEmail ? (
            <div className="grid gap-6 md:grid-cols-2 h-full">
              
              {/* Left Workspace Panel: Raw Email Content */}
              <Card className="flex flex-col justify-between h-full">
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between gap-4 mb-4 border-b border-line pb-3 shrink-0">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-ink-soft">
                      <FileText className="w-4 h-4 text-brand-ink" />
                      Correo bancario
                    </div>
                    
                    {isHtml && (
                      <div role="group" aria-label="Modo de vista" className="segmented">
                        <button
                          type="button"
                          onClick={() => setViewMode('html')}
                          aria-pressed={viewMode === 'html'}
                          className="segmented-item"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Formateado
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('text')}
                          aria-pressed={viewMode === 'text'}
                          className="segmented-item"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Plano
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 min-h-[420px] max-h-[420px] flex">
                    {viewMode === 'html' ? (
                      <iframe
                        srcDoc={`<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:1.5rem;color:#334155;}@media(prefers-color-scheme:dark){body{color:#cbd5e1;}}</style></head><body>${selectedEmail.cuerpo}</body></html>`}
                        title="Vista previa del correo"
                        sandbox=""
                        className="w-full h-full bg-surface rounded-2xl border border-line shadow-inner overflow-hidden select-text"
                      />
                    ) : (
                      <div className="w-full h-full overflow-y-auto pr-1 bg-surface-2 border border-line p-4 rounded-2xl text-[11px] leading-relaxed font-mono whitespace-pre-wrap select-text text-ink">
                        {selectedEmail.cuerpo}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-line flex gap-2 rounded-2xl bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-soft shrink-0">
                  <Info size={14} className="shrink-0 mt-0.5 text-brand-ink" />
                  <span>
                    El remitente y la fecha del correo (`{new Date(selectedEmail.fecha_envio).toLocaleString()}`) se utilizan como metadatos de validación.
                  </span>
                </div>
              </Card>

              {/* Right Workspace Panel: Approval and Adjustment Form */}
              <Card className="flex flex-col justify-between h-full">
                <form onSubmit={handleApproveClick} className="space-y-4 h-full flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-xs text-ink-soft mb-4 border-b border-line pb-3">
                      <Sparkles className="w-4 h-4 text-brand-ink" />
                      Ajuste de transacción
                    </div>

                    <div className="space-y-4">
                      {/* Type toggle selection */}
                      <div className="flex flex-col gap-1.5">
                        <label className="field-label">Tipo de movimiento</label>
                        <div role="group" aria-label="Tipo de movimiento" className="segmented w-full">
                          <button
                            type="button"
                            onClick={() => setTipo('gasto')}
                            aria-pressed={tipo === 'gasto'}
                            className="segmented-item flex-1 justify-center"
                          >
                            <ArrowDownRight size={14} className="text-rose-500" />
                            Gasto
                          </button>
                          <button
                            type="button"
                            onClick={() => setTipo('ingreso')}
                            aria-pressed={tipo === 'ingreso'}
                            className="segmented-item flex-1 justify-center"
                          >
                            <ArrowUpRight size={14} className="text-emerald-600 dark:text-emerald-400" />
                            Ingreso
                          </button>
                        </div>
                      </div>

                      {/* Concept input */}
                      <div className="flex flex-col gap-1">
                        <label htmlFor="manual-concepto" className="field-label">Concepto</label>
                        <input
                          id="manual-concepto"
                          type="text"
                          required
                          value={concepto}
                          onChange={(e) => setConcepto(e.target.value)}
                          placeholder="Ej: Nómina mayo, compra super…"
                          className="field"
                        />
                      </div>

                      {/* Import and Date row */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label htmlFor="manual-importe" className="field-label">Importe (€)</label>
                          <input
                            id="manual-importe"
                            type="number"
                            step="0.01"
                            required
                            placeholder="0.00"
                            value={importe}
                            onChange={(e) => setImporte(e.target.value)}
                            className="field tabular-nums"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label htmlFor="manual-fecha" className="field-label">Fecha operación</label>
                          <input
                            id="manual-fecha"
                            type="date"
                            required
                            value={fecha}
                            onChange={(e) => setFecha(e.target.value)}
                            className="field"
                          />
                        </div>
                      </div>

                      {/* Hucha selector */}
                      <div className="flex flex-col gap-1">
                        <label htmlFor="manual-hucha" className="field-label">
                          {tipo === 'gasto' ? 'Cartera destino (gasto)' : 'Cartera destino (ingreso)'}
                        </label>
                        <select
                          id="manual-hucha"
                          value={selectedHuchaId}
                          onChange={(e) => setSelectedHuchaId(e.target.value)}
                          className="field"
                        >
                          {tipo === 'ingreso' ? (
                            <>
                              <option value="">Distribuir automáticamente (nómina)</option>
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
                  <div className="flex gap-2.5 pt-4 border-t border-line mt-4">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="dashboard-primary-button flex-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Registrar
                    </button>
                    
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleDiscardClick}
                      className="dashboard-icon-button is-danger h-auto w-11 rounded-xl"
                      title="Descartar correo"
                      aria-label="Descartar correo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </Card>

            </div>
          ) : (
            <div className="dashboard-empty h-[520px]">
              <Mail className="mb-2 h-10 w-10 text-ink-faint" />
              <h3 className="dashboard-heading">Elige un correo para revisarlo</h3>
              <p className="text-xs text-ink-soft mt-1 max-w-sm">
                Selecciona un correo bancario de la bandeja de entrada de la izquierda para analizarlo y registrarlo manualmente.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { Mail, History } from 'lucide-react';
import { ManualReviewView } from '../manual/ManualReviewView';
import { HistoricoCorreosView } from '../historico/HistoricoCorreosView';
import type { PendingEmail, Hucha, CorreoHistorico } from '../../types';

interface CorreosOrchestratorProps {
  pendingEmails: PendingEmail[];
  historicoCorreos: CorreoHistorico[];
  huchas: Hucha[];
  onApprove: (emailId: string, data: { tipo: "gasto" | "ingreso"; concepto: string; importe: number; fecha_operacion: string; hucha_id?: string }) => Promise<void>;
  onDiscard: (emailRef: string) => Promise<void>;
}

export const CorreosOrchestrator: React.FC<CorreosOrchestratorProps> = ({
  pendingEmails,
  historicoCorreos,
  huchas,
  onApprove,
  onDiscard
}) => {
  // Determine default tab based on whether there are pending emails
  const [subTab, setSubTab] = useState<'revision' | 'historico'>(pendingEmails.length > 0 ? 'revision' : 'historico');

  const pendingCount = pendingEmails.length;

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Elegante selector de sub-vista tipo píldora */}
      <div className="no-scrollbar -mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:justify-center sm:px-0">
        <div className="segmented">
          
          <button
            onClick={() => setSubTab('revision')}
            aria-pressed={subTab === 'revision'}
            className="segmented-item"
          >
            <Mail size={16} className={subTab === 'revision' ? 'text-brand-ink' : ''} />
            Revisión manual
            {pendingCount > 0 && (
              <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-sun-500 px-1 text-[10px] font-extrabold leading-none text-slate-950">
                {pendingCount}
              </span>
            )}
          </button>
          
          <button
            onClick={() => setSubTab('historico')}
            aria-pressed={subTab === 'historico'}
            className="segmented-item"
          >
            <History size={16} className={subTab === 'historico' ? 'text-brand-ink' : ''} />
            Historial de correos
          </button>

        </div>
      </div>

      {/* Renderizado de la vista seleccionada */}
      <div className="w-full">
        {subTab === 'revision' ? (
          <ManualReviewView
            pendingEmails={pendingEmails}
            huchas={huchas}
            onApprove={onApprove}
            onDiscard={onDiscard}
          />
        ) : (
          <HistoricoCorreosView historicoCorreos={historicoCorreos} />
        )}
      </div>
      
    </div>
  );
};

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
      <div className="flex justify-center w-full">
        <div className="inline-flex bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 dark:border-white/5 shadow-sm">
          
          <button
            onClick={() => setSubTab('revision')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 cursor-pointer ${
              subTab === 'revision'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
            }`}
          >
            <Mail size={16} className={subTab === 'revision' ? 'text-indigo-500' : ''} />
            Revisión Manual
            {pendingCount > 0 && (
              <span className={`ml-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                subTab === 'revision' 
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300' 
                  : 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/20'
              }`}>
                {pendingCount}
              </span>
            )}
          </button>
          
          <button
            onClick={() => setSubTab('historico')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 cursor-pointer ${
              subTab === 'historico'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
            }`}
          >
            <History size={16} className={subTab === 'historico' ? 'text-indigo-500' : ''} />
            Historial de Correos
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

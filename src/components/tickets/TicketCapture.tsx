import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import { hasTicketApi } from '../../utils/ticketApi';
import type { TicketModalProps } from './TicketModal';

const TicketModal = lazy(() => import('./TicketModal').then(m => ({ default: m.TicketModal })));
export interface TicketCaptureHandle { open: () => void }

export const TicketCapture = forwardRef<TicketCaptureHandle, Omit<TicketModalProps, 'file' | 'onClose'>>(
  function TicketCapture(props, ref) {
    const input = useRef<HTMLInputElement>(null);
    const [session, setSession] = useState<{ file: File | null } | null>(null);
    useImperativeHandle(ref, () => ({ open: () => {
      if (props.demo || !hasTicketApi()) setSession({ file: null });
      else input.current?.click();
    } }), [props.demo]);
    return <>
      <input ref={input} type="file" accept="image/*" capture="environment" aria-label="Foto del ticket" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (file) setSession({ file });
        e.target.value = '';
      }} />
      {session && <Suspense fallback={<p role="status" className="fixed bottom-4 left-4 z-50 rounded-xl bg-surface p-4 text-sm text-ink">Abriendo lector de tickets…</p>}>
        <TicketModal {...props} file={session.file} onClose={() => setSession(null)} onManual={() => { setSession(null); props.onManual(); }} />
      </Suspense>}
    </>;
  },
);

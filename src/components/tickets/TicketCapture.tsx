import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import { hasTicketApi } from '../../utils/ticketApi';
import { isNativeApp } from '../../native/platform';
import type { TicketModalProps } from './TicketModal';

const TicketModal = lazy(() => import('./TicketModal').then(m => ({ default: m.TicketModal })));
export interface TicketCaptureHandle {
  open: () => void;
  /** Starts the reader on a photo that came from elsewhere, such as one shared to the app. */
  openWith: (file: File) => void;
}

export const TicketCapture = forwardRef<TicketCaptureHandle, Omit<TicketModalProps, 'file' | 'onClose'>>(
  function TicketCapture(props, ref) {
    const input = useRef<HTMLInputElement>(null);
    const [session, setSessionState] = useState<{ file: File | null; id: number } | null>(null);
    // A new photo always starts a fresh reader, even if one is already open.
    const setSession = (next: { file: File | null } | null) => setSessionState(next && { ...next, id: Date.now() });
    useImperativeHandle(ref, () => ({
      open: () => {
        if (props.demo || !hasTicketApi()) setSession({ file: null });
        // In the app, Android's own camera: the web file picker would also offer files and recordings.
        else if (isNativeApp()) {
          void import('../../native/camera').then(m => m.takeTicketPhoto())
            .then(file => { if (file) setSession({ file }); })
            .catch(error => { console.error('Camera failed:', error); input.current?.click(); });
        } else input.current?.click();
      },
      openWith: (file: File) => setSession({ file: hasTicketApi() ? file : null }),
    }), [props.demo]);
    return <>
      <input ref={input} type="file" accept="image/*" capture="environment" aria-label="Foto del ticket" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (file) setSession({ file });
        e.target.value = '';
      }} />
      {session && <Suspense fallback={<p role="status" className="fixed bottom-4 left-4 z-50 rounded-xl bg-surface p-4 text-sm text-ink">Abriendo lector de tickets…</p>}>
        <TicketModal key={session.id} {...props} file={session.file} onClose={() => setSession(null)} onManual={() => { setSession(null); props.onManual(); }} />
      </Suspense>}
    </>;
  },
);

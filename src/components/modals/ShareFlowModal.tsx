import { useMemo, useRef, useState } from 'react';
import type { MoneyFlow } from '../../utils/moneyFlow';
import { moneyFlowSvg, svgToPngBlob } from '../../utils/moneyFlowImage';
import { Modal } from '../common/Modal';

interface ShareFlowModalProps { flow: MoneyFlow; periodLabel: string; onClose: () => void }

export function ShareFlowModal({ flow, periodLabel, onClose }: ShareFlowModalProps) {
  const svg = useMemo(() => moneyFlowSvg(flow, periodLabel), [flow, periodLabel]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generating = useRef(false);
  const [canShare] = useState(() => {
    try { return !!navigator.canShare?.({ files: [new File([], 'flowt-flujo.png', { type: 'image/png' })] }); }
    catch { return false; }
  });
  const exportImage = async (share: boolean) => {
    if (generating.current) return;
    generating.current = true;
    setBusy(true);
    setError(false);
    try {
      const blob = await svgToPngBlob(svg, 1200, 900);
      const file = new File([blob], 'flowt-flujo.png', { type: 'image/png' });
      if (share) await navigator.share({ files: [file], title: 'A dónde va mi dinero' });
      else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        try {
          link.href = url;
          link.download = file.name;
          document.body.appendChild(link);
          link.click();
        } finally { link.remove(); URL.revokeObjectURL(url); }
      }
    } catch (reason) {
      if (!(reason && typeof reason === 'object' && 'name' in reason && reason.name === 'AbortError')) setError(true);
    } finally { generating.current = false; setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} title="Compartir tu flujo" size="md">
    <img alt="Vista previa de la imagen" className="w-full rounded-2xl border border-line" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
    <p className="mt-3 text-xs text-ink-soft">La imagen lleva solo porcentajes. Tus importes y tus movimientos no salen.</p>
    {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-500 dark:text-rose-400">No se ha podido crear la imagen.</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className={canShare ? 'dashboard-secondary-button' : 'dashboard-primary-button'} disabled={busy} onClick={() => void exportImage(false)}>Descargar</button>
      {canShare && <button type="button" className="dashboard-primary-button" disabled={busy} onClick={() => void exportImage(true)}>Compartir</button>}
    </div>
  </Modal>;
}

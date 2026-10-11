import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoneyFlow } from '../../utils/moneyFlow';
import { svgToPngBlob } from '../../utils/moneyFlowImage';
import { ShareFlowModal } from './ShareFlowModal';

vi.mock('../../utils/moneyFlowImage', async importOriginal => ({
  ...await importOriginal<typeof import('../../utils/moneyFlowImage')>(), svgToPngBlob: vi.fn(),
}));
const flow: MoneyFlow = { total: 100,
  sources: [{ id: 'nomina', label: 'Nómina', amount: 100, percent: 100, color: null }],
  destinations: [{ id: 'sin_gastar', label: 'Sin gastar', amount: 100, percent: 100, color: '#14b8a6' }],
};
const show = () => render(<ShareFlowModal flow={flow} periodLabel="Este mes" onClose={vi.fn()} />);

describe('ShareFlowModal', () => {
  beforeEach(() => {
    vi.mocked(svgToPngBlob).mockReset();
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('shows the preview and only the primary download button without file sharing', () => {
    show();
    expect(screen.getByAltText('Vista previa de la imagen')).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml;charset=utf-8,'));
    expect(screen.getByRole('button', { name: 'Descargar' })).toHaveClass('dashboard-primary-button');
    expect(screen.queryByRole('button', { name: 'Compartir' })).not.toBeInTheDocument();
  });
  it('offers native sharing when PNG files are supported and ignores cancellation', async () => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    vi.mocked(navigator.share).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled();
    await waitFor(() => expect(navigator.share).toHaveBeenCalledWith({ title: 'A dónde va mi dinero', files: [expect.any(File)] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compartir' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('allows retry after a failed PNG export', async () => {
    vi.mocked(svgToPngBlob).mockRejectedValue(new Error('failed'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha podido crear la imagen.');
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(svgToPngBlob).toHaveBeenCalledTimes(2));
  });
  it('downloads the generated PNG and revokes its temporary URL', async () => {
    vi.mocked(svgToPngBlob).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('flowt-flujo.png');
      expect(this.href).toBe('blob:download');
      expect(this.isConnected).toBe(true);
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:download');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

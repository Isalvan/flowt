import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoneyFlow } from './moneyFlow';
import { moneyFlowSvg, svgToPngBlob } from './moneyFlowImage';

const flow: MoneyFlow = { total: 1234.56,
  sources: [{ id: 'nomina', label: 'Nómina', amount: 1234.56, percent: 100, color: null }],
  destinations: [{ id: 'a', label: 'Casa < & " >', amount: 1234.56, percent: 100, color: '#14b8a6' }],
};

describe('moneyFlowSvg', () => {
  it('exports a standalone image with category names and only percentages', () => {
    const svg = moneyFlowSvg(flow, 'Este mes');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('Nómina');
    expect(svg).toContain('100 %');
    expect(svg).toContain('Este mes');
    for (const value of ['€', '1234.56', '1234,56', '1.234,56', 'currentColor', 'var(']) expect(svg).not.toContain(value);
  });
  it('escapes category labels and period labels', () => {
    const svg = moneyFlowSvg(flow, '<Mes & "a">');
    expect(svg).toContain('Casa &lt; &amp; &quot; &gt;');
    expect(svg).toContain('&lt;Mes &amp; &quot;a&quot;&gt;');
  });
});

describe('svgToPngBlob', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const setup = (load: boolean, blob: Blob | null = new Blob(['png'])) => {
    const revoke = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
    vi.stubGlobal('Image', class {
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => load ? this.onload?.() : this.onerror?.()); }
    });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      expect(this.width).toBe(2400);
      expect(this.height).toBe(1800);
      expect(type).toBe('image/png');
      callback(blob);
    });
    return { revoke, draw };
  };
  it('renders at double resolution and revokes the object URL', async () => {
    const { revoke, draw } = setup(true);
    expect(await svgToPngBlob(moneyFlowSvg(flow, 'Este mes'), 1200, 900)).toBeInstanceOf(Blob);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 2400, 1800);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview');
  });
  it.each([false, true])('rejects and revokes the URL on failure (loaded: %s)', async load => {
    const { revoke } = setup(load, null);
    await expect(svgToPngBlob('<svg/>', 1200, 900)).rejects.toThrow();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview');
  });
});

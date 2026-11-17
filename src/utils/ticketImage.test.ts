import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareTicketImage, ticketImageSize } from './ticketImage';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ticketImage', () => {
  it('limits the longest side to 1600 without upscaling', () => {
    expect(ticketImageSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(ticketImageSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(ticketImageSize(600, 800)).toEqual({ width: 600, height: 800 });
    expect(() => ticketImageSize(0, 40)).toThrow();
  });
  it('encodes a white-backed JPEG at 0.8 and releases the original URL', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: revoke });
    vi.stubGlobal('Image', class {
      naturalWidth = 3200;
      naturalHeight = 1600;
      onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const draw = vi.fn();
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: draw };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,cGhvdG8=');
    expect(await prepareTicketImage(new File(['photo'], 'photo.png', { type: 'image/png' }))).toEqual({ image: 'cGhvdG8=', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,cGhvdG8=' });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(context.fillStyle).toBe('#fff');
    expect(encode).toHaveBeenCalledWith('image/jpeg', 0.8);
    expect(revoke).toHaveBeenCalledWith('blob:photo');
  });
  it('rejects unsupported files and releases failed image URLs', async () => {
    await expect(prepareTicketImage(new File(['text'], 'ticket.txt', { type: 'text/plain' }))).rejects.toThrow('foto');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:bad', revokeObjectURL: revoke });
    vi.stubGlobal('Image', class { onerror?: () => void; set src(_value: string) { queueMicrotask(() => this.onerror?.()); } });
    await expect(prepareTicketImage(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }))).rejects.toThrow('abrir');
    expect(revoke).toHaveBeenCalledWith('blob:bad');
  });
});

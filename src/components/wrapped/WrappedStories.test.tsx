import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { buildWrapped, type WrappedPeriod } from '../../utils/wrapped';
import { WrappedStories } from './WrappedStories';

vi.mock('../../context/PrivacyContext', () => ({
  usePrivacy: () => ({
    isLocked: false,
    formatCurrency: (value: number) =>
      new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value),
  }),
}));

const d = (month: number, date = 1, year = 2026) => new Date(year, month - 1, date);
const october: WrappedPeriod = {
  scope: 'mes',
  key: 'mes:2026-10',
  label: 'octubre',
  start: d(10, 1),
  end: d(11, 1),
};

const sampleMovements: Movimiento[] = [
  { id: 'i1', tipo: 'ingreso', concepto: 'Nómina octubre', categoria: 'nomina', importe: 2000, fecha_operacion: d(10, 1) },
  { id: 'g1', tipo: 'gasto', concepto: 'Mercadona 1234', categoria: 'alimentacion', importe: 50, fecha_operacion: d(10, 2) },
  { id: 'g2', tipo: 'gasto', concepto: 'Mercadona 5678', categoria: 'alimentacion', importe: 40, fecha_operacion: d(10, 5) },
  { id: 'g3', tipo: 'gasto', concepto: 'Restaurante Sol', categoria: 'restaurantes', importe: 35, fecha_operacion: d(10, 10) },
  { id: 'g4', tipo: 'gasto', concepto: 'Cine Plaza', categoria: 'ocio', importe: 18, fecha_operacion: d(10, 15) },
  { id: 'g5', tipo: 'gasto', concepto: 'Viaje tren', categoria: 'transporte', importe: 80, fecha_operacion: d(10, 20) },
];

describe('WrappedStories', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra la portada, avanza con → y con clic en la mitad derecha, retrocede con ← y cierra con Esc', () => {
    const onClose = vi.fn();
    const data = buildWrapped(sampleMovements, october, { now: d(11, 3) })!;
    render(<WrappedStories data={data} onClose={onClose} />);

    // 1. Portada
    const dialog = screen.getByRole('dialog', { name: /Wrapped de octubre/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Tu octubre en Flowt/i })).toBeInTheDocument();

    // Avanza con tecla → a la diapositiva 2 (Gasto total)
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(/Gasto total/i)).toBeInTheDocument();

    // Avanza con clic en la mitad derecha a la diapositiva 3 (Categorías)
    fireEvent.click(dialog, { clientX: 800 });
    expect(screen.getByRole('heading', { name: /A dónde se fue tu dinero/i })).toBeInTheDocument();

    // También avanza pulsando la zona derecha directamente
    fireEvent.click(screen.getByRole('button', { name: /Siguiente diapositiva/i }));
    expect(screen.getByText(/Tu parada habitual/i)).toBeInTheDocument();

    // Retrocede con tecla ←
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: /A dónde se fue tu dinero/i })).toBeInTheDocument();

    // Esc cierra el overlay
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omite diapositivas vacías cuando no hay comercio favorito, racha ni curiosidades', () => {
    // 5 días consecutivos con cargos de suscripción cubriendo todo el periodo [1 oct, 6 oct):
    // comercioFavorito = null, rachaSinGastos.dias = 0, curiosidades = []
    const shortPeriod: WrappedPeriod = { ...october, end: d(10, 6) };
    const subOnly: Movimiento[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
      tipo: 'gasto',
      concepto: 'Suscripción',
      importe: 10,
      categoria: 'ocio',
      suscripcion_id: 'sub-1',
      fecha_operacion: d(10, i + 1),
    }));
    const data = buildWrapped(subOnly, shortPeriod, { now: d(10, 5) })!;
    expect(data.comercioFavorito).toBeNull();
    expect(data.rachaSinGastos.dias).toBe(0);
    expect(data.curiosidades).toEqual([]);

    render(<WrappedStories data={data} onClose={vi.fn()} />);

    // Con las 3 diapositivas vacías omitidas quedan 8 de las 11 diapositivas
    const progress = screen.getByRole('progressbar', { name: /Progreso del Wrapped/i });
    expect(progress).toHaveAttribute('aria-valuemax', '8');

    const visitedHeadings: string[] = [];
    for (let i = 0; i < 8; i++) {
      visitedHeadings.push(document.body.textContent ?? '');
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }
    const allText = visitedHeadings.join(' ');
    expect(allText).not.toContain('Tu parada habitual');
    expect(allText).not.toContain('Mayor racha sin gastar');
    expect(allText).not.toContain('Detalles que quizá no viste');
    expect(screen.getByRole('button', { name: /Ver otra vez/i })).toBeInTheDocument();

    // "Ver otra vez" vuelve a la portada
    fireEvent.click(screen.getByRole('button', { name: /Ver otra vez/i }));
    expect(screen.getByRole('heading', { name: /Tu octubre en Flowt/i })).toBeInTheDocument();
  });

  it('muestra "hasta hoy" cuando el periodo anual es parcial y permite compartir al portapapeles', async () => {
    const partialYear: WrappedPeriod = {
      scope: 'anio',
      key: 'anio:2026',
      label: '2026',
      start: d(1, 1),
      end: d(12, 5),
      parcial: true,
    };
    const data = buildWrapped(sampleMovements, partialYear, { now: d(12, 5) })!;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText }, share: undefined });
    const onShareToast = vi.fn();

    render(<WrappedStories data={data} onClose={vi.fn()} onShareToast={onShareToast} />);
    expect(screen.getByRole('heading', { name: /Tu 2026 en Flowt/i })).toBeInTheDocument();
    expect(screen.getByText(/hasta hoy/i)).toBeInTheDocument();

    // Avanzar hasta el resumen final
    for (let i = 0; i < 12; i++) {
      fireEvent.keyDown(window, { key: 'ArrowRight' });
    }
    fireEvent.click(screen.getByRole('button', { name: /Compartir/i }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(onShareToast).toHaveBeenCalledWith('Resumen copiado al portapapeles', 'success');
  });
});

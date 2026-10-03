import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { ActivityList } from './ActivityList';

const privacy = vi.hoisted(() => ({ locked: false }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: privacy.locked, formatCurrency: (n: number) => `${n} €` }) }));
const movements: Movimiento[] = [
  { id: 'i', tipo: 'ingreso', concepto: 'Persona de ejemplo', importe: 30, fecha_operacion: '2026-05-12T12:00:00+02:00' },
  { id: 'g', tipo: 'gasto', concepto: 'Restaurante de ejemplo', importe: 60, fecha_operacion: '2026-05-12T13:00:00+02:00' },
];
const setup = (onAccept = vi.fn().mockResolvedValue(undefined), allMovimientos = movements, recientes = allMovimientos) => {
  const onCategory = vi.fn().mockResolvedValue(undefined), onDismiss = vi.fn().mockResolvedValue(undefined), onAdjust = vi.fn();
  render(<ActivityList movimientos={recientes} allMovimientos={allMovimientos} huchas={[]} huchaMonthlyBudgets={{}} onUpdateCategoria={onCategory} onAcceptCompensation={onAccept} onDismissCompensation={onDismiss} onLink={onAdjust} onUpdateConcepto={vi.fn()} onConvert={vi.fn()} onUnlink={vi.fn()} onChangeHucha={vi.fn()} onDeleteMovimiento={vi.fn()} />);
  return { onCategory, onAccept, onDismiss, onAdjust };
};

describe('revisión rápida de propuestas', () => {
  it('muestra incertidumbre sin guardar ni vincular hasta que se confirme', async () => {
    const handlers = setup();
    expect(handlers.onCategory).not.toHaveBeenCalled();
    expect(handlers.onAccept).not.toHaveBeenCalled();
    expect(screen.getByText('¿Compensa este gasto?')).toBeInTheDocument();
    const income = within(screen.getByTestId('category-i'));
    expect(income.getByText('Revisar')).toBeInTheDocument();
    expect(income.getByRole('button', { name: 'Categoría de Persona de ejemplo' })).toHaveTextContent('Otros ingresos');
    fireEvent.click(income.getByRole('button', { name: /Confirmar Otros ingresos/ }));
    await waitFor(() => expect(handlers.onCategory).toHaveBeenCalledWith('i', 'otros_ingresos'));
  });
  it('guarda un cambio de categoría directamente desde el selector', async () => {
    const handlers = setup();
    fireEvent.click(within(screen.getByTestId('category-i')).getByRole('button', { name: 'Categoría de Persona de ejemplo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Regalos' }));
    await waitFor(() => expect(handlers.onCategory).toHaveBeenCalledWith('i', 'regalos'));
    expect(handlers.onAccept).not.toHaveBeenCalled();
  });
  it('acepta la pareja y el importe propuestos con un clic', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar 30 €' }));
    await waitFor(() => expect(handlers.onAccept).toHaveBeenCalledWith(movements[0], [{ mov: movements[1], importe: 30 }]));
  });
  it('permite ajustar o descartar sin crear la compensación', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar pareja o importe' }));
    expect(handlers.onAdjust).toHaveBeenCalledWith(movements[0]);
    fireEvent.click(screen.getByRole('button', { name: /Descartar compensación/ }));
    await waitFor(() => expect(handlers.onDismiss).toHaveBeenCalledWith('i', 'g'));
    expect(handlers.onAccept).not.toHaveBeenCalled();
  });
  it('muestra un error de persistencia y permite reintentar', async () => {
    setup(vi.fn().mockRejectedValue(new Error('El saldo ha cambiado')));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar 30 €' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El saldo ha cambiado');
    expect(screen.getByRole('button', { name: 'Aceptar 30 €' })).not.toBeDisabled();
  });
  it('oculta propuestas y controles mientras la privacidad está bloqueada', () => {
    privacy.locked = true;
    setup();
    expect(screen.queryByTestId('category-i')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceptar 30 €' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisar/ })).not.toBeInTheDocument();
    privacy.locked = false;
  });
  it('Revisar incluye compensaciones pendientes aunque la categoría esté confirmada y el ingreso no sea reciente', () => {
    const classified: Movimiento[] = movements.map(m => ({ ...m, categoria: m.tipo === 'ingreso' ? 'reembolsos' : 'restaurantes' }));
    setup(undefined, classified, [classified[1]]);
    expect(screen.queryByRole('button', { name: 'Aceptar 30 €' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Revisar 1/ }));
    expect(screen.getByRole('button', { name: 'Aceptar 30 €' })).toBeInTheDocument();
    expect(screen.queryByText('Restaurante de ejemplo', { selector: 'p[title]' })).not.toBeInTheDocument();
  });
});

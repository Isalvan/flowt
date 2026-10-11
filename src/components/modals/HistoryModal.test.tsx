import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Movimiento } from '../../types';
import { HistoryModal } from './HistoryModal';

afterEach(cleanup);

const movement = (id: string, concepto = `Movimiento ${id}`, tipo: Movimiento['tipo'] = 'gasto'): Movimiento =>
  ({ id, concepto, tipo, importe: 12.5, fecha_operacion: '2026-09-01' });
const windowHistory = Array.from({ length: 35 }, (_, index) => movement(String(index + 1)));
const baseProps = (): ComponentProps<typeof HistoryModal> => ({
  isOpen: true, onClose: vi.fn(), chartMovements: windowHistory, olderMovements: [],
  olderMovementsLoading: false, olderMovementsLoaded: false, olderMovementsError: false,
  loadOlderMovements: vi.fn().mockResolvedValue(undefined),
  onUpdateConcepto: vi.fn().mockResolvedValue(undefined), onUnlink: vi.fn().mockResolvedValue(undefined), onDeleteMovimiento: vi.fn(),
});
const search = (term: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: term } });

describe('complete movement history', () => {
  it('requests older history for search and completes results when it arrives', async () => {
    const props = baseProps();
    props.chartMovements = [movement('recent', 'Nómina reciente', 'ingreso')];
    const { rerender } = render(<HistoryModal {...props} />);
    expect(screen.getByRole('heading', { name: 'Historial completo' })).toHaveTextContent('Historial completo');
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Buscar por concepto o importe…');
    expect(props.loadOlderMovements).not.toHaveBeenCalled();
    search('nomina');
    await waitFor(() => expect(props.loadOlderMovements).toHaveBeenCalledTimes(1));
    rerender(<HistoryModal {...props} olderMovementsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Buscando en movimientos antiguos');
    expect(screen.getByText('Nómina reciente')).toBeInTheDocument();
    expect(screen.queryByText('Nómina antigua')).not.toBeInTheDocument();
    rerender(<HistoryModal {...props} olderMovementsLoaded olderMovements={[movement('older', 'Nómina antigua', 'ingreso')]} />);
    expect(screen.getByText('Nómina antigua')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
  });

  it('loads older movements when only the type filter is active and shows all matches', async () => {
    const props = baseProps();
    props.chartMovements = [...windowHistory, movement('income', 'Ingreso reciente', 'ingreso')];
    const { rerender } = render(<HistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ingresos' }));
    await waitFor(() => expect(props.loadOlderMovements).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Ingreso reciente')).toBeInTheDocument();
    expect(screen.queryByText('Movimiento 1')).not.toBeInTheDocument();
    rerender(<HistoryModal {...props} olderMovementsLoaded olderMovements={[movement('old-income', 'Ingreso antiguo', 'ingreso'), movement('old-expense')]} />);
    expect(screen.getByText('Ingreso antiguo')).toBeInTheDocument();
    expect(screen.queryByText('Movimiento old-expense')).not.toBeInTheDocument();
  });

  it('keeps recent matches on failure and offers an explicit retry', async () => {
    const props = baseProps();
    const { rerender } = render(<HistoryModal {...props} />);
    search('Movimiento');
    await waitFor(() => expect(props.loadOlderMovements).toHaveBeenCalledTimes(1));
    rerender(<HistoryModal {...props} olderMovementsError />);
    expect(screen.getByRole('alert')).toHaveClass('notice', 'is-danger');
    expect(screen.getByText('Movimiento 35')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(2);
    rerender(<HistoryModal {...props} olderMovementsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Buscando');
    rerender(<HistoryModal {...props} olderMovementsLoaded olderMovements={[movement('old')]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Movimiento old')).toBeInTheDocument();
  });

  it('reveals 15 more and loads older history when the next page crosses the window', async () => {
    const props = baseProps();
    const { rerender } = render(<HistoryModal {...props} />);
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(15);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(30);
    expect(props.loadOlderMovements).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
    rerender(<HistoryModal {...props} olderMovementsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando movimientos antiguos');
    expect(screen.getByText('Movimiento 35')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeDisabled();
    rerender(<HistoryModal {...props} olderMovementsLoaded olderMovements={Array.from({ length: 20 }, (_, i) => movement(`old-${i}`))} />);
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(45);
    expect(screen.getByText('Movimiento old-9')).toBeInTheDocument();
    expect(screen.queryByText('Movimiento old-10')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(55);
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('retries a failed older page and preserves the requested display limit', () => {
    const props = baseProps();
    props.chartMovements = windowHistory.slice(0, 15);
    const { rerender } = render(<HistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    rerender(<HistoryModal {...props} olderMovementsError />);
    expect(screen.getByText('Movimiento 15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(2);
    rerender(<HistoryModal {...props} olderMovementsLoaded olderMovements={windowHistory.slice(15)} />);
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(30);
  });

  it('can still reveal available recent movements after an older search fails', () => {
    const props = baseProps();
    const { rerender } = render(<HistoryModal {...props} />);
    search('Movimiento');
    rerender(<HistoryModal {...props} olderMovementsError />);
    search('');
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(35);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
  });

  it('uses the full demo list for search without loading and resets paging on reopen', () => {
    const props = { ...baseProps(), olderMovementsLoaded: true };
    const { rerender } = render(<HistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(30);
    search('12,5');
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(35);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gastos' }));
    search('');
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    rerender(<HistoryModal {...props} isOpen={false} />);
    rerender(<HistoryModal {...props} />);
    expect(screen.getAllByRole('button', { name: 'Editar concepto' })).toHaveLength(15);
    expect(props.loadOlderMovements).not.toHaveBeenCalled();
  });

  it('preserves editing, unlinking and deleting actions', async () => {
    const props = baseProps();
    const linked = { ...movement('linked'), compensado_por: ['income'] };
    props.chartMovements = [linked];
    render(<HistoryModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar concepto' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Concepto' }), { target: { value: ' Nuevo concepto ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar concepto' }));
    await waitFor(() => expect(props.onUpdateConcepto).toHaveBeenCalledWith('linked', 'Nuevo concepto'));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Concepto' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer todas las compensaciones de este gasto' }));
    expect(props.onUnlink).toHaveBeenCalledWith(linked);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar movimiento' }));
    expect(props.onDeleteMovimiento).toHaveBeenCalledWith(linked);
  });
});

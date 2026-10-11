import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { Movimiento } from '../../types';
import { ExportView } from './ExportView';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
vi.mock('../../hooks/useCategories', () => ({ useCategories: () => ({ categoryLabel: () => '', suggestCategory: () => null }) }));

const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(cleanup);

const movement = (id: string, tipo: Movimiento['tipo'], importe: number, extra: Partial<Movimiento> = {}): Movimiento =>
  ({ id, concepto: id, tipo, importe, fecha_operacion: '2026-10-01', ...extra });
const baseProps = (): ComponentProps<typeof ExportView> => ({
  movimientos: [movement('nómina', 'ingreso', 2000)], olderMovements: [],
  olderMovementsLoading: false, olderMovementsLoaded: false, olderMovementsError: false,
  loadOlderMovements: vi.fn().mockResolvedValue(undefined), huchas: [], suscripciones: [],
  userStats: { total_ingresos: 2104.99, total_gastos: 209.99 }, userId: undefined,
});

describe('exportación del historial completo', () => {
  it('pide los antiguos, mantiene los filtros visibles y desactiva la exportación hasta recibirlos', () => {
    const props = baseProps();
    const { rerender } = render(<ExportView {...props} />);
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando el historial completo…');
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    for (const name of ['Copiar como JSON', 'Copiar como Markdown', 'Descargar CSV sanitizado']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    rerender(<ExportView {...props} olderMovementsLoading />);
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
    rerender(<ExportView {...props} olderMovementsLoaded />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar como JSON' })).toBeEnabled();
  });

  it('muestra el fallo y permite reintentar sin exportar un historial incompleto', () => {
    const props = baseProps();
    const { rerender } = render(<ExportView {...props} olderMovementsError />);
    expect(props.loadOlderMovements).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveClass('notice');
    expect(screen.getByRole('button', { name: 'Copiar como JSON' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.loadOlderMovements).toHaveBeenCalledTimes(1);
    rerender(<ExportView {...props} olderMovementsLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<ExportView {...props} olderMovementsLoaded />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('en demo exporta sin esperar ni pedir movimientos antiguos', () => {
    const props = { ...baseProps(), olderMovementsLoaded: true };
    render(<ExportView {...props} />);
    expect(props.loadOlderMovements).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar CSV sanitizado' })).toBeEnabled();
  });

  it('exporta los netos históricos, separa devoluciones y conserva las notas detalladas', async () => {
    const props = baseProps();
    const gasto = movement('viaje antiguo', 'gasto', 209.99, {
      fecha_operacion: '2024-01-01', importe_neto: 105,
      compensado_por_detalles: [{ ingreso_id: 'devolución', importe: 104.99 }], compensado_por: ['devolución'],
    });
    props.movimientos.push(
      movement('devolución', 'ingreso', 104.99, { compensa_movimiento_id: gasto.id }),
      movement('salida', 'gasto', 100, { transfer_id: 'traspaso' }),
      movement('entrada', 'ingreso', 100, { transfer_id: 'traspaso' }),
    );
    props.olderMovements = [gasto, props.movimientos[0]];
    props.olderMovementsLoaded = true;
    render(<ExportView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar como JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = JSON.parse(writeText.mock.calls[0][0]);
    expect(report.estadisticas_globales).toEqual({
      total_ingresos_historicos: 2000, total_gastos_historicos: 105, balance_historico: 1895, total_devoluciones: 104.99,
    });
    expect(report.resumen_filtro_actual).toMatchObject({
      total_movimientos: 5, movimientos_externos: 2, balance_externo: 1895,
      movimientos_devoluciones: 1, total_devoluciones: 104.99,
      movimientos_internos: 2, balance_transferencias_internas: 0,
    });
    expect(report.devoluciones_recibidas_filtradas[0].concepto).toBe('devolución');
    expect(report.transferencias_internas_filtradas.map((m: { concepto: string }) => m.concepto)).toEqual(['salida', 'entrada']);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar como Markdown' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const markdown = writeText.mock.calls[1][0] as string;
    expect(markdown).toContain('**Gastos totales:** -105.00€');
    expect(markdown).toContain('Compensado (devolución: 104.99€). Neto: 105.00€');
    expect(markdown.split('## Devoluciones recibidas')[1].split('## Transferencias internas')[0]).toContain('Compensa: viaje antiguo');
    expect(markdown.split('## Transferencias internas')[1]).not.toContain('devolución');
  });

  it('detalla compensaciones parciales y gastos no disponibles', async () => {
    const props = { ...baseProps(), olderMovementsLoaded: true };
    props.movimientos = [movement('parcial', 'ingreso', 150, {
      compensaciones_destinos: [{ gasto_id: 'ausente', importe: 50 }],
    })];
    render(<ExportView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar como Markdown' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const markdown = writeText.mock.calls[0][0] as string;
    expect(markdown).toContain('**Ingresos totales:** +100.00€');
    expect(markdown).toContain('**Devoluciones recibidas:** +50.00€');
    expect(markdown.split('## Devoluciones recibidas')[1]).toContain('| parcial | +50.00€ | Compensa: Gasto no disponible (50.00€)');
  });
});

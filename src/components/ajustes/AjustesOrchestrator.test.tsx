import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../types';
import { AjustesOrchestrator } from './AjustesOrchestrator';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ formatCurrency: (n: number) => `${n.toFixed(2)} €` }) }));
vi.mock('./BancosView', () => ({ BancosView: () => <p>Bancos de prueba</p> }));
vi.mock('./CategoryHuchasView', () => ({ CategoryHuchasView: () => null }));
vi.mock('./ReviewHistoryView', () => ({ ReviewHistoryView: () => null }));
vi.mock('./ConnectionsView', () => ({ ConnectionsView: () => null }));
vi.mock('../export/ExportView', () => ({ ExportView: () => null }));

const props = () => ({
  suscripciones: [], huchas: [], onOpenSuscripcionModal: vi.fn(), onUpdateSuscripcion: vi.fn(),
  onDeleteSuscripcion: vi.fn(), onToggleSuscripcion: vi.fn(), onCancelSuscripcion: vi.fn(),
  onUndoCancelSuscripcion: vi.fn(), chartMovements: [] as Movimiento[], olderMovements: [] as Movimiento[],
  olderMovementsLoading: false, olderMovementsLoaded: true, olderMovementsError: false,
  loadOlderMovements: vi.fn(), userStats: null, userId: 'orchestrator', onRestoreHucha: vi.fn(),
});
const movements = (): Movimiento[] => [2, 1, 0].map(offset => {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - offset);
  return { id: `gym-${offset}`, tipo: 'gasto', concepto: `Gimnasio X REF: AB${offset}`, importe: 29.9, fecha_operacion: date };
});
beforeEach(() => localStorage.clear());
describe('avisos en Ajustes', () => {
  it('combina el historial sin duplicados, precarga el alta y mantiene el badge entre pestañas', () => {
    const p = props(); const history = movements();
    render(<AjustesOrchestrator {...p} chartMovements={history.slice(1)} olderMovements={history.slice(0, 2)} />);
    expect(screen.getByLabelText('1 avisos pendientes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir como suscripción' }));
    expect(p.onOpenSuscripcionModal).toHaveBeenCalledWith(null, expect.objectContaining({ nombre: 'Gimnasio X', importe: 29.9, frecuencia: 'mensual' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bancos' }));
    expect(screen.getByLabelText('1 avisos pendientes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Suscripciones/ }));
    fireEvent.click(screen.getByRole('button', { name: 'No es una suscripción' }));
    expect(screen.queryByLabelText('1 avisos pendientes')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
  });
  it('usa descartes de demo y retira candidatos al dar de alta la suscripción', () => {
    const p = props(); const history = movements();
    const { rerender } = render(<AjustesOrchestrator {...p} demo chartMovements={history} />);
    rerender(<AjustesOrchestrator {...p} demo chartMovements={history} suscripciones={[{
      id: 'added', nombre: 'Gimnasio X', importe: 29.9, dia_pago: 1, frecuencia: 'mensual', categoria: 'otros', activa: true, color: '#000',
    }]} />);
    expect(screen.queryByRole('region', { name: 'Avisos' })).not.toBeInTheDocument();
    rerender(<AjustesOrchestrator {...p} demo chartMovements={history} />);
    fireEvent.click(screen.getByRole('button', { name: 'No es una suscripción' }));
    expect(localStorage.getItem('flowt:recurring-dismissed:demo')).toContain('new:gimnasio x');
  });
});

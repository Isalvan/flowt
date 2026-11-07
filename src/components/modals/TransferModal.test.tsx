import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../../types';
import { TransferModal } from './TransferModal';

vi.mock('../common/Modal', () => ({ Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? <div>{children}</div> : null }));
const huchas: Hucha[] = [
  { id: 'main', nombre: 'Ahorros', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 200, objetivo: null, orden: 1 },
  { id: 'personal', nombre: 'Personal', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: 100, tope_objetivo: true, orden: 2 },
];

describe('préstamo desde el traspaso', () => {
  it('muestra la cuota redondeada y envía el préstamo sin aplicar topes', async () => {
    const onTransfer = vi.fn();
    const onPrestamo = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TransferModal isOpen onClose={onClose} onTransfer={onTransfer} onPrestamo={onPrestamo} huchas={huchas} />);
    fireEvent.change(screen.getByLabelText('Importe a traspasar (€)'), { target: { value: '104' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Es un préstamo' }));
    expect(screen.getByLabelText('Devolver en 3 meses')).toHaveValue(3);
    expect(screen.getByText(/34,67.*mes con cada nómina/)).toBeInTheDocument();
    expect(screen.queryByText(/rebotará/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Devolver en 3 meses'), { target: { value: '2' } });
    expect(screen.getByText(/52,00.*mes con cada nómina/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prestar' }));
    await waitFor(() => expect(onPrestamo).toHaveBeenCalledWith('main', 'personal', 104, 2));
    expect(onTransfer).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('conserva el traspaso normal al no activar el préstamo', async () => {
    const onTransfer = vi.fn().mockResolvedValue(undefined);
    const onPrestamo = vi.fn();
    render(<TransferModal isOpen onClose={vi.fn()} onTransfer={onTransfer} onPrestamo={onPrestamo} huchas={huchas} />);
    fireEvent.change(screen.getByLabelText('Importe a traspasar (€)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Traspasar' }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledWith('main', 'personal', 10));
    expect(onPrestamo).not.toHaveBeenCalled();
  });

  it('impide prestar a una cartera con deuda pendiente', () => {
    render(<TransferModal isOpen onClose={vi.fn()} onTransfer={vi.fn()} onPrestamo={vi.fn()} huchas={huchas.map(h => h.id === 'personal' ? { ...h, deuda_pendiente: 5 } : h)} />);
    fireEvent.change(screen.getByLabelText('Importe a traspasar (€)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Es un préstamo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Personal ya tiene un préstamo pendiente');
    expect(screen.getByRole('button', { name: 'Prestar' })).toBeDisabled();
  });

  it('calcula la vista previa con el mismo redondeo a céntimos que la acción', () => {
    render(<TransferModal isOpen onClose={vi.fn()} onTransfer={vi.fn()} onPrestamo={vi.fn()} huchas={huchas} />);
    fireEvent.change(screen.getByLabelText('Importe a traspasar (€)'), { target: { value: '1.005' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Es un préstamo' }));
    fireEvent.change(screen.getByLabelText('Devolver en 3 meses'), { target: { value: '1' } });
    expect(screen.getByText(/1,01.*mes con cada nómina/)).toBeInTheDocument();
  });
});

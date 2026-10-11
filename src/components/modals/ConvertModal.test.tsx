import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Hucha, Movimiento } from '../../types';
import { ConvertModal } from './ConvertModal';

vi.mock('../common/Modal', () => ({ Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? <div>{children}</div> : null }));

const huchas: Hucha[] = [
  { id: 'main', nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 100, objetivo: null, orden: 3 },
  { id: 'full', nombre: 'Llena', tipo_aportacion: 'flat', valor_aportacion: 80, saldo_acumulado: 100, objetivo: 100, tope_objetivo: true, orden: 1 },
  { id: 'debt', nombre: 'Deudora', tipo_aportacion: 'flat', valor_aportacion: 30, saldo_acumulado: 20, objetivo: null, deuda_pendiente: 25, deuda_con: 'main', orden: 2 },
];
const movimiento: Movimiento = { id: 'expense', tipo: 'gasto', concepto: 'Compra', importe: 100, hucha_id: 'full', fecha_operacion: '2026-10-01' };

describe('vista previa de conversión con el dominio', () => {
  it('previsualiza topes y deuda sin mutar las carteras y envía conversión automática', async () => {
    const before = structuredClone(huchas);
    const onConvert = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ConvertModal isOpen onClose={onClose} onConvert={onConvert} movimiento={movimiento} huchas={huchas} />);
    expect(screen.getByText(/95,00/)).toBeInTheDocument();
    expect(screen.getByText(/^5,00/)).toBeInTheDocument();
    expect(huchas).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Convertir movimiento' }));
    await waitFor(() => expect(onConvert).toHaveBeenCalledWith(movimiento, undefined, undefined));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('las filas editadas previsualizan importes explícitos sin tope ni deuda', async () => {
    const onConvert = vi.fn().mockResolvedValue(undefined);
    render(<ConvertModal isOpen onClose={vi.fn()} onConvert={onConvert} movimiento={movimiento} huchas={huchas} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '60' } });
    fireEvent.change(inputs[1], { target: { value: '40' } });
    expect(screen.getByText(/60,00/)).toBeInTheDocument();
    expect(screen.getByText(/40,00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Convertir movimiento' }));
    await waitFor(() => expect(onConvert).toHaveBeenCalledWith(movimiento, [
      { huchaId: 'main', tipoAportacion: 'resto', value: 0 },
      { huchaId: 'full', tipoAportacion: 'flat', value: 60 },
      { huchaId: 'debt', tipoAportacion: 'flat', value: 40 },
    ], undefined));
  });

  it('muestra el rechazo del dominio y desactiva enviar porcentajes >100', () => {
    const wallets = huchas.map(h => h.id === 'debt' ? { ...h, tipo_aportacion: 'porcentaje' as const, valor_aportacion: 150 } : h);
    render(<ConvertModal isOpen onClose={vi.fn()} onConvert={vi.fn()} movimiento={movimiento} huchas={wallets} />);
    expect(screen.getByRole('alert')).toHaveTextContent('100 %');
    expect(screen.getByRole('button', { name: 'Convertir movimiento' })).toBeDisabled();
  });

  it('previsualiza dos filas para la misma cartera y conserva ambas al enviar', async () => {
    const onConvert = vi.fn().mockResolvedValue(undefined);
    render(<ConvertModal isOpen onClose={vi.fn()} onConvert={onConvert} movimiento={movimiento} huchas={huchas.slice(0, 2)} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'full' } });
    expect(screen.getByText(/40,00/)).toBeInTheDocument();
    expect(screen.getByText(/60,00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Convertir movimiento' }));
    await waitFor(() => expect(onConvert).toHaveBeenCalledWith(movimiento, [
      { huchaId: 'full', tipoAportacion: 'resto', value: 0 },
      { huchaId: 'full', tipoAportacion: 'flat', value: 60 },
    ], undefined));
  });

  it('un error de la operación apaga la carga y mantiene abierto el modal', async () => {
    const onClose = vi.fn();
    const onConvert = vi.fn().mockRejectedValue(new Error('No hay ninguna cartera activa para repartir el ingreso'));
    render(<ConvertModal isOpen onClose={onClose} onConvert={onConvert} movimiento={movimiento} huchas={huchas} />);
    fireEvent.click(screen.getByRole('button', { name: 'Convertir movimiento' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No hay ninguna cartera activa'));
    expect(screen.getByRole('button', { name: 'Convertir movimiento' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../../types';
import { HuchaModal } from './HuchaModal';

vi.mock('../common/Modal', () => ({ Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => isOpen ? <div>{children}</div> : null }));

const wallet: Hucha = { id: 'personal', nombre: 'Personal', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: null, orden: 1 };
const open = (editingHucha: Hucha | null = wallet) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<HuchaModal isOpen onClose={vi.fn()} onSave={onSave} editingHucha={editingHucha} allHuchas={[wallet]} />);
  return onSave;
};

describe('paga extra del formulario', () => {
  it('valida cantidad y meses, permite marcar meses y envía los campos ordenados', async () => {
    const onSave = open();
    const checkbox = screen.getByRole('checkbox', { name: /Paga extra/ });
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByLabelText('Cantidad extra')).not.toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(screen.getByText('Indica una cantidad y al menos un mes.')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cantidad extra'), { target: { value: '100' } });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Diciembre' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agosto' }));
    expect(screen.getByRole('button', { name: 'Agosto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Julio' })).toHaveAttribute('aria-pressed', 'false');
    expect(save).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Agosto' }));
    expect(screen.getByRole('button', { name: 'Agosto' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Agosto' }));
    fireEvent.change(screen.getByLabelText('Cantidad extra'), { target: { value: '0' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Cantidad extra'), { target: { value: '100' } });
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ extra_importe: 100, extra_meses: [8, 12] }), 'personal'));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('extra_ultimo');
  });

  it('carga una configuración existente y desmarcar envía null sin tocar el último mes', async () => {
    const onSave = open({ ...wallet, extra_importe: 100, extra_meses: [8, 12], extra_ultimo: '2026-08' });
    expect(screen.getByRole('checkbox', { name: /Paga extra/ })).toBeChecked();
    expect(screen.getByLabelText('Cantidad extra')).toHaveValue(100);
    expect(screen.getByRole('button', { name: 'Agosto' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: /Paga extra/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ extra_importe: null, extra_meses: null }), 'personal'));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('extra_ultimo');
  });

  it.each(['flat', 'porcentaje', 'resto'] as const)('se muestra para aportación %s', tipo_aportacion => {
    open({ ...wallet, tipo_aportacion });
    expect(screen.getByRole('checkbox', { name: /Paga extra/ })).toBeInTheDocument();
  });

  it.each([{ es_suscripciones: true }, { es_metalico: true }, { es_interno: true }])('se oculta para carteras de sistema %j', flags => {
    open({ ...wallet, ...flags });
    expect(screen.queryByRole('checkbox', { name: /Paga extra/ })).not.toBeInTheDocument();
  });
});

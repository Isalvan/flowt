import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SuscripcionModal } from './SuscripcionModal';
import type { Hucha, Suscripcion } from '../../types';

const hucha: Hucha = {
  id: 'subscriptions', nombre: 'Suscripciones', es_suscripciones: true,
  saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', orden: 1,
};
describe('SuscripcionModal', () => {
  it('precarga un candidato como alta y guarda sin identificador de edición', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SuscripcionModal isOpen onClose={vi.fn()} onSave={onSave} editingSuscripcion={null} huchas={[hucha]}
      draft={{ nombre: 'Gimnasio X', importe: 29.9, frecuencia: 'mensual', fecha_inicio: '2026-03-10', dia_pago: 10, categoria: 'otros' }} />);
    expect(screen.getByRole('heading', { name: 'Nueva suscripción recurrente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Gimnasio X');
    expect(screen.getByLabelText('Total (€)')).toHaveValue(29.9);
    expect(screen.getByLabelText('Frecuencia')).toHaveValue('mensual');
    expect(screen.getByLabelText('Primer / próximo cobro')).toHaveValue('2026-03-10');
    expect(screen.getByLabelText('Imputar a cartera')).toHaveValue('subscriptions');
    fireEvent.click(screen.getByRole('button', { name: 'Crear suscripción' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Gimnasio X', importe: 29.9, dia_pago: 10, fecha_inicio: '2026-03-10', hucha_id: 'subscriptions' }), null));
  });
  it('respeta la edición y elimina los datos del borrador al abrir una alta vacía', () => {
    const editing: Suscripcion = { id: 'netflix', nombre: 'Netflix', importe: 15, dia_pago: 4, fecha_inicio: '2026-02-04', frecuencia: 'mensual', categoria: 'otros', color: '#000', activa: true };
    const p = { isOpen: true, onClose: vi.fn(), onSave: vi.fn(), huchas: [hucha] };
    const { rerender } = render(<SuscripcionModal {...p} editingSuscripcion={editing} draft={{ nombre: 'Gimnasio X' }} />);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Netflix');
    expect(screen.getByRole('button', { name: 'Guardar suscripción' })).toBeInTheDocument();
    rerender(<SuscripcionModal {...p} editingSuscripcion={null} />);
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
    expect(screen.getByLabelText('Total (€)')).toHaveValue(null);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../../types';
import { HuchaCard } from './HuchaCard';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false, formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }) }));
vi.mock('../common/CountUp', () => ({ CountUp: ({ end }: { end: number }) => <span>{end}</span> }));
const wallet: Hucha = { id: 'personal', nombre: 'Personal', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: null, orden: 1 };

describe('línea de paga extra', () => {
  it.each([
    [[8, 12], 'ago y dic'], [[12, 1, 8], 'ene, ago y dic'], [[8], 'ago'],
  ])('muestra meses abreviados y ordenados: %j', (months, label) => {
    render(<HuchaCard hucha={{ ...wallet, extra_importe: 100, extra_meses: months }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(`Paga extra de 100,00 € en ${label}`).parentElement).toHaveClass('text-ink-soft');
  });
  it('sin configuración conserva la descripción habitual', () => {
    render(<HuchaCard hucha={wallet} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('El resto de cada ingreso')).toBeInTheDocument();
    expect(screen.queryByText(/Paga extra/)).not.toBeInTheDocument();
  });
});

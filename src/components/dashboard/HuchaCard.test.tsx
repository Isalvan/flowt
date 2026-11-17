import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hucha } from '../../types';
import { HuchaCard } from './HuchaCard';
import type { WalletForecast } from '../../utils/monthEndForecast';

const privacy = vi.hoisted(() => ({ isLocked: false }));
vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: privacy.isLocked, formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }) }));
vi.mock('../common/CountUp', () => ({ CountUp: ({ end }: { end: number }) => <span>{end}</span> }));
const wallet: Hucha = { id: 'personal', nombre: 'Personal', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: null, orden: 1 };
beforeEach(() => { privacy.isLocked = false; });

const prevision: WalletForecast = { previsto: -25, gastoVariable: 100, suscripciones: 25, ingresos: 100, diasRestantes: 10, sinHistorial: false };

describe('previsión a fin de mes', () => {
  it('muestra importe, tendencia, color negativo y desglose', () => {
    render(<HuchaCard hucha={wallet} prevision={prevision} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const line = screen.getByText('A fin de mes: ~-25,00 €').parentElement!;
    expect(line).toHaveClass('text-[11px]', 'text-rose-500');
    expect(line).toHaveAttribute('title', 'Ritmo de gasto −100,00 € · Suscripciones −25,00 € · Nómina +100,00 €');
    expect(line.querySelector('.lucide-trending-down')).toBeInTheDocument();
  });

  it('oculta cifras, desglose y tendencia con privacidad', () => {
    privacy.isLocked = true;
    render(<HuchaCard hucha={wallet} prevision={prevision} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const line = screen.getByText('A fin de mes: •••• €').parentElement!;
    expect(line).not.toHaveAttribute('title');
    expect(line.querySelector('svg')).not.toBeInTheDocument();
    expect(screen.queryByText(/25,00|100,00/)).not.toBeInTheDocument();
  });

  it('omite partes a cero y avisa de pocos datos', () => {
    render(<HuchaCard hucha={wallet} prevision={{ ...prevision, previsto: 100, gastoVariable: 0, suscripciones: 0, sinHistorial: true }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const line = screen.getByText('A fin de mes: ~100,00 €').parentElement!;
    expect(line).toHaveAttribute('title', 'Nómina +100,00 € · pocos datos de gasto');
    expect(line.querySelector('.lucide-trending-up')).toBeInTheDocument();
  });

  it('no muestra previsión al cierre del mes', () => {
    render(<HuchaCard hucha={wallet} prevision={{ ...prevision, diasRestantes: 0 }} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(/A fin de mes/)).not.toBeInTheDocument();
  });
});

it.each([false, true])('muestra la cuota y respeta el bloqueo: %s', locked => {
  privacy.isLocked = locked;
  render(<HuchaCard hucha={{ ...wallet, deuda_pendiente: 104, deuda_cuota: 34.67 }} lenderName="Ahorros" onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText(locked ? 'Deuda: •• € · •• €/mes a Ahorros' : 'Deuda: 104,00 € · 34,67 €/mes a Ahorros')).toBeInTheDocument();
  if (locked) expect(screen.queryByText(/34,67/)).not.toBeInTheDocument();
});

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

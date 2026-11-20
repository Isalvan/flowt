import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EchoItem, YearEcho } from '../../utils/yearEcho';
import { YearEchoCard } from './YearEchoCard';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ formatCurrency: (value: number) => `${value.toFixed(2).replace('.', ',')} €` }) }));

// Fictitious figures only.
const item = (extra: Partial<EchoItem> = {}): EchoItem => ({
  key: 'seguro hogar', nombre: 'Seguro Hogar Atlas', tipo: 'anual', fechaPasada: new Date(2025, 11, 2), fecha: new Date(2026, 11, 2),
  dias: 12, importe: 240, pagado: null, antesDeNomina: false, ...extra,
});
const echo = (items: EchoItem[], pendiente = 0): YearEcho => ({ items, pendiente, horizonte: 45 });

describe('YearEchoCard', () => {
  it('adds up what may come back and flags what lands before payroll', () => {
    render(<YearEchoCard echo={echo([item({ antesDeNomina: true })], 240)} />);
    expect(screen.getByText('Podrían volver 240,00 € en los próximos 45 días')).toBeInTheDocument();
    expect(screen.getByText('Seguro Hogar Atlas')).toBeInTheDocument();
    expect(screen.getByText('Hace un año, el 2 dic · en 12 días')).toBeInTheDocument();
    expect(screen.getByText('Antes de tu próxima nómina')).toBeInTheDocument();
  });

  it('shows a spike as the extra over the usual spend', () => {
    render(<YearEchoCard echo={echo([item({ key: 'tienda', nombre: 'Tienda Online Nube', tipo: 'pico', importe: 255.5, veces: 6.8 })], 255.5)} />);
    expect(screen.getByText('+255,50 €')).toBeInTheDocument();
    expect(screen.getByText('Hace un año, el 2 dic · 6,8 veces lo normal')).toBeInTheDocument();
  });

  it('crosses out what is already paid this year', () => {
    render(<YearEchoCard echo={echo([item({ pagado: { fecha: new Date(2026, 10, 3), importe: 248 }, antesDeNomina: true })])} />);
    expect(screen.getByText('Lo de estas fechas ya está pagado este año')).toBeInTheDocument();
    expect(screen.getByText('Ya pagado el 3 nov (248,00 €)')).toBeInTheDocument();
    expect(screen.queryByText('Antes de tu próxima nómina')).not.toBeInTheDocument();
    expect(screen.getByText('240,00 €')).toHaveClass('line-through');
  });

  it('says so when last year was quiet', () => {
    render(<YearEchoCard echo={echo([])} />);
    expect(screen.getByText('Hace un año, en las próximas semanas, no hubo gastos fuera de lo normal')).toBeInTheDocument();
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BankBadge } from './BankBadge';
import { BANK_CATALOG } from '../../utils/banks';

describe('BankBadge', () => {
  it.each(BANK_CATALOG.map(bank => bank.nombre))('muestra el logo de %s', nombre => {
    const { container } = render(<BankBadge nombre={nombre} />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('reconoce el banco sin distinguir mayúsculas', () => {
    const { container } = render(<BankBadge nombre="unicaja" />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('pinta las marcas de un solo color sobre el color del banco', () => {
    const { container } = render(<BankBadge nombre="Revolut" />);
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).not.toBe('');
  });

  it('usa iniciales y el estilo neutro para un banco que no está en el catálogo', () => {
    const { container } = render(<BankBadge nombre="Caja Rural" size="sm" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(container.querySelector('img')).toBeNull();
    expect(badge).toHaveTextContent('CR');
    expect(badge.className).toContain('bg-brand-tint');
  });
});

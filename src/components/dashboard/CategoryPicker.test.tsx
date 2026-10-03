import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesProvider } from '../../context/CategoriesContext';
import { useCategories } from '../../hooks/useCategories';
import { CategoryPicker } from './CategoryPicker';
import { useFinanceData } from '../../hooks/useFinanceData';

vi.mock('../../context/PrivacyContext', () => ({ usePrivacy: () => ({ isLocked: false }) }));
const movement = { id: 'g', tipo: 'gasto' as const, concepto: 'Detalle de cumpleaños', importe: 20, fecha_operacion: '2026-10-03' };
function Demo() {
  const { handleUpdateMovimientoCategoria } = useFinanceData(true);
  const { categories } = useCategories();
  return <><CategoryPicker movimiento={movement} onSave={handleUpdateMovimientoCategoria} /><output>{categories.filter(c => c.id.startsWith('custom_')).map(c => c.label).join(',')}</output></>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('flowt-demo-movimientos', JSON.stringify([movement]));
  for (const key of ['huchas', 'suscripciones', 'pending']) localStorage.setItem(`flowt-demo-${key}`, '[]');
  localStorage.setItem('flowt-demo-stats', JSON.stringify({ total_ingresos: 0, total_gastos: 20 }));
});

describe('selector de categorías de Flowt', () => {
  it('crea, aplica y conserva una categoría propia al volver a abrir Flowt', async () => {
    render(<CategoriesProvider forceDemo><Demo /></CategoriesProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Categoría de Detalle de cumpleaños' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: '  Regalos  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear y aplicar' }));
    await waitFor(() => {
      const category = JSON.parse(localStorage.getItem('flowt-demo-categories')!)[0];
      expect(category).toMatchObject({ label: 'Regalos', tipo: 'gasto' });
      expect(JSON.parse(localStorage.getItem('flowt-demo-movimientos')!)[0].categoria).toBe(category.id);
    });
    cleanup();
    render(<CategoriesProvider forceDemo><Demo /></CategoriesProvider>);
    expect(await screen.findByText('Regalos', { selector: 'output' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Categoría de Detalle de cumpleaños' }));
    expect(screen.getByRole('button', { name: 'Regalos' })).toBeInTheDocument();
  });

  it('muestra errores dentro de Flowt y permite cancelar sin guardar', async () => {
    render(<CategoriesProvider forceDemo><Demo /></CategoriesProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Categoría de Detalle de cumpleaños' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear y aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe un nombre');
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Alimentación' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear y aplicar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes una categoría');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(localStorage.getItem('flowt-demo-categories')).toBeNull();
  });

  it('conserva el selector abierto si falla el guardado y permite reintentar', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<CategoryPicker movimiento={movement} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Categoría de Detalle de cumpleaños' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha guardado');
    fireEvent.click(screen.getByRole('button', { name: 'Compras' }));
    await waitFor(() => expect(screen.queryByText('Elegir categoría')).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledWith('g', 'compras');
  });
});

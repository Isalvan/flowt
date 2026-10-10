import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryHuchasView } from '../src/components/ajustes/CategoryHuchasView';
import { CategoriesContext } from '../src/context/categoryContext';
import type { Hucha } from '../src/types';
import { useCategoryHuchas } from '../src/hooks/useCategoryHuchas';

const privacy = vi.hoisted(() => ({ isLocked: false, openUnlockModal: vi.fn() }));
const firestore = vi.hoisted(() => ({ onSnapshot: vi.fn(), doc: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn() }));
const firebase = vi.hoisted(() => ({ auth: { currentUser: { uid: 'owner' } }, db: {} }));
vi.mock('../src/firebase', () => firebase);
vi.mock('../src/context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('firebase/firestore', () => firestore);

const huchas = [
  { id: 'food', nombre: 'Comida', activa: true },
  { id: 'fun', nombre: 'Ocio', activa: true },
  { id: 'archived', nombre: 'Archivada', activa: false },
  { id: 'cash', nombre: 'Efectivo', activa: true, es_metalico: true },
  { id: 'internal', nombre: 'Transferencias', activa: true, es_interno: true },
] as Hucha[];
const customId = 'custom_' + 'a'.repeat(64);
const renderView = () => render(<CategoriesContext.Provider value={{ custom: [
  { id: customId, label: 'Mascotas', tipo: 'ambos' },
  { id: 'custom_income', label: 'Ingreso propio', tipo: 'ingreso' },
] }}><CategoryHuchasView huchas={huchas} demo /></CategoriesContext.Provider>);

beforeEach(() => {
  privacy.isLocked = false;
  localStorage.clear();
  vi.clearAllMocks();
  firebase.auth.currentUser.uid = 'owner';
});

describe('Authenticated category configuration', () => {
  it('subscribes to the owner document and hides the previous owner map immediately when switching users', () => {
    const unsubscribe = vi.fn();
    firestore.doc.mockImplementation((_db, collection, owner) => `${collection}/${owner}`);
    firestore.onSnapshot.mockImplementation((_ref, callback) => {
      callback({ data: () => ({ category_huchas: { alimentacion: 'own' } }) });
      return unsubscribe;
    });
    const { result, rerender } = renderHook(({ uid }) => useCategoryHuchas(uid, [], false), { initialProps: { uid: 'owner' } });
    expect(firestore.onSnapshot).toHaveBeenCalledWith('review_configuration/owner', expect.any(Function), expect.any(Function));
    expect(result.current.map).toEqual({ alimentacion: 'own' });
    rerender({ uid: '' });
    expect(result.current.map).toEqual({});
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('merges against the transaction snapshot and advances revision instead of overwriting other changes', async () => {
    const set = vi.fn();
    firestore.onSnapshot.mockImplementation((_ref, callback) => {
      callback({ data: () => ({ category_huchas: { alimentacion: 'old' } }) });
      return vi.fn();
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: async () => ({ data: () => ({ category_huchas: { alimentacion: 'old', ocio: 'concurrent' }, revision: 8 }) }), set,
    }));
    firestore.serverTimestamp.mockReturnValue('server-time');
    const owned = [
      { id: 'own', nombre: 'Comida', activa: true, id_propietario: 'owner' },
      { id: 'cash', nombre: 'Efectivo', activa: true, es_metalico: true, id_propietario: 'owner' },
      { id: 'internal', nombre: 'Transferencias', activa: true, es_interno: true, id_propietario: 'owner' },
    ] as Hucha[];
    const { result } = renderHook(() => useCategoryHuchas('owner', owned, false));
    await act(async () => { await result.current.setCategoryHucha('alimentacion', 'own'); });
    expect(set).toHaveBeenCalledWith('review_configuration/owner', {
      category_huchas: { alimentacion: 'own', ocio: 'concurrent' }, revision: 9, updated_at: 'server-time', last_changed_category: 'alimentacion',
    });
    await expect(result.current.setCategoryHucha('nomina', 'own')).rejects.toThrow('categoría de gasto');
    await expect(result.current.setCategoryHucha('alimentacion', 'cash')).rejects.toThrow('gastos bancarios');
    await expect(result.current.setCategoryHucha('alimentacion', 'internal')).rejects.toThrow('gastos bancarios');
    firebase.auth.currentUser.uid = 'other';
    await expect(result.current.setCategoryHucha('alimentacion', 'own')).rejects.toThrow('inicia sesión');
  });
});

describe('Huchas por categoría', () => {
  it('asigna y cambia varias categorías por hucha, incluidas personalizadas, y permite quitar', async () => {
    renderView();
    fireEvent.change(await screen.findByLabelText('Hucha para Alimentación'), { target: { value: 'food' } });
    fireEvent.change(screen.getByLabelText('Hucha para Mascotas'), { target: { value: 'food' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('flowt-demo-category-huchas')!)).toEqual({ alimentacion: 'food', [customId]: 'food' }));
    fireEvent.change(screen.getByLabelText('Hucha para Alimentación'), { target: { value: 'fun' } });
    expect(JSON.parse(localStorage.getItem('flowt-demo-category-huchas')!).alimentacion).toBe('fun');
    fireEvent.change(screen.getByLabelText('Hucha para Mascotas'), { target: { value: '' } });
    expect(JSON.parse(localStorage.getItem('flowt-demo-category-huchas')!)).toEqual({ alimentacion: 'fun' });
    expect(screen.queryByLabelText('Hucha para Ingreso propio')).not.toBeInTheDocument();
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('conserva una relación con hucha archivada y permite resolverla', async () => {
    localStorage.setItem('flowt-demo-category-huchas', JSON.stringify({ alimentacion: 'archived' }));
    renderView();
    expect(await screen.findByLabelText('Hucha para Alimentación')).toHaveValue('archived');
    expect(screen.getByText(/Esta hucha está inactiva/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hucha para Alimentación'), { target: { value: '' } });
    expect(JSON.parse(localStorage.getItem('flowt-demo-category-huchas')!)).toEqual({});
  });

  it('excluye huchas de efectivo e internas y avisa de una relación antigua incompatible', async () => {
    localStorage.setItem('flowt-demo-category-huchas', JSON.stringify({ alimentacion: 'cash' }));
    renderView();
    expect(await screen.findByLabelText('Hucha para Alimentación')).toHaveValue('cash');
    expect(screen.queryByRole('option', { name: 'Efectivo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Transferencias' })).not.toBeInTheDocument();
    expect(screen.getByText(/no admite gastos bancarios/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hucha para Alimentación'), { target: { value: '' } });
    expect(JSON.parse(localStorage.getItem('flowt-demo-category-huchas')!)).toEqual({});
  });

  it('no muestra ni modifica relaciones bloqueadas y no conecta la demo a Firestore', () => {
    privacy.isLocked = true;
    localStorage.setItem('flowt-demo-category-huchas', JSON.stringify({ alimentacion: 'food' }));
    renderView();
    expect(screen.queryByLabelText('Hucha para Alimentación')).not.toBeInTheDocument();
    expect(screen.queryByText('Comida')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(privacy.openUnlockModal).toHaveBeenCalled();
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
    expect(localStorage.getItem('flowt-demo-category-huchas')).toBe('{"alimentacion":"food"}');
  });
});

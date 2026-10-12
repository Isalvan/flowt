import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { ProfilePanel } from '../components/profile/ProfilePanel';
import type { InicioPeriodo } from '../utils/periods';
import type { Hucha } from '../types';

const mocks = vi.hoisted(() => ({
  uid: 'user-1' as string | null,
  getDoc: vi.fn(), setDoc: vi.fn(), unsubscribe: vi.fn(),
  authCallback: null as null | ((user: { uid: string } | null) => void),
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth, callback) => {
    mocks.authCallback = callback;
    callback(mocks.uid ? { uid: mocks.uid } : null);
    return mocks.unsubscribe;
  }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, collection, uid) => `${collection}/${uid}`),
  getDoc: mocks.getDoc, setDoc: mocks.setDoc,
}));
vi.mock('./PrivacyContext', () => ({ usePrivacy: () => ({ hasPin: false, isLocked: false }) }));

function Probe() {
  const prefs = usePreferences();
  return <>
    <output>{JSON.stringify({ horasSemanales: prefs.horasSemanales, umbralCompraPequena: prefs.umbralCompraPequena })}</output>
    <button onClick={() => { void prefs.updatePreferences({ horasSemanales: 81, umbralCompraPequena: NaN }); }}>Invalid</button>
    <button onClick={() => { void prefs.updatePreferences({ horasSemanales: 40 }); }}>Update</button>
  </>;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.uid = 'user-1';
  mocks.getDoc.mockResolvedValue({ exists: () => false });
  mocks.setDoc.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PreferencesProvider and profile fields', () => {
  it('loads, validates, saves and recovers the featured preference', async () => {
    localStorage.setItem('flowt:prefs:user-1', JSON.stringify({ cifraDestacada: 'local' }));
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ cifra_destacada: 'remote' }) });
    function FeaturedProbe() {
      const prefs = usePreferences();
      return <>
        <output>{prefs.cifraDestacada ?? 'total'}</output>
        {['x', 'a'.repeat(128), '', 'a'.repeat(129), 42, null].map((value, i) => <button key={i}
          onClick={() => { void prefs.updatePreferences({ cifraDestacada: value as string | null }); }}>choice-{i}</button>)}
      </>;
    }
    const view = render(<PreferencesProvider><FeaturedProbe /></PreferencesProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('local');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('remote'));
    fireEvent.click(screen.getByText('choice-0'));
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { cifra_destacada: 'x' }, { merge: true });
    fireEvent.click(screen.getByText('choice-1'));
    for (const i of [2, 3, 4]) fireEvent.click(screen.getByText(`choice-${i}`));
    expect(screen.getByRole('status').textContent).toBe('a'.repeat(128));
    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
    view.unmount();
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ cifra_destacada: '' }) });
    render(<PreferencesProvider><FeaturedProbe /></PreferencesProvider>);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('a'.repeat(128));
    fireEvent.click(screen.getByText('choice-5'));
    expect(screen.getByRole('status')).toHaveTextContent('total');
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { cifra_destacada: null }, { merge: true });
    expect(JSON.parse(localStorage.getItem('flowt:prefs:user-1')!).cifraDestacada).toBeNull();
  });

  it('lists active wallets in order and saves the featured choice or total', async () => {
    const huchas: Hucha[] = [
      { id: 'archived', nombre: 'Archivada', activa: false, saldo_acumulado: 0, objetivo: null, tipo_aportacion: 'flat', orden: 0 },
      { id: 'ocio', nombre: 'Ocio', saldo_acumulado: 123, objetivo: null, tipo_aportacion: 'flat', orden: 1 },
      { id: 'ahorro', nombre: 'Ahorro', activa: true, saldo_acumulado: 456, objetivo: null, tipo_aportacion: 'flat', orden: 2 },
    ];
    localStorage.setItem('flowt:prefs:user-1', JSON.stringify({ cifraDestacada: 'archived' }));
    const view = render(<PreferencesProvider><ProfilePanel isOpen onClose={vi.fn()} user={null} onLogout={vi.fn()} huchas={huchas} /></PreferencesProvider>);
    await act(async () => {});
    const select = screen.getByLabelText('Cifra destacada');
    expect(select).toHaveValue('');
    expect(Array.from(select.querySelectorAll('option')).map(option => option.textContent)).toEqual(['Saldo total', 'Ocio', 'Ahorro']);
    fireEvent.change(select, { target: { value: 'ocio' } });
    expect(select).toHaveValue('ocio');
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { cifra_destacada: 'ocio' }, { merge: true });
    fireEvent.change(select, { target: { value: '' } });
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { cifra_destacada: null }, { merge: true });
    view.rerender(<PreferencesProvider><ProfilePanel isOpen onClose={vi.fn()} user={null} onLogout={vi.fn()} huchas={[huchas[0]]} /></PreferencesProvider>);
    expect(screen.queryByLabelText('Cifra destacada')).not.toBeInTheDocument();
  });
  it('loads, saves and validates period preferences, including rejected strings and days', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ inicio_periodo: 'nomina' }) });
    function PeriodProbe() {
      const prefs = usePreferences();
      return <>
        <output>{prefs.inicioPeriodo}</output>
        {[1, 28, 'nomina', 0, 29, 2.5, 'other'].map(value => <button key={value}
          onClick={() => { void prefs.updatePreferences({ inicioPeriodo: value as InicioPeriodo }); }}>{value}</button>)}
      </>;
    }
    render(<PreferencesProvider><PeriodProbe /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('nomina'));
    fireEvent.click(screen.getByRole('button', { name: '28' }));
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { inicio_periodo: 28 }, { merge: true });
    expect(JSON.parse(localStorage.getItem('flowt:prefs:user-1')!).inicioPeriodo).toBe(28);
    for (const invalid of ['0', '29', '2.5', 'other']) fireEvent.click(screen.getByRole('button', { name: invalid }));
    expect(screen.getByRole('status')).toHaveTextContent('28');
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'nomina' }));
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { inicio_periodo: 'nomina' }, { merge: true });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { inicio_periodo: 1 }, { merge: true });
  });

  it('offers period choices, validates the fixed day and explains missing payroll', () => {
    render(<PreferencesProvider forceDemo><ProfilePanel isOpen onClose={vi.fn()} user={null} onLogout={vi.fn()} /></PreferencesProvider>);
    fireEvent.change(screen.getByLabelText('Inicio de tu periodo'), { target: { value: 'nomina' } });
    expect(screen.getByText('Aún no hemos visto ninguna nómina; mientras tanto se usa el mes natural.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Inicio de tu periodo'), { target: { value: 'fixed' } });
    const day = screen.getByLabelText('Día de inicio');
    fireEvent.change(day, { target: { value: '15' } });
    fireEvent.blur(day);
    expect(screen.getByLabelText('Día de inicio')).toHaveValue(15);
    fireEvent.change(screen.getByLabelText('Día de inicio'), { target: { value: '29' } });
    fireEvent.blur(screen.getByLabelText('Día de inicio'));
    expect(screen.getByLabelText('Día de inicio')).toHaveValue(15);
  });
  it('loads local preferences first and keeps them when Firestore denies access', async () => {
    localStorage.setItem('flowt:prefs:user-1', JSON.stringify({ horasSemanales: 35, umbralCompraPequena: 8 }));
    mocks.getDoc.mockRejectedValue(new Error('permission-denied'));
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":35'));
    expect(screen.getByRole('status')).toHaveTextContent('"umbralCompraPequena":8');
  });

  it('saves on blur and Enter, rejects invalid input and retains updates after a failed write', async () => {
    mocks.setDoc.mockRejectedValue(new Error('permission-denied'));
    render(<PreferencesProvider><ProfilePanel isOpen onClose={vi.fn()} user={null} onLogout={vi.fn()} /></PreferencesProvider>);
    const hours = screen.getByLabelText('Horas de trabajo a la semana');
    fireEvent.change(hours, { target: { value: '40' } });
    fireEvent.blur(hours);
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledWith('settings/user-1', { horas_semanales: 40 }, { merge: true }));
    expect(screen.getByLabelText('Horas de trabajo a la semana')).toHaveValue(40);
    const threshold = screen.getByLabelText('Compra pequeña');
    threshold.focus();
    fireEvent.change(threshold, { target: { value: '12.5' } });
    fireEvent.keyDown(threshold, { key: 'Enter' });
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledWith('settings/user-1', { umbral_compra_pequena: 12.5 }, { merge: true }));
    fireEvent.change(screen.getByLabelText('Horas de trabajo a la semana'), { target: { value: '90' } });
    fireEvent.blur(screen.getByLabelText('Horas de trabajo a la semana'));
    expect(screen.getByLabelText('Horas de trabajo a la semana')).toHaveValue(40);
    expect(mocks.setDoc).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Horas de trabajo a la semana'), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText('Horas de trabajo a la semana'));
    await waitFor(() => expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-1', { horas_semanales: null }, { merge: true }));
    expect(JSON.parse(localStorage.getItem('flowt:prefs:user-1')!)).toEqual({ horasSemanales: null, umbralCompraPequena: 12.5, cifraDestacada: null });
  });

  it('validates updates in the context and never touches Firestore in demo mode', async () => {
    render(<PreferencesProvider forceDemo><Probe /></PreferencesProvider>);
    fireEvent.click(screen.getByText('Invalid'));
    expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":null');
    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":40');
    expect(JSON.parse(localStorage.getItem('flowt:prefs:demo')!)).toEqual({ horasSemanales: 40, umbralCompraPequena: 5, cifraDestacada: null, inicioPeriodo: 'nomina' });
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('uses demo storage without a Firebase user', () => {
    mocks.uid = null;
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    fireEvent.click(screen.getByText('Update'));
    expect(localStorage.getItem('flowt:prefs:demo')).toContain('40');
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('loads valid remote fields while retaining local fields absent from the document', async () => {
    localStorage.setItem('flowt:prefs:user-1', JSON.stringify({ horasSemanales: 35, umbralCompraPequena: 8 }));
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ horas_semanales: null, pin_hash: 'hash' }) });
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":null'));
    expect(screen.getByRole('status')).toHaveTextContent('"umbralCompraPequena":8');
  });

  it('ignores stale reads after an edit, an account change or a StrictMode cleanup', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.getDoc.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const view = render(<StrictMode><PreferencesProvider><Probe /></PreferencesProvider></StrictMode>);
    fireEvent.click(screen.getByText('Update'));
    await act(async () => { pending.forEach(resolve => resolve({ exists: () => true, data: () => ({ horas_semanales: 20 }) })); });
    expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":40');
    act(() => { mocks.authCallback?.({ uid: 'user-2' }); });
    expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":null');
    fireEvent.click(screen.getByText('Update'));
    await waitFor(() => expect(mocks.setDoc).toHaveBeenLastCalledWith('settings/user-2', { horas_semanales: 40 }, { merge: true }));
    view.unmount();
    await act(async () => { pending.at(-1)?.({ exists: () => true, data: () => ({ horas_semanales: 20 }) }); });
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('continues in memory when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    render(<PreferencesProvider forceDemo><Probe /></PreferencesProvider>);
    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByRole('status')).toHaveTextContent('"horasSemanales":40');
  });
});

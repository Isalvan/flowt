import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signOut } from 'firebase/auth';
import App from './App';
import { auth } from './firebase';
import { MANUAL_LOGIN_PATH } from './components/auth/ManualLogin';

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn((_auth, cb) => {
    cb(null);
    return () => {};
  }),
  signOut: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock usePrivacy context to be permanently unlocked during dashboard tests
vi.mock('./context/PrivacyContext', () => ({
  PrivacyProvider: ({ children }: any) => <>{children}</>,
  usePrivacy: () => ({
    isLocked: false,
    hasPin: false,
    isPinModalOpen: false,
    pinModalMode: 'enter',
    lock: vi.fn(),
    openUnlockModal: (cb: any) => cb && cb(true),
    openCreateModal: vi.fn(),
    closePinModal: vi.fn(),
    setPin: vi.fn(),
    verifyAndUnlock: () => true,
    formatCurrency: (value: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value),
    formatPlainCurrency: (value: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value),
    maskValue: (value: any) => String(value),
    pinCallback: null,
  })
}));

// The demo account holds half a year of movements; rendering the whole app in jsdom takes a while.
vi.setConfig({ testTimeout: 20000 });

describe('App Dashboard', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('renders the login screen when not authenticated', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Cada euro,\s*en su sitio/i })).toBeInTheDocument();
    expect(await screen.findByText(/Acceder con Google/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('shows manual login only at its hidden URL', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    window.history.replaceState(null, '', MANUAL_LOGIN_PATH);
    render(<App />);
    expect(await screen.findByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.queryByText(/Acceder con Google/i)).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('renders dashboard with mock data in Demo Mode', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    
    const demoBtn = await screen.findByText(/Explorar en modo Demo/i);
    fireEvent.click(demoBtn);
    
    expect(await screen.findByRole('heading', { name: /Mis carteras/i })).toBeInTheDocument();
    const payrollTabs = screen.getAllByRole('button', { name: 'Nómina' });
    expect(payrollTabs).toHaveLength(2);
    fireEvent.click(payrollTabs[0]);
    expect(await screen.findByRole('heading', { name: 'Tu nómina' })).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

  it('opens history modal through Más acciones', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    
    const demoBtn = await screen.findByText(/Explorar en modo Demo/i);
    fireEvent.click(demoBtn);

    const moreActions = await screen.findByRole('button', { name: /Más acciones/i });
    fireEvent.click(moreActions);
    expect(await screen.findByRole('menuitem', { name: /Historial completo/i })).toBeInTheDocument();
    const historyBtn = await screen.findByRole('menuitem', { name: /Historial completo/i });
    fireEvent.click(historyBtn);
    
    expect(await screen.findByPlaceholderText(/Buscar por concepto o importe/i, {}, { timeout: 20000 })).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  }, 30000);

  it('opens and closes the Más acciones menu', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    fireEvent.click(await screen.findByText(/Explorar en modo Demo/i));
    const trigger = await screen.findByRole('button', { name: /Más acciones/i });
    fireEvent.click(trigger);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });
  it('signs out an account that is not allowed and tells it so', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    vi.mocked(signOut).mockResolvedValue(undefined);
    // useFinanceData listens through auth.onAuthStateChanged directly.
    const listenable = auth as unknown as { onAuthStateChanged?: (cb: (user: unknown) => void) => () => void };
    listenable.onAuthStateChanged = (cb) => {
      cb({ uid: 'stranger', email: 'stranger@example.com' });
      return () => {};
    };
    try {
      render(<App />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Esta cuenta no tiene acceso');
      expect(signOut).toHaveBeenCalled();
      expect(screen.getByText(/Acceder con Google/i)).toBeInTheDocument();
    } finally {
      cleanup();
      delete listenable.onAuthStateChanged;
      vi.unstubAllEnvs();
    }
  });
});

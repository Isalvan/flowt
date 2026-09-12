import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn((_auth, cb) => {
    cb(null);
    return () => {};
  })
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

describe('App Dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('renders the login screen when not authenticated', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    expect(await screen.findByText(/Control de gastos inteligente/i)).toBeInTheDocument();
    expect(await screen.findByText(/Acceder con Google/i)).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('renders dashboard with mock data in Demo Mode', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'mock-key');
    render(<App />);
    
    const demoBtn = await screen.findByText(/Explorar en modo Demo/i);
    fireEvent.click(demoBtn);
    
    expect(await screen.findByText(/Dashboard/i)).toBeInTheDocument();
    
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
    
    expect(await screen.findByPlaceholderText(/Buscar por concepto o importe/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

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
});

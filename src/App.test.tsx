import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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


  it('renders dashboard with mock data when Firebase is not configured', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    // Check for Demo Mode warning
    expect(await screen.findByText(/Modo Demo/i)).toBeInTheDocument();
    
    // Check for main summary
    expect(await screen.findByText(/Mi Panel/i)).toBeInTheDocument();
    
    // (Hucha items omitted to prevent timeout)
    
    // Check for action buttons
    expect(screen.getByText(/Traspasar Fondos/i)).toBeInTheDocument();
    expect(screen.getByText(/Nueva Hucha/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

  it('opens history modal when clicking Historial button', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    const historyBtn = await screen.findByText(/Historial Completo/i);
    fireEvent.click(historyBtn);
    
    expect(await screen.findByPlaceholderText(/Buscar por concepto o importe/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });
});


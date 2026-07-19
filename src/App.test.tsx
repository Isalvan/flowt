import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';



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
    
    // Click on Demo mode button instead of stubbing env, as Vite statically replaces import.meta.env
    const demoBtn = await screen.findByText(/Explorar en modo Demo/i);
    fireEvent.click(demoBtn);
    
    // Check for Demo Mode warning (or Navbar to confirm dashboard loaded)
    expect(await screen.findByText(/Dashboard/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

});

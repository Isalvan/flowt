import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
  it('renders the login screen when not authenticated', async () => {
    render(<App />);
    expect(await screen.findByText(/Control de gastos inteligente/i)).toBeInTheDocument();
    expect(await screen.findByText(/Acceder con Google/i)).toBeInTheDocument();
  });

  it('renders dashboard with mock data when Firebase is not configured', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    // Check for Demo Mode warning
    expect(await screen.findByText(/Modo Demo/i)).toBeInTheDocument();
    
    // Check for main summary
    expect(await screen.findByText(/^Saldo Total Acumulado$/i)).toBeInTheDocument();
    
    // Check for Cartera Principal balance from MOCK_HUCHAS (5000 in mock)
    const balanceElements = await screen.findAllByText((content) => content.includes('5') && content.includes('000'));
    expect(balanceElements.length).toBeGreaterThan(0);
    
    // Check for action buttons
    expect(screen.getByText(/Traspasar/i)).toBeInTheDocument();
    expect(screen.getByText(/Nueva Hucha/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

  it('opens history modal when clicking Historial button', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    const historyBtn = await screen.findByText(/Historial/i);
    fireEvent.click(historyBtn);
    
    expect(await screen.findByText(/Histórico de Movimientos/i)).toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/Buscar por concepto o importe/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

describe('App Dashboard', () => {
  it('renders the login screen when not authenticated', async () => {
    render(<App />);
    expect(await screen.findByText(/Control real,/i)).toBeInTheDocument();
    expect(await screen.findByText(/Entrar con Google/i)).toBeInTheDocument();
  });

  it('renders dashboard with mock data when Firebase is not configured', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    // Check for Demo Mode warning
    expect(await screen.findByText(/Modo Demo/i)).toBeInTheDocument();
    
    // Check for main summary
    expect(await screen.findByText(/Resumen de cuenta/i)).toBeInTheDocument();
    
    // Check for Cartera Principal balance from MOCK_HUCHAS (5000 in mock)
    const balanceElements = await screen.findAllByText((content) => content.includes('5') && content.includes('000'));
    expect(balanceElements.length).toBeGreaterThan(0);
    
    // Check for action buttons
    expect(screen.getByText(/Transferir/i)).toBeInTheDocument();
    expect(screen.getByText(/Nueva Hucha/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });

  it('opens history modal when clicking Historial button', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    render(<App />);
    
    const historyBtn = await screen.findByText(/Historial/i);
    fireEvent.click(historyBtn);
    
    expect(await screen.findByText(/Historial Completo/i)).toBeInTheDocument();
    expect(await screen.findByText(/Todos tus movimientos/i)).toBeInTheDocument();
    
    vi.unstubAllEnvs();
  });
});

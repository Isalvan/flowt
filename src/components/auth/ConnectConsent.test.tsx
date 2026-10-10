import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectConsent, CONNECT_PATH } from './ConnectConsent';

const firebase = vi.hoisted(() => ({ auth: { currentUser: { uid: 'owner', getIdToken: vi.fn() } } }));
vi.mock('../../firebase', () => firebase);

const QUERY = '?response_type=code&client_id=flowt-abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=xyz&code_challenge=abc&code_challenge_method=S256';
const PARAMS = { response_type: 'code', client_id: 'flowt-abc', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 'xyz', code_challenge: 'abc', code_challenge_method: 'S256' };
const REQUEST = { client_name: 'Claude', scopes: ['flowt:read', 'flowt:write'], redirect_host: 'claude.ai', local: false };
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload }) as Response;
const fetchMock = vi.fn();
const navigate = vi.fn();
const sent = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => {
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://api.example/');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  navigate.mockReset();
  firebase.auth.currentUser.getIdToken.mockResolvedValue('private-token');
  window.history.replaceState(null, '', CONNECT_PATH + QUERY);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Connection consent', () => {
  it('shows who is asking and returns to the app with the choices the user made', async () => {
    fetchMock.mockResolvedValueOnce(response(REQUEST));
    fetchMock.mockResolvedValueOnce(response({ redirect_to: 'https://claude.ai/api/mcp/auth_callback?code=c&state=xyz' }));
    render(<ConnectConsent email="ana@example.com" navigate={navigate} />);
    expect(await screen.findByRole('heading', { name: /Claude quiere conectarse a tu Flowt/ })).toBeInTheDocument();
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/oauth/authorize/preview', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer private-token' }) }));
    expect(sent(0)).toEqual({ params: PARAMS });

    fireEvent.click(screen.getByRole('checkbox', { name: /Hacer cambios/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=xyz'));
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example/oauth/authorize/decision');
    expect(sent(1)).toEqual({ params: PARAMS, approve: true, write: false });
  });

  it('tells the app when the user cancels', async () => {
    fetchMock.mockResolvedValueOnce(response(REQUEST));
    fetchMock.mockResolvedValueOnce(response({ redirect_to: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz' }));
    render(<ConnectConsent navigate={navigate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.stringContaining('error=access_denied')));
    expect(sent(1)).toMatchObject({ approve: false });
  });

  it('offers no write option when the app only asks to read', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...REQUEST, scopes: ['flowt:read'], redirect_host: 'localhost', local: true }));
    render(<ConnectConsent navigate={navigate} />);
    expect(await screen.findByText(/una aplicación de este dispositivo/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('explains a rejected request and only then offers the way back', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'invalid_request', error_description: 'Se requiere PKCE con S256', redirect_to: 'https://claude.ai/api/mcp/auth_callback?error=invalid_request' }, false));
    render(<ConnectConsent navigate={navigate} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Se requiere PKCE con S256');
    expect(screen.queryByRole('button', { name: 'Autorizar' })).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a la aplicación' }));
    expect(navigate).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?error=invalid_request');
  });

  it('never follows a script address, and lets the user retry after a failure', async () => {
    fetchMock.mockResolvedValueOnce(response(REQUEST));
    fetchMock.mockResolvedValueOnce(response({ redirect_to: 'javascript:alert(1)' }));
    render(<ConnectConsent navigate={navigate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Autorizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dirección de retorno no válida');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Autorizar' })).toBeEnabled();
  });

  it('does nothing when the service address is not configured', () => {
    vi.stubEnv('VITE_REVIEW_API_URL', '');
    render(<ConnectConsent navigate={navigate} />);
    expect(screen.getByRole('alert')).toHaveTextContent('todavía no están disponibles');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

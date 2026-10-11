import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionsView } from '../src/components/ajustes/ConnectionsView';

const privacy = vi.hoisted(() => ({ isLocked: false, openUnlockModal: vi.fn() }));
const firebase = vi.hoisted(() => ({ auth: { currentUser: { uid: 'owner', getIdToken: vi.fn() } } }));
vi.mock('../src/context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('../src/firebase', () => firebase);

const claude = { id: 'grant-1', client_name: 'Claude', scopes: ['flowt:read', 'flowt:write'], redirect_host: 'claude.ai', created_at: '2026-10-09T10:00:00Z', last_used_at: '2026-10-10T08:00:00Z' };
const reader = { id: 'grant-2', client_name: 'Lector', scopes: ['flowt:read'], redirect_host: null, created_at: '2026-10-01T10:00:00Z' };
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload }) as Response;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  privacy.isLocked = false;
  firebase.auth.currentUser.getIdToken.mockResolvedValue('private-token');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Connections', () => {
  it('shows the connector address and what each connected app may do', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [claude, reader], mcp_url: 'https://api.example/mcp' }));
    render(<ConnectionsView userId="owner" />);
    expect(await screen.findByText('https://api.example/mcp')).toBeInTheDocument();
    expect(screen.getByText(/Puede ver y hacer cambios · Conectada el 9 de octubre de 2026 · Último uso el 10 de octubre de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Solo puede ver · Conectada el 1 de octubre de 2026 · Último uso el fecha no disponible/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example/api/connections/list', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer private-token' }) }));
  });

  it('disconnects one app and keeps the rest', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [claude, reader], mcp_url: 'https://api.example/mcp' }));
    fetchMock.mockResolvedValueOnce(response({ revoked: true }));
    render(<ConnectionsView userId="owner" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Desconectar' }))[0]);
    await waitFor(() => expect(screen.queryByText(/claude\.ai/)).not.toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ connection_id: 'grant-1' });
    expect(screen.getByText('Lector')).toBeInTheDocument();
  });

  it('keeps the connection listed when disconnecting fails, and can reload', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [claude], mcp_url: 'https://api.example/mcp' }));
    fetchMock.mockResolvedValueOnce(response({ error: 'server_error', error_description: 'No se pudo completar la operación' }, false));
    fetchMock.mockResolvedValueOnce(response({ items: [], mcp_url: 'https://api.example/mcp' }));
    render(<ConnectionsView userId="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación');
    expect(screen.getByText(/claude\.ai/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Todavía no has conectado ninguna aplicación.')).toBeInTheDocument();
  });

  it('asks nothing of the service while locked, in the demo or unconfigured', () => {
    privacy.isLocked = true;
    const { unmount } = render(<ConnectionsView userId="owner" />);
    expect(screen.getByText('Desbloquea Flowt para ver tus conexiones.')).toBeInTheDocument();
    unmount();
    privacy.isLocked = false;
    render(<ConnectionsView userId="owner" demo />).unmount();
    vi.stubEnv('VITE_REVIEW_API_URL', '');
    render(<ConnectionsView userId="owner" />);
    expect(screen.getByText('Las conexiones con otras aplicaciones todavía no están disponibles.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

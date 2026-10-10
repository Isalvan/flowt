import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewHistoryView } from '../src/components/ajustes/ReviewHistoryView';

const privacy = vi.hoisted(() => ({ isLocked: false, openUnlockModal: vi.fn() }));
const firebase = vi.hoisted(() => ({ auth: { currentUser: { uid: 'owner', getIdToken: vi.fn() } } }));
vi.mock('../src/context/PrivacyContext', () => ({ usePrivacy: () => privacy }));
vi.mock('../src/firebase', () => firebase);
const item = { id: 'review-1', movement_id: 'movement-1', reason: 'Recibo de supermercado', created_at: '2026-10-03T12:00:00Z', reverted: false, effects: { 'movement-1': { before: { concepto: 'Pago tarjeta', categoria: 'sin_categorizar', hucha_id: null }, after: { concepto: 'Compra semanal', categoria: 'alimentacion', hucha_id: 'food' } } } };
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload }) as Response;
const fetchMock = vi.fn();
const questionsMock = vi.fn();
const answerMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://review.example');
  vi.stubGlobal('fetch', (url: string, options: unknown) => url.endsWith('/questions') ? questionsMock(url, options) : url.endsWith('/answer') ? answerMock(url, options) : fetchMock(url, options));
  fetchMock.mockReset();
  questionsMock.mockReset().mockResolvedValue(response({ items: [], errors: [] }));
  answerMock.mockReset();
  privacy.isLocked = false;
  firebase.auth.currentUser.uid = 'owner';
  firebase.auth.currentUser.getIdToken.mockResolvedValue('private-token');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Review history', () => {
  it('loads authenticated history, labels changes and loads the next page', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [item], next_cursor: 'review-1' }));
    fetchMock.mockResolvedValueOnce(response({ items: [{ ...item, id: 'review-2', reason: 'Otra revisión' }], next_cursor: null }));
    render(<ReviewHistoryView userId="owner" />);
    expect(await screen.findByText('Recibo de supermercado')).toBeInTheDocument();
    expect(screen.getByText(/Pago tarjeta → Compra semanal/)).toBeInTheDocument();
    expect(screen.getByText(/Sin categorizar → Alimentación/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('https://review.example/api/reviews/history', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer private-token' }), body: '{"limit":20}' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    expect(await screen.findByText('Otra revisión')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ limit: 20, cursor: 'review-1' });
  });

  it('undoes a review and reloads the history', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [item] })).mockResolvedValueOnce(response({ reverted: true })).mockResolvedValueOnce(response({ items: [{ ...item, reverted: true }] }));
    render(<ReviewHistoryView userId="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByText('Revisión deshecha')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe('https://review.example/api/reviews/revert');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ review_id: 'review-1' });
    expect(screen.queryByRole('button', { name: 'Deshacer' })).not.toBeInTheDocument();
  });

  it('shows a backend conflict without pretending the undo succeeded', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [item] })).mockResolvedValueOnce(response({ error: { message: 'Hay cambios posteriores; no se puede deshacer automáticamente' } }, false));
    render(<ReviewHistoryView userId="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hay cambios posteriores');
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('discards a read finishing after privacy locks and never resurrects the old page', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const view = render(<ReviewHistoryView userId="owner" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    privacy.isLocked = true;
    view.rerender(<ReviewHistoryView userId="owner" />);
    await act(async () => { resolve(response({ items: [item] })); });
    expect(screen.queryByText('Recibo de supermercado')).not.toBeInTheDocument();
    expect(screen.getByText(/Desbloquea Flowt/)).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response({ items: [] }));
    privacy.isLocked = false;
    view.rerender(<ReviewHistoryView userId="owner" />);
    expect(await screen.findByText('Todavía no hay revisiones automáticas.')).toBeInTheDocument();
  });

  it('discards an old owner response after switching account', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const view = render(<ReviewHistoryView userId="owner" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    firebase.auth.currentUser.uid = 'other';
    fetchMock.mockResolvedValueOnce(response({ items: [] }));
    view.rerender(<ReviewHistoryView userId="other" />);
    await act(async () => { resolve(response({ items: [item] })); });
    expect(await screen.findByText('Todavía no hay revisiones automáticas.')).toBeInTheDocument();
    expect(screen.queryByText('Recibo de supermercado')).not.toBeInTheDocument();
  });

  it('does not reload history when an undo finishes after locking', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response({ items: [item] })).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const view = render(<ReviewHistoryView userId="owner" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    privacy.isLocked = true;
    view.rerender(<ReviewHistoryView userId="owner" />);
    await act(async () => { resolve(response({ reverted: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Recibo de supermercado')).not.toBeInTheDocument();
  });

  it('does not read or write in demo, locked mode or without an endpoint', async () => {
    const view = render(<ReviewHistoryView userId="owner" demo />);
    expect(screen.getByText(/La demo no modifica/)).toBeInTheDocument();
    vi.stubEnv('VITE_REVIEW_API_URL', '');
    view.rerender(<ReviewHistoryView userId="owner" />);
    expect(screen.getByText('Las revisiones automáticas todavía no están disponibles.')).toBeInTheDocument();
    privacy.isLocked = true;
    view.rerender(<ReviewHistoryView userId="owner" />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(questionsMock).not.toHaveBeenCalled();
  });

  it('shows persisted doubts and failures, and saves a trimmed answer only after confirmation', async () => {
    const question = { id: 'question-1', question: '¿Qué compraste aquí?', movement_ids: ['movement-1'], state: 'open' };
    questionsMock.mockResolvedValue(response({ items: [question], errors: [{ id: 'job-1', movement_id: 'movement-2', last_error: 'No se pudo consultar el recibo.' }] }));
    fetchMock.mockResolvedValue(response({ items: [] }));
    answerMock.mockResolvedValue(response({ state: 'resolved' }));
    render(<ReviewHistoryView userId="owner" />);
    expect(await screen.findByText('¿Qué compraste aquí?')).toBeInTheDocument();
    expect(screen.getByText('No se pudo consultar el recibo.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Guardar respuesta' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Respuesta: ¿Qué compraste aquí?' }), { target: { value: '  Comida para el perro  ' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText('¿Qué compraste aquí?')).not.toBeInTheDocument());
    expect(answerMock).toHaveBeenCalledWith('https://review.example/api/reviews/answer', expect.objectContaining({ body: '{"question_id":"question-1","answer":"Comida para el perro"}' }));
    expect(questionsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the question and draft if saving fails', async () => {
    questionsMock.mockResolvedValue(response({ items: [{ id: 'q', question: '¿Es mensual?', movement_ids: [], state: 'open' }], errors: [] }));
    fetchMock.mockResolvedValue(response({ items: [] }));
    answerMock.mockResolvedValue(response({ message: 'No se pudo guardar ahora.' }, false));
    render(<ReviewHistoryView userId="owner" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Respuesta: ¿Es mensual?' }), { target: { value: 'Sí' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar respuesta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar ahora.');
    expect(screen.getByRole('textbox')).toHaveValue('Sí');
    expect(screen.getByRole('button', { name: 'Guardar respuesta' })).toBeEnabled();
  });

  it('discards questions arriving after a privacy lock', async () => {
    let resolve!: (value: Response) => void;
    questionsMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    fetchMock.mockResolvedValue(response({ items: [] }));
    const view = render(<ReviewHistoryView userId="owner" />);
    await waitFor(() => expect(questionsMock).toHaveBeenCalledTimes(1));
    privacy.isLocked = true;
    view.rerender(<ReviewHistoryView userId="owner" />);
    await act(async () => { resolve(response({ items: [{ id: 'q', question: 'Dato privado', state: 'open' }], errors: [] })); });
    expect(screen.queryByText('Dato privado')).not.toBeInTheDocument();
    expect(answerMock).not.toHaveBeenCalled();
  });

  it('does not apply a late answer to a different account', async () => {
    let resolve!: (value: Response) => void;
    questionsMock.mockResolvedValueOnce(response({ items: [{ id: 'q', question: 'Dato de la cuenta anterior', movement_ids: [], state: 'open' }], errors: [] }));
    fetchMock.mockResolvedValue(response({ items: [] }));
    answerMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const view = render(<ReviewHistoryView userId="owner" />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Respuesta privada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar respuesta' }));
    await waitFor(() => expect(answerMock).toHaveBeenCalledTimes(1));
    questionsMock.mockResolvedValueOnce(response({ items: [], errors: [] }));
    firebase.auth.currentUser.uid = 'other';
    view.rerender(<ReviewHistoryView userId="other" />);
    await act(async () => { resolve(response({ state: 'resolved' })); });
    expect(await screen.findByText('Todavía no hay revisiones automáticas.')).toBeInTheDocument();
    expect(screen.queryByText('Dato de la cuenta anterior')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Respuesta privada')).not.toBeInTheDocument();
  });
});

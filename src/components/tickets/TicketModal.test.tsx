import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketModal, type TicketModalProps } from './TicketModal';
import { DEMO_TICKET } from '../../utils/demoData';
import { scanTicket } from '../../utils/ticketApi';

vi.mock('../../utils/ticketApi', () => ({ hasTicketApi: () => true, scanTicket: vi.fn() }));
vi.mock('../../utils/ticketImage', () => ({ prepareTicketImage: vi.fn(async () => ({ image: 'photo', mime: 'image/jpeg', preview: 'data:image/jpeg;base64,cGhvdG8=' })) }));
const props = (overrides: Partial<TicketModalProps> = {}): TicketModalProps => ({ uid: 'owner', demo: true, movimientos: [], huchas: [], onSave: vi.fn(async () => {}), onAttach: vi.fn(async () => {}), onClose: vi.fn(), onManual: vi.fn(), ...overrides });
const addAna = () => {
  fireEvent.click(screen.getByRole('switch', { name: 'Repartir entre personas' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre de persona' }), { target: { value: 'Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Añadir persona' }));
};

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('TicketModal', () => {
  it('opens a prefilled result and creates the entire cash expense in one click', async () => {
    const p = props();
    render(<TicketModal {...p} />);
    expect(await screen.findByLabelText('Comercio')).toHaveValue('Mercadona');
    expect(screen.getByLabelText('Total (EUR)')).toHaveValue(23.45);
    expect(screen.getByLabelText('Categoría')).toHaveValue('alimentacion');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'gasto', concepto: 'Mercadona', importe: 23.45, es_metalico: true, categoria: 'alimentacion', ticket: { comercio: 'Mercadona', lineas: DEMO_TICKET.lineas.map(l => ({ d: l.descripcion, i: l.importe })) } })));
    expect(p.onAttach).not.toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalledOnce();
  });
  it('recomputes totals live when assigning lines and editing the total, then saves the split', async () => {
    const p = props();
    render(<TicketModal {...p} />);
    await screen.findByLabelText('Comercio');
    addAna();
    const totals = screen.getByLabelText('Totales por persona');
    expect(totals).toHaveTextContent('Yo11,73 €Ana11,72 €');
    fireEvent.click(screen.getByRole('button', { name: 'Ana, línea 1' }));
    expect(totals).toHaveTextContent('Yo8,76 €Ana14,69 €');
    fireEvent.change(screen.getByLabelText('Total (EUR)'), { target: { value: '25.45' } });
    expect(totals).toHaveTextContent('Yo9,50 €Ana15,95 €');
    expect(screen.getByRole('note')).toHaveTextContent('la diferencia se reparte proporcionalmente');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalled());
    const saved = vi.mocked(p.onSave).mock.calls[0][0];
    expect(saved.importe).toBe(25.45);
    expect(saved.ticket.personas).toEqual([{ nombre: 'Yo', yo: true, importe: 9.5 }, { nombre: 'Ana', importe: 15.95 }]);
    expect(saved.ticket.lineas[0].p).toEqual([1]);
    expect(localStorage.getItem('flowt:ticket-people:owner')).toBe('["Ana"]');
  });
  it('supports quick assignment and line editing, sharing through clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<TicketModal {...props()} />);
    await screen.findByLabelText('Comercio');
    addAna();
    fireEvent.click(within(screen.getByLabelText('Personas del reparto')).getByRole('button', { name: 'Ana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Asignar Leche entera 6x1L' }));
    expect(screen.getByRole('button', { name: 'Ana, línea 1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Editar línea 1' }));
    fireEvent.change(screen.getByLabelText('Importe de línea 1'), { target: { value: '6.94' } });
    expect(screen.getByLabelText('Totales por persona')).toHaveTextContent('Yo8,40 €Ana15,05 €');
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Ana 15,05 €')));
  });
  it('attaches only ticket to the matching expense and supports opting out', async () => {
    const p = props({ movimientos: [{ id: 'bank', concepto: 'Pago Mercadona', tipo: 'gasto', importe: 23.45, fecha_operacion: DEMO_TICKET.fecha }] });
    const { unmount } = render(<TicketModal {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Añadir el detalle a ese gasto' }));
    await waitFor(() => expect(p.onAttach).toHaveBeenCalledWith('bank', expect.objectContaining({ comercio: 'Mercadona' })));
    expect(p.onSave).not.toHaveBeenCalled();
    unmount();
    render(<TicketModal {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Es otro gasto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }));
    await waitFor(() => expect(p.onSave).toHaveBeenCalled());
  });
  it('shows API errors with retry and manual fallback, then shows the filled scan', async () => {
    vi.mocked(scanTicket).mockRejectedValueOnce(new Error('No he podido leer el ticket. Prueba con más luz y el ticket entero.')).mockResolvedValueOnce(DEMO_TICKET);
    const p = props({ demo: false, file: new File(['photo'], 'receipt.jpg', { type: 'image/jpeg' }) });
    render(<TicketModal {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('Leyendo ticket');
    expect(await screen.findByRole('alert')).toHaveTextContent('más luz');
    fireEvent.click(screen.getByRole('button', { name: 'Escribirlo a mano' }));
    expect(p.onManual).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Comercio')).toHaveValue('Mercadona');
    expect(scanTicket).toHaveBeenCalledTimes(2);
  });
  it('keeps the result open when persistence fails and works without localStorage', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const p = props({ onSave: vi.fn(async () => { throw new Error('No se ha guardado'); }) });
    render(<TicketModal {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar gasto' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se ha guardado');
    expect(p.onClose).not.toHaveBeenCalled();
    get.mockRestore();
  });
});

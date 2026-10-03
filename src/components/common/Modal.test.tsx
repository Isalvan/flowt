import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Modal } from './Modal';

it('Escape cierra solo el modal superior y mantiene bloqueado el scroll del historial', () => {
  function Nested() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(false);
    return <Modal isOpen={outer} title="Historial" onClose={() => setOuter(false)}>
      <button onClick={() => setInner(true)}>Elegir categoría</button>
      <Modal isOpen={inner} title="Categorías" onClose={() => setInner(false)}><button>Regalos</button></Modal>
    </Modal>;
  }
  render(<Nested />);
  fireEvent.click(screen.getByRole('button', { name: 'Elegir categoría' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Categorías' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Historial' })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe('');
});

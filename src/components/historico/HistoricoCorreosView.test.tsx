import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HistoricoCorreosView } from './HistoricoCorreosView';

describe('HistoricoCorreosView Security', () => {
  it('renders email content securely using a sandboxed iframe', () => {
    const maliciousHtml = '<p>Test</p><script>alert("XSS")</script><img src="x" onerror="alert(1)">';
    const mockCorreos = [
      {
        id: 'test-id-123',
        email_id: 'email1',
        id_propietario: 'prop1',
        cuerpo: maliciousHtml,
        fecha_envio: '2026-07-19T00:00:00Z',
        movimientos_generados: ['mov1']
      }
    ];

    render(<HistoricoCorreosView historicoCorreos={mockCorreos as any} />);

    // Iframe is rendered, verify its properties
    const iframe = screen.getByTitle('Correo test-id-123');
    expect(iframe).toBeInTheDocument();
    
    // 1. Check sandbox attribute (empty string means fully restricted)
    expect(iframe).toHaveAttribute('sandbox', '');
    
    // 2. Check srcDoc for CSP
    const srcDoc = iframe.getAttribute('srcDoc');
    expect(srcDoc).toContain("Content-Security-Policy");
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).toContain("style-src 'unsafe-inline'");
    expect(srcDoc).toContain("img-src data: cid:");

    // 3. Check srcDoc contains the original body (sanitized by execution environment)
    expect(srcDoc).toContain(maliciousHtml);
  });
});

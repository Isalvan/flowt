import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Security Headers & CSP Verification', () => {
  it('firebase.json defines security headers for hosting', () => {
    const firebaseJsonContent = readFileSync('firebase.json', 'utf8');
    const firebaseConfig = JSON.parse(firebaseJsonContent);

    expect(firebaseConfig.hosting).toBeDefined();
    expect(firebaseConfig.hosting.headers).toBeDefined();
    expect(Array.isArray(firebaseConfig.hosting.headers)).toBe(true);

    const globalHeadersRule = firebaseConfig.hosting.headers.find((h: any) => h.source === '**');
    expect(globalHeadersRule).toBeDefined();

    const headersMap = new Map<string, string>();
    globalHeadersRule.headers.forEach((h: { key: string; value: string }) => {
      headersMap.set(h.key, h.value);
    });

    expect(headersMap.has('Content-Security-Policy')).toBe(true);
    expect(headersMap.get('X-Frame-Options')).toBe('DENY');
    expect(headersMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headersMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headersMap.get('Permissions-Policy')).toContain('camera=()');

    const csp = headersMap.get('Content-Security-Policy') || '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://firestore.googleapis.com');
    expect(csp).toContain('https://accounts.google.com');
  });

  it('index.html contains fallback CSP meta tag', () => {
    const indexHtmlContent = readFileSync('index.html', 'utf8');
    expect(indexHtmlContent).toContain('http-equiv="Content-Security-Policy"');
    expect(indexHtmlContent).toContain("object-src 'none'");
    expect(indexHtmlContent).toContain('http-equiv="X-Content-Type-Options"');
  });
});

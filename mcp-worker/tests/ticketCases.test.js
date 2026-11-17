// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cases from '../../tracker-backend/finance/ticket_cases.json';
import { sanitizeTicket } from '../src/ticketDomain.js';
import { TICKET_PROMPT } from '../src/ticketPrompt.js';

describe('ticket validation, shared with Python', () => {
  it.each(cases.map((entry) => [entry.nombre, entry]))('%s', (_name, entry) => {
    if (entry.error) {
      expect(() => sanitizeTicket(entry.entrada, entry.hoy)).toThrow(expect.objectContaining({ code: entry.error }));
    } else {
      expect(sanitizeTicket(entry.entrada, entry.hoy)).toEqual(entry.esperado);
    }
  });

  it('keeps the prompt identical to the Python prompt', () => {
    const prompt = readFileSync(new URL('../../tracker-backend/prompts/ticket.md', import.meta.url), 'utf8');
    expect(TICKET_PROMPT).toBe(prompt.replaceAll('\r\n', '\n').trim());
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite amounts: %s', (total) => {
    expect(() => sanitizeTicket({ ...cases[0].entrada, total }, '2026-11-17')).toThrow(expect.objectContaining({ code: 'not_a_ticket' }));
  });
});

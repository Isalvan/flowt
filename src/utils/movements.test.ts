import { describe, expect, it } from 'vitest';
import { gmailUrlFor } from './movements';

describe('gmailUrlFor', () => {
  it('enlaza al mensaje de Gmail del que salió el movimiento', () => {
    expect(gmailUrlFor({ email_id: '1a0f7b5f69901a82' })).toBe('https://mail.google.com/mail/#all/1a0f7b5f69901a82');
  });

  it('usa el correo de origen de una revisión cuando no hay email_id', () => {
    expect(gmailUrlFor({ id_correo_origen: '19ab34cd56ef7890' })).toBe('https://mail.google.com/mail/#all/19ab34cd56ef7890');
  });

  it('no enlaza movimientos manuales ni identificadores que no son de Gmail', () => {
    expect(gmailUrlFor({})).toBeNull();
    expect(gmailUrlFor({ email_id: 'demo-email-1' })).toBeNull();
    expect(gmailUrlFor({ email_id: '../../x' })).toBeNull();
  });
});

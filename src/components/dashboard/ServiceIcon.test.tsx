import { describe, expect, it } from 'vitest';
import { normalizeServiceName, resolveServiceKey } from './ServiceIcon';

describe('ServiceIcon', () => {
  it('normalizes punctuation, accents and repeated whitespace', () => {
    expect(normalizeServiceName('  GOOGLE*GOOGLE   PLAY A ')).toBe('google google play a');
  });

  it('resolves safe known service fragments', () => {
    expect(resolveServiceKey('Spotify Duo')).toBe('spotify');
    expect(resolveServiceKey('Netflix Premium')).toBe('netflix');
    expect(resolveServiceKey('GOOGLE*GOOGLE PLAY A')).toBe('google-play');
    expect(resolveServiceKey('ChatGPT Plus')).toBe('chatgpt');
    expect(resolveServiceKey('Gemini Advanced')).toBe('gemini');
    expect(resolveServiceKey('Google Drive')).toBeUndefined();
  });
});

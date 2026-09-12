const aliases: Record<string, string> = { spotify: 'spotify', chatgpt: 'chatgpt', openai: 'chatgpt', gemini: 'gemini', netflix: 'netflix', googleplay: 'google-play', 'google play': 'google-play' };

export const normalizeServiceName = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const resolveServiceKey = (value: string) => { const normalized = normalizeServiceName(value); if (normalized.split(' ').some(word => word === 'spotify')) return 'spotify'; if (normalized.includes('google play')) return 'google-play'; if (normalized.split(' ').some(word => word === 'netflix')) return 'netflix'; if (normalized.split(' ').some(word => word === 'gemini')) return 'gemini'; if (normalized.split(' ').some(word => word === 'chatgpt' || word === 'openai')) return 'chatgpt'; return aliases[normalized]; };

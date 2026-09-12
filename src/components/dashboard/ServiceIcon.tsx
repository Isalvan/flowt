import React from 'react';
import { CreditCard } from 'lucide-react';

// Brand artwork is intentionally kept behind one boundary. When Simple Icons SVGs
// are added to assets/brands, aliases can point to them without touching consumers.
const aliases: Record<string, string> = { spotify: 'spotify', 'chat gpt': 'chatgpt', chatgpt: 'chatgpt', openai: 'chatgpt', gemini: 'gemini', netflix: 'netflix', 'google play': 'google-play', prime: 'prime', 'amazon prime': 'prime', 'prime video': 'prime' };
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const ServiceIcon: React.FC<{ name?: string; color?: string }> = ({ name = '', color }) => {
  const key = aliases[normalize(name)];
  const initials = name.trim().slice(0, 1).toUpperCase();
  return <span aria-hidden="true" title={key ? `${key} (marca local)` : undefined} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xs font-black text-indigo-600 dark:border-slate-700 dark:bg-slate-800" style={color && !key ? { color, backgroundColor: `${color}18` } : undefined}>{key ? <span className="text-[10px]">{key === 'google-play' ? '▶' : key === 'chatgpt' ? '◎' : key === 'prime' ? 'a' : key[0].toUpperCase()}</span> : initials || <CreditCard size={16} />}</span>;
};

import React from 'react';
import { CreditCard } from 'lucide-react';
import spotify from '../../assets/brands/spotify.svg';
import googlePlay from '../../assets/brands/googleplay.svg';
import netflix from '../../assets/brands/netflix.svg';
import gemini from '../../assets/brands/googlegemini.svg';
import chatgpt from '../../assets/brands/chatgpt.svg';

// Brand artwork is intentionally kept behind one boundary. When Simple Icons SVGs
// are added to assets/brands, aliases can point to them without touching consumers.
const aliases: Record<string, string> = { spotify: 'spotify', 'chat gpt': 'chatgpt', chatgpt: 'chatgpt', openai: 'chatgpt', gemini: 'gemini', netflix: 'netflix', 'google play': 'google-play', prime: 'prime', 'amazon prime': 'prime', 'prime video': 'prime' };
const assets: Record<string, string> = { spotify, 'google-play': googlePlay, netflix, gemini, chatgpt };
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const ServiceIcon: React.FC<{ name?: string; color?: string }> = ({ name = '', color }) => {
  const key = aliases[normalize(name)];
  const initials = name.trim().slice(0, 1).toUpperCase();
  return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xs font-black text-indigo-600 dark:border-slate-700 dark:bg-slate-800" style={color && !assets[key] ? { color, backgroundColor: `${color}18` } : undefined}>{assets[key] ? <img src={assets[key]} alt="" className="h-5 w-5" /> : initials || <CreditCard size={16} />}</span>;
};

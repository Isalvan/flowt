import React from 'react';
import { CreditCard } from 'lucide-react';
import spotify from '../../assets/brands/spotify.svg';
import googlePlay from '../../assets/brands/googleplay.svg';
import netflix from '../../assets/brands/netflix.svg';
import gemini from '../../assets/brands/googlegemini.svg';
import chatgpt from '../../assets/brands/chatgpt.svg';

const aliases: Record<string, string> = { spotify: 'spotify', chatgpt: 'chatgpt', openai: 'chatgpt', gemini: 'gemini', netflix: 'netflix', googleplay: 'google-play', 'google play': 'google-play' };
const assets: Record<string, string> = { spotify, 'google-play': googlePlay, netflix, gemini, chatgpt };
export const normalizeServiceName = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const resolveServiceKey = (value: string) => { const normalized = normalizeServiceName(value); if (normalized.split(' ').some(word => word === 'spotify')) return 'spotify'; if (normalized.includes('google play')) return 'google-play'; if (normalized.split(' ').some(word => word === 'netflix')) return 'netflix'; if (normalized.split(' ').some(word => word === 'gemini')) return 'gemini'; if (normalized.split(' ').some(word => word === 'chatgpt' || word === 'openai')) return 'chatgpt'; return aliases[normalized]; };

export const ServiceIcon: React.FC<{ name?: string; color?: string }> = ({ name = '', color }) => {
  const key = resolveServiceKey(name);
  const initials = name.trim().slice(0, 1).toUpperCase();
  return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xs font-black text-indigo-600 dark:border-slate-700 dark:bg-slate-800" style={color && !assets[key] ? { color, backgroundColor: `${color}18` } : undefined}>{assets[key] ? <img src={assets[key]} alt="" className="h-5 w-5 dark:invert" /> : initials || <CreditCard size={16} />}</span>;
};

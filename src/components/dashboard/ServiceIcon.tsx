import React from 'react';
import { CreditCard } from 'lucide-react';
import spotify from '../../assets/brands/spotify.svg';
import googlePlay from '../../assets/brands/googleplay.svg';
import netflix from '../../assets/brands/netflix.svg';
import gemini from '../../assets/brands/googlegemini.svg';
import chatgpt from '../../assets/brands/chatgpt.svg';
import { resolveServiceKey } from './serviceIcon.utils';

const assets: Record<string, string> = { spotify, 'google-play': googlePlay, netflix, gemini, chatgpt };

export const ServiceIcon: React.FC<{ name?: string; color?: string }> = ({ name = '', color }) => {
  const key = resolveServiceKey(name);
  const initials = name.trim().slice(0, 1).toUpperCase();
  return <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xs font-black text-indigo-600 dark:border-slate-700 dark:bg-slate-800" style={color && !assets[key] ? { color, backgroundColor: `${color}18` } : undefined}>{assets[key] ? <img src={assets[key]} alt="" className={`h-5 w-5 ${key === 'chatgpt' ? 'dark:invert' : ''}`} /> : initials || <CreditCard size={16} />}</span>;
};

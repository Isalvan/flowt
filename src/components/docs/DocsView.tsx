import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Book, Shield, FileCode, Server, ChevronLeft } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

import readmeContent from '../../../README.md?raw';
import geminiContent from '../../../GEMINI.md?raw';
import instructionsContent from '../../../INSTRUCTIONS.md?raw';
import backendContent from '../../../tracker-backend/README.md?raw';

type DocSection = 'README' | 'GEMINI' | 'INSTRUCTIONS' | 'BACKEND';

const docContents: Record<DocSection, { title: string; content: string; icon: React.ReactNode; color: string }> = {
  README: { 
    title: 'General (README)', 
    content: readmeContent,
    icon: <Book size={18} />,
    color: 'indigo'
  },
  GEMINI: { 
    title: 'Arquitectura (ADR)', 
    content: geminiContent,
    icon: <FileCode size={18} />,
    color: 'violet'
  },
  INSTRUCTIONS: { 
    title: 'Instrucciones & Seguridad', 
    content: instructionsContent,
    icon: <Shield size={18} />,
    color: 'rose'
  },
  BACKEND: { 
    title: 'Setup Backend', 
    content: backendContent,
    icon: <Server size={18} />,
    color: 'emerald'
  }
};

export const DocsView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<DocSection>('README');
  const { theme, toggleTheme } = useTheme(); // Initialize theme hook if needed for manual toggle, though app layout doesn't strictly need it if it reads system/html class.
  
  // Back to home action
  const goHome = () => {
    window.location.href = '/';
  };

  const activeData = docContents[activeSection];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300 font-sans pb-24">
      {/* Background decorations matching App.tsx */}
      <div className="fixed inset-0 pointer-events-none z-[-2] opacity-85" style={{
          backgroundImage: 'linear-gradient(rgba(99, 102, 241, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.05) 1px, transparent 1px)',
          backgroundSize: '56px 56px'
      }} />
      <div className="bg-orb-left" />
      <div className="bg-orb-right" />

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-white/5 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={goHome}
              className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200/30 dark:border-white/5 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none uppercase text-slate-800 dark:text-white">
                Developer Docs
              </h1>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 leading-none block mt-1">
                Flowt Project Context
              </span>
            </div>
          </div>
          <div className="flex gap-2">
             <button
              onClick={toggleTheme}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-450 border border-slate-200/30 dark:border-white/5 flex items-center justify-center transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-sm"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 flex flex-col md:flex-row gap-8">
        
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-64 shrink-0 space-y-2">
          {(Object.keys(docContents) as DocSection[]).map((sectionKey) => {
            const isActive = activeSection === sectionKey;
            const data = docContents[sectionKey];
            
            return (
              <button
                key={sectionKey}
                onClick={() => setActiveSection(sectionKey)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all cursor-pointer ${
                  isActive 
                    ? `bg-${data.color}-500/10 border border-${data.color}-500/20 text-${data.color}-600 dark:text-${data.color}-400 shadow-sm` 
                    : 'bg-white/40 dark:bg-slate-900/40 border border-white/20 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-900/80 hover:scale-[1.02]'
                }`}
              >
                <div className={`p-1.5 rounded-lg ${isActive ? `bg-${data.color}-500/20 text-${data.color}-600 dark:text-${data.color}-400` : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                  {data.icon}
                </div>
                <span className="font-bold text-sm">{data.title}</span>
              </button>
            );
          })}
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">
          <div className="glass-panel rounded-[2rem] p-6 sm:p-10">
            {/* Tailwind Typography 'prose' takes care of the markdown styling automatically */}
            <article className="prose prose-slate dark:prose-invert prose-headings:font-title prose-a:text-indigo-500 hover:prose-a:text-indigo-600 prose-img:rounded-xl max-w-none prose-hr:border-slate-200/50 dark:prose-hr:border-white/10">
              <ReactMarkdown>{activeData.content}</ReactMarkdown>
            </article>
          </div>
        </main>

      </div>
    </div>
  );
};

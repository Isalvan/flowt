import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Book, Shield, FileCode, Server, ChevronLeft, Copy, Check, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

import readmeContent from '../../../README.md?raw';
import geminiContent from '../../../GEMINI.md?raw';
import instructionsContent from '../../../INSTRUCTIONS.md?raw';
import backendContent from '../../../tracker-backend/README.md?raw';

type DocSection = 'README' | 'GEMINI' | 'INSTRUCTIONS' | 'BACKEND';

const docContents: Record<DocSection, { title: string; content: string; icon: React.ReactNode }> = {
  README: { 
    title: 'General (README)', 
    content: readmeContent,
    icon: <Book size={16} />,
  },
  GEMINI: { 
    title: 'Arquitectura (ADR)', 
    content: geminiContent,
    icon: <FileCode size={16} />,
  },
  INSTRUCTIONS: { 
    title: 'Instrucciones', 
    content: instructionsContent,
    icon: <Shield size={16} />,
  },
  BACKEND: { 
    title: 'Setup Backend', 
    content: backendContent,
    icon: <Server size={16} />,
  }
};

export const DocsView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<DocSection>('README');
  const [copied, setCopied] = useState(false);
  const { theme, toggleTheme } = useTheme();
  
  const goHome = () => {
    window.location.href = '/';
  };

  const activeData = docContents[activeSection];

  const handleCopy = () => {
    navigator.clipboard.writeText(activeData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-white dark:bg-[#0a0a0a] text-slate-900 dark:text-slate-50 font-sans selection:bg-indigo-500/30 overflow-hidden transition-colors duration-300">
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 dark:border-white/10 flex flex-col shrink-0 bg-slate-50/50 dark:bg-[#0a0a0a] z-10">
        
        {/* Brand / Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
              F
            </div>
            <span className="font-semibold tracking-tight text-sm">Flowt Docs</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 mt-2 px-3">
            Documentos
          </div>
          {(Object.keys(docContents) as DocSection[]).map((sectionKey) => {
            const isActive = activeSection === sectionKey;
            const data = docContents[sectionKey];
            
            return (
              <button
                key={sectionKey}
                onClick={() => setActiveSection(sectionKey)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-slate-200/50 dark:bg-white/10 text-indigo-600 dark:text-white font-medium' 
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                <div className={`${isActive ? 'text-indigo-600 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                  {data.icon}
                </div>
                <span>{data.title}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div className="p-4 border-t border-slate-200 dark:border-white/10">
          <button
            onClick={goHome}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
            <span>Volver a la App</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen relative bg-white dark:bg-[#0a0a0a]">
        
        {/* Topbar */}
        <header className="h-16 flex items-center justify-end px-8 border-b border-slate-200 dark:border-white/10 shrink-0 sticky top-0 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md z-10">
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        {/* Scrollable Document Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-8 py-12 relative">
            
            <button
              onClick={handleCopy}
              className="absolute top-12 right-8 flex items-center gap-2 px-3 py-1.5 rounded border border-slate-200 dark:border-white/10 bg-white dark:bg-[#111] hover:bg-slate-50 dark:hover:bg-white/5 text-slate-600 dark:text-slate-300 transition-all text-xs font-medium shadow-sm cursor-pointer"
              title="Copiar Markdown RAW"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>

            <article className="prose prose-slate dark:prose-invert max-w-none 
              prose-headings:font-title prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-slate-900 dark:prose-headings:text-white
              prose-h1:text-4xl prose-h1:mb-8
              prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-slate-200 dark:prose-h2:border-white/10 prose-h2:pb-2
              prose-p:text-slate-600 dark:prose-p:text-slate-300 prose-p:leading-relaxed
              prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:font-medium prose-a:no-underline hover:prose-a:underline
              prose-code:text-slate-800 dark:prose-code:text-slate-200 prose-code:bg-slate-100 dark:prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-slate-50 dark:prose-pre:bg-[#111] prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-white/10 prose-pre:rounded-xl prose-pre:shadow-sm
              prose-hr:border-slate-200 dark:prose-hr:border-white/10
              prose-li:text-slate-600 dark:prose-li:text-slate-300
              prose-strong:text-slate-900 dark:prose-strong:text-white
              prose-blockquote:border-indigo-500 prose-blockquote:bg-indigo-50 dark:prose-blockquote:bg-indigo-500/10 prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:rounded-r-lg prose-blockquote:text-slate-700 dark:prose-blockquote:text-slate-300 prose-blockquote:not-italic"
            >
              <ReactMarkdown>{activeData.content}</ReactMarkdown>
            </article>

          </div>
        </div>

      </main>
    </div>
  );
};

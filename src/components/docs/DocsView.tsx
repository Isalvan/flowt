import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Book, Shield, FileCode, Server, ChevronLeft, Copy, Check, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

import readmeContent from '../../../README.md?raw';
import architectureContent from '../../../docs/ARCHITECTURE.md?raw';
import deploymentContent from '../../../docs/DEPLOYMENT.md?raw';
import backendContent from '../../../tracker-backend/README.md?raw';

type DocSection = 'README' | 'ARCHITECTURE' | 'DEPLOYMENT' | 'BACKEND';

const docContents: Record<DocSection, { title: string; content: string; icon: React.ReactNode }> = {
  README: { 
    title: 'General (README)', 
    content: readmeContent,
    icon: <Book size={16} />,
  },
  ARCHITECTURE: { 
    title: 'Arquitectura', 
    content: architectureContent,
    icon: <FileCode size={16} />,
  },
  DEPLOYMENT: { 
    title: 'Despliegue', 
    content: deploymentContent,
    icon: <Shield size={16} />,
  },
  BACKEND: { 
    title: 'Setup backend', 
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
    <div className="flex h-screen bg-page text-ink font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 border-r border-line flex flex-col shrink-0 bg-surface-2 z-10">
        
        {/* Brand / Header */}
        <div className="h-16 flex items-center px-6 border-b border-line shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-brand flex items-center justify-center text-white font-bold text-xs">
              F
            </div>
            <span className="font-semibold tracking-tight text-sm text-ink">Flowt Docs</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <div className="dashboard-label mb-2 mt-2 px-3">
            Documentos
          </div>
          {(Object.keys(docContents) as DocSection[]).map((sectionKey) => {
            const isActive = activeSection === sectionKey;
            const data = docContents[sectionKey];
            
            return (
              <button
                type="button"
                key={sectionKey}
                onClick={() => setActiveSection(sectionKey)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                  isActive 
                    ? 'bg-surface text-brand-ink shadow-sm' 
                    : 'text-ink-soft hover:text-ink hover:bg-surface/50'
                }`}
              >
                <div className={isActive ? 'text-brand-ink' : 'text-ink-faint'}>
                  {data.icon}
                </div>
                <span>{data.title}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div className="p-4 border-t border-line">
          <button
            type="button"
            onClick={goHome}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-ink-soft hover:text-ink hover:bg-surface transition-colors cursor-pointer"
          >
            <ChevronLeft size={16} />
            <span>Volver a la app</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen relative bg-page">
        
        {/* Topbar */}
        <header className="h-16 flex items-center justify-end px-8 border-b border-line shrink-0 sticky top-0 bg-surface z-10">
          <button
            type="button"
            onClick={toggleTheme}
            className="dashboard-icon-button"
            title="Cambiar tema"
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        {/* Scrollable Document Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-4xl mx-auto px-8 py-12 relative">
            
            <button
              type="button"
              onClick={handleCopy}
              className="dashboard-secondary-button absolute top-12 right-8 text-xs cursor-pointer"
              title="Copiar Markdown RAW"
            >
              {copied ? <Check size={14} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={14} />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>

            <article className="prose max-w-none 
              prose-headings:font-title prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-ink
              prose-h1:text-4xl prose-h1:mb-8
              prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-line prose-h2:pb-2
              prose-p:text-ink-soft prose-p:leading-relaxed
              prose-a:text-brand-ink prose-a:font-medium prose-a:no-underline hover:prose-a:underline
              prose-code:text-ink prose-code:bg-surface-2 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
              prose-pre:bg-surface-2 prose-pre:border prose-pre:border-line prose-pre:rounded-xl prose-pre:shadow-sm
              prose-hr:border-line
              prose-li:text-ink-soft
              prose-strong:text-ink
              prose-blockquote:border-brand prose-blockquote:bg-brand-tint prose-blockquote:px-4 prose-blockquote:py-1 prose-blockquote:rounded-r-lg prose-blockquote:text-ink-soft prose-blockquote:not-italic"
            >
              <ReactMarkdown>{activeData.content}</ReactMarkdown>
            </article>

          </div>
        </div>

      </main>
    </div>
  );
};

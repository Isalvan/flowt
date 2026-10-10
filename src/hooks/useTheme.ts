import { useEffect, useState } from 'react';

export const useTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('flowt-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    // Default to premium dark theme
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Also toggle the standard Tailwind dark class just in case the styling rules need it
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Keep the browser / PWA chrome the same colour as the page behind it
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#080a10' : '#f4f5f8');
    window.localStorage.setItem('flowt-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' };
};

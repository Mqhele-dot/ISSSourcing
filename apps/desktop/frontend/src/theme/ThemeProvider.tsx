import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Accent = 'ocean' | 'mango' | 'violet' | 'emerald' | 'crimson';
export type Density = 'comfortable' | 'compact';
export type FontScale = 'sm' | 'md' | 'lg';

type ThemeContextType = {
  theme: ThemeMode;
  accent: Accent;
  density: Density;
  fontScale: FontScale;
  setTheme: (t: ThemeMode) => void;
  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
  setFontScale: (f: FontScale) => void;
  resetDefaults: () => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);

function read<T extends string>(key: string, fallback: T): T {
  const val = localStorage.getItem(key) as T | null;
  return val ?? fallback;
}

export function ThemeProvider({ children }: { children: JSX.Element }) {
  const [theme, setTheme] = useState<ThemeMode>(() => read('sct.theme', 'system'));
  const [accent, setAccent] = useState<Accent>(() => read('sct.accent', 'ocean'));
  const [density, setDensity] = useState<Density>(() => read('sct.density', 'comfortable'));
  const [fontScale, setFontScale] = useState<FontScale>(() => read('sct.fontScale', 'md'));

  useEffect(() => {
    localStorage.setItem('sct.theme', theme);
    localStorage.setItem('sct.accent', accent);
    localStorage.setItem('sct.density', density);
    localStorage.setItem('sct.fontScale', fontScale);

    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);
    root.setAttribute('data-accent', accent);
    root.setAttribute('data-density', density);
    root.setAttribute('data-font', fontScale);
  }, [theme, accent, density, fontScale]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'system') {
        document.documentElement.setAttribute('data-theme', media.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  const value = useMemo<ThemeContextType>(() => ({
    theme, accent, density, fontScale,
    setTheme, setAccent, setDensity, setFontScale,
    resetDefaults: () => {
      setTheme('system'); setAccent('ocean'); setDensity('comfortable'); setFontScale('md');
    },
  }), [theme, accent, density, fontScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock matchMedia for JSDOM environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock Recharts to avoid SVG issues in JSDOM
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  AreaChart: ({ children }: any) => <div>{children}</div>,
  Area: () => null,
  PieChart: ({ children }: any) => <div>{children}</div>,
  Pie: ({ children }: any) => <div>{children}</div>,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

// Mock Firebase
vi.mock('./firebase', () => ({
  auth: {
    onAuthStateChanged: (cb: any) => {
      // Simulate unauthenticated user initially
      cb(null);
      return () => {};
    },
    signOut: vi.fn(),
  },
  db: {
    collection: vi.fn(),
    doc: vi.fn(),
  },
}));

// Mock Vite PWA
vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn(),
}));

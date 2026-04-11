import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Recharts to avoid SVG issues in JSDOM
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
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

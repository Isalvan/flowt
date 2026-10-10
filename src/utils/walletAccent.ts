/**
 * Each wallet gets its own colour, by position, so the same wallet reads the
 * same everywhere it shows up (card, split bar, login illustration).
 * Class names are written out in full so Tailwind can see them.
 */
export interface WalletAccent {
  hex: string;
  /** Tinted square behind the wallet icon. */
  chip: string;
  /** Solid fill for split segments. */
  fill: string;
  /** Text colour; drives anything painted with currentColor (meters). */
  ink: string;
}

export const WALLET_ACCENTS: WalletAccent[] = [
  { hex: '#6366f1', chip: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300', fill: 'bg-indigo-500', ink: 'text-indigo-500' },
  { hex: '#0ea5e9', chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-300', fill: 'bg-sky-500', ink: 'text-sky-500' },
  { hex: '#ff9f0a', chip: 'bg-sun-500/15 text-sun-600 dark:text-sun-300', fill: 'bg-sun-500', ink: 'text-sun-500' },
  { hex: '#10b981', chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300', fill: 'bg-emerald-500', ink: 'text-emerald-500' },
  { hex: '#f43f5e', chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-300', fill: 'bg-rose-500', ink: 'text-rose-500' },
  { hex: '#8b5cf6', chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-300', fill: 'bg-violet-500', ink: 'text-violet-500' },
  { hex: '#14b8a6', chip: 'bg-teal-500/12 text-teal-600 dark:text-teal-300', fill: 'bg-teal-500', ink: 'text-teal-500' },
];

export const walletAccent = (index: number): WalletAccent =>
  WALLET_ACCENTS[((index % WALLET_ACCENTS.length) + WALLET_ACCENTS.length) % WALLET_ACCENTS.length];

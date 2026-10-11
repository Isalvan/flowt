import { createContext } from 'react';

export interface Bank {
  id: string;
  nombre: string;
  anclaSaldo?: number;
  anclaFecha?: Date | null;
  ultimoDesfase?: number | null;
}
export const BanksContext = createContext<{
  banks: Bank[];
  addBank: (nombreOId: string) => Promise<void>;
  removeBank: (id: string) => Promise<void>;
  anchorBank: (id: string, saldo: number, desfase: number | null) => Promise<void>;
}>({ banks: [], addBank: async () => {}, removeBank: async () => {}, anchorBank: async () => {} });

import { createContext } from 'react';

export interface Bank { id: string; nombre: string }
export const BanksContext = createContext<{
  banks: Bank[];
  addBank: (nombreOId: string) => Promise<void>;
  removeBank: (id: string) => Promise<void>;
}>({ banks: [], addBank: async () => {}, removeBank: async () => {} });

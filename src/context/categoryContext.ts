import { createContext } from 'react';
import type { MovementCategory } from '../utils/movementSuggestions';

export const CategoriesContext = createContext<{
  custom: MovementCategory[];
  createCategory?: (label: string, tipo: MovementCategory['tipo']) => Promise<MovementCategory>;
}>({ custom: [] });

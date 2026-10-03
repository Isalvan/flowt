import { useContext, useMemo } from 'react';
import { CategoriesContext } from '../context/categoryContext';
import { MOVEMENT_CATEGORIES, categoryLabel, categoryOptions, suggestCategory, validCategory } from '../utils/movementSuggestions';
import type { Movimiento } from '../types';

export function useCategories() {
  const { custom, createCategory } = useContext(CategoriesContext);
  return useMemo(() => ({
    categories: [...MOVEMENT_CATEGORIES, ...custom],
    createCategory,
    categoryOptions: (tipo: Movimiento['tipo']) => categoryOptions(tipo, custom),
    categoryLabel: (id?: string) => categoryLabel(id, custom),
    validCategory: (id: string, tipo: Movimiento['tipo']) => validCategory(id, tipo, custom),
    suggestCategory: (m: Movimiento) => suggestCategory(m, custom),
  }), [custom, createCategory]);
}

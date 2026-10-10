import { useEffect, useState } from 'react';
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { usePrivacy } from '../context/PrivacyContext';
import { useCategories } from './useCategories';
import type { Hucha } from '../types';

export type CategoryHuchas = Record<string, string>;
const demoKey = 'flowt-demo-category-huchas';

export function readCategoryHuchas(value: unknown): CategoryHuchas {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, target]) => key.length > 0 && typeof target === 'string' && target.length > 0));
}

export function useCategoryHuchas(userId: string | undefined, huchas: Hucha[], demo: boolean) {
  const { isLocked } = usePrivacy();
  const { validCategory } = useCategories();
  const owner = demo ? 'demo' : userId ?? '';
  const [state, setState] = useState<{ owner: string; map: CategoryHuchas; loaded: boolean; error: string }>({ owner: '', map: {}, loaded: false, error: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isLocked || !owner) return;
    if (demo) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        try {
          setState({ owner, map: readCategoryHuchas(JSON.parse(localStorage.getItem(demoKey) ?? '{}')), loaded: true, error: '' });
        } catch {
          setState({ owner, map: {}, loaded: true, error: 'No se pudo cargar la configuración de prueba.' });
        }
      });
      return () => { cancelled = true; };
    }
    return onSnapshot(doc(db, 'review_configuration', owner), snapshot => {
      setState({ owner, map: readCategoryHuchas(snapshot.data()?.category_huchas), loaded: true, error: '' });
    }, () => setState({ owner, map: {}, loaded: false, error: 'No se pudo cargar la configuración. Inténtalo de nuevo.' }));
  }, [owner, demo, isLocked]);

  const setCategoryHucha = async (category: string, huchaId: string) => {
    if (isLocked || !owner || (!demo && auth.currentUser?.uid !== owner)) throw new Error('Desbloquea Flowt e inicia sesión para guardar.');
    if (huchaId && !validCategory(category, 'gasto')) throw new Error('Elige una categoría de gasto válida.');
    if (huchaId && !huchas.some(h => h.id === huchaId && h.activa !== false && !h.es_metalico && !h.es_interno && (demo || h.id_propietario === owner))) throw new Error('Elige una hucha activa para gastos bancarios.');
    setSaving(true);
    try {
      if (demo) {
        // Read the current persisted map so another mounted view cannot overwrite a recent change.
        const map = readCategoryHuchas(JSON.parse(localStorage.getItem(demoKey) ?? '{}'));
        if (huchaId) map[category] = huchaId;
        else delete map[category];
        localStorage.setItem(demoKey, JSON.stringify(map));
        setState({ owner, map, loaded: true, error: '' });
      } else {
        const ref = doc(db, 'review_configuration', owner);
        await runTransaction(db, async transaction => {
          const current = await transaction.get(ref);
          const map = readCategoryHuchas(current.data()?.category_huchas);
          if (huchaId) map[category] = huchaId;
          else delete map[category];
          transaction.set(ref, {
            category_huchas: map,
            revision: (current.data()?.revision ?? 0) + 1,
            updated_at: serverTimestamp(),
            last_changed_category: category,
          });
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    map: !isLocked && state.owner === owner ? state.map : {},
    loading: !isLocked && !!owner && (state.owner !== owner || !state.loaded),
    error: !isLocked && state.owner === owner ? state.error : '',
    saving,
    setCategoryHucha,
  };
}

import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { usePrivacy } from './PrivacyContext';
import { MOVEMENT_CATEGORIES, type MovementCategory } from '../utils/movementSuggestions';
import { CategoriesContext } from './categoryContext';

const demoKey = 'flowt-demo-categories';
const nameKey = (label: string) => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function CategoriesProvider({ children, forceDemo = false }: { children: ReactNode; forceDemo?: boolean }) {
  const { isLocked } = usePrivacy();
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<{ owner: string; items: MovementCategory[] }>({ owner: '', items: [] });
  const [demoItems, setDemoItems] = useState<MovementCategory[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(demoKey) ?? '[]'); return Array.isArray(saved) ? saved : []; }
    catch { return []; }
  });
  const demo = forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY;
  const owner = demo ? 'demo' : user?.uid ?? '';
  const custom = isLocked ? [] : demo ? demoItems : state.owner === owner ? state.items : [];

  useEffect(() => {
    if (demo) return;
    return onAuthStateChanged(auth, setUser);
  }, [demo]);

  useEffect(() => {
    if (isLocked || !owner || demo) return;
    return onSnapshot(collection(db, 'categorias', owner, 'items'), snapshot => {
      setState({ owner, items: snapshot.docs.map(d => ({ id: d.id, label: d.data().label, tipo: d.data().tipo })) });
    }, () => setState({ owner, items: [] }));
  }, [owner, demo, isLocked]);

  const createCategory = async (input: string, tipo: MovementCategory['tipo']) => {
    if (isLocked || !owner) throw new Error('Desbloquea Flowt e inicia sesión para crear categorías.');
    const label = input.trim().replace(/\s+/g, ' ');
    if (!label || label.length > 50 || !['gasto', 'ingreso', 'ambos'].includes(tipo)) throw new Error('Escribe un nombre de entre 1 y 50 caracteres.');
    const all = [...MOVEMENT_CATEGORIES, ...custom];
    if (all.some(c => nameKey(c.label) === nameKey(label) && (c.tipo === tipo || c.tipo === 'ambos' || tipo === 'ambos'))) throw new Error('Ya tienes una categoría con ese nombre para este tipo de movimiento.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${nameKey(label)}:${tipo}`));
    const id = 'custom_' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    const category: MovementCategory = { id, label, tipo };
    if (demo) {
      const items = [...custom, category];
      localStorage.setItem(demoKey, JSON.stringify(items));
      setDemoItems(items);
    } else {
      const ref = doc(db, 'categorias', owner, 'items', id);
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(ref);
        if (existing.exists()) throw new Error('Ya tienes una categoría con ese nombre.');
        transaction.set(ref, { label, tipo, created_at: serverTimestamp() });
      });
      setState(previous => ({ owner, items: [...(previous.owner === owner ? previous.items.filter(c => c.id !== id) : []), category] }));
    }
    return category;
  };

  return <CategoriesContext.Provider value={{ custom, createCategory }}>{children}</CategoriesContext.Provider>;
}

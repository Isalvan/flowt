import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { usePrivacy } from './PrivacyContext';
import { BANK_CATALOG, bankDate, bankNameKey } from '../utils/banks';
import { BanksContext, type Bank } from './bankContext';
import { loadStoredDemoData } from '../utils/demoStorage';

const demoKey = 'flowt-demo-bancos';

export function BanksProvider({ children, forceDemo = false }: { children: ReactNode; forceDemo?: boolean }) {
  const { isLocked } = usePrivacy();
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<{ owner: string; items: Bank[] }>({ owner: '', items: [] });
  const [demoItems, setDemoItems] = useState<Bank[]>(() => {
    try {
      if ((forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY) && !isLocked) loadStoredDemoData();
      const saved: unknown = JSON.parse(localStorage.getItem(demoKey) ?? '[]');
      return Array.isArray(saved) ? saved.filter((b): b is Bank => typeof b?.id === 'string' && typeof b?.nombre === 'string').map(b => ({ ...b, anclaFecha: bankDate(b.anclaFecha) })) : [];
    } catch { return []; }
  });
  const pending = useRef(new Set<string>());
  const demoRef = useRef(demoItems);
  const demo = forceDemo || !import.meta.env.VITE_FIREBASE_API_KEY;
  const owner = demo ? 'demo' : user?.uid ?? '';
  const items = isLocked ? [] : demo ? demoItems : state.owner === owner ? state.items : [];
  const banks = [...items].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  useEffect(() => {
    if (!demo || isLocked) return;
    const saved = loadStoredDemoData().bancos.map(b => ({ ...b, anclaFecha: bankDate(b.anclaFecha) }));
    demoRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDemoItems(saved);
  }, [demo, isLocked]);

  useEffect(() => {
    if (demo) return;
    return onAuthStateChanged(auth, setUser);
  }, [demo]);

  useEffect(() => {
    if (isLocked || !owner || demo) return;
    return onSnapshot(collection(db, 'bancos', owner, 'items'), snapshot => {
      setState({ owner, items: snapshot.docs.map(d => {
        const data = d.data();
        return { id: d.id, nombre: data.nombre, anclaSaldo: data.ancla_saldo, anclaFecha: bankDate(data.ancla_fecha), ultimoDesfase: data.ultimo_desfase ?? null };
      }) });
    }, () => setState({ owner, items: [] }));
  }, [owner, demo, isLocked]);

  const addBank = async (input: string) => {
    if (isLocked || !owner) throw new Error('Desbloquea Flowt e inicia sesión para añadir bancos.');
    const label = input.trim().replace(/\s+/g, ' ');
    const catalogBank = BANK_CATALOG.find(b => b.id === label || bankNameKey(b.nombre) === bankNameKey(label));
    const nombre = catalogBank?.nombre ?? label;
    if (!nombre || nombre.length > 40) throw new Error('Escribe un nombre de entre 1 y 40 caracteres.');
    const key = bankNameKey(nombre);
    if ((demo ? demoRef.current : items).some(b => bankNameKey(b.nombre) === key) || pending.current.has(key)) throw new Error('Ya tienes ese banco');
    pending.current.add(key);
    try {
      const digest = catalogBank ? null : await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const id = catalogBank?.id ?? 'custom_' + Array.from(new Uint8Array(digest!)).map(b => b.toString(16).padStart(2, '0')).join('');
      const bank = { id, nombre, anclaFecha: null, ultimoDesfase: null };
      if (demo) {
        const next = [...demoRef.current, bank];
        localStorage.setItem(demoKey, JSON.stringify(next));
        demoRef.current = next;
        setDemoItems(next);
      } else {
        const ref = doc(db, 'bancos', owner, 'items', id);
        await runTransaction(db, async transaction => {
          if ((await transaction.get(ref)).exists()) throw new Error('Ya tienes ese banco');
          transaction.set(ref, { nombre, created_at: serverTimestamp() });
        });
        setState(previous => ({ owner, items: [...(previous.owner === owner ? previous.items.filter(b => b.id !== id) : []), bank] }));
      }
    } finally { pending.current.delete(key); }
  };

  const removeBank = async (id: string) => {
    if (isLocked || !owner) throw new Error('Desbloquea Flowt e inicia sesión para quitar bancos.');
    if (demo) {
      const next = demoRef.current.filter(b => b.id !== id);
      localStorage.setItem(demoKey, JSON.stringify(next));
      demoRef.current = next;
      setDemoItems(next);
    } else {
      await deleteDoc(doc(db, 'bancos', owner, 'items', id));
      setState(previous => ({ owner, items: previous.owner === owner ? previous.items.filter(b => b.id !== id) : [] }));
    }
  };

  const anchorBank = async (id: string, saldo: number, desfase: number | null) => {
    if (isLocked || !owner) throw new Error('Desbloquea Flowt e inicia sesión para anotar saldos.');
    if (!Number.isFinite(saldo) || saldo < -1_000_000 || saldo > 100_000_000 || (desfase !== null && !Number.isFinite(desfase))) throw new Error('Escribe un saldo válido.');
    if (!(demo ? demoRef.current : items).some(b => b.id === id)) throw new Error('El banco ya no está disponible.');
    const update = { anclaSaldo: saldo, anclaFecha: new Date(), ultimoDesfase: desfase };
    if (demo) {
      const next = demoRef.current.map(b => b.id === id ? { ...b, ...update } : b);
      localStorage.setItem(demoKey, JSON.stringify(next));
      demoRef.current = next;
      setDemoItems(next);
    } else {
      await updateDoc(doc(db, 'bancos', owner, 'items', id), { ancla_saldo: saldo, ancla_fecha: serverTimestamp(), ultimo_desfase: desfase, updated_at: serverTimestamp() });
    }
  };

  return <BanksContext.Provider value={{ banks, addBank, removeBank, anchorBank }}>{children}</BanksContext.Provider>;
}

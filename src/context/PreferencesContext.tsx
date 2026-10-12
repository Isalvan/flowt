import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { InicioPeriodo } from '../utils/periods';

interface Preferences {
  horasSemanales: number | null;
  umbralCompraPequena: number;
  inicioPeriodo: InicioPeriodo;
  cifraDestacada: string | null;
}

interface PreferencesContextType extends Preferences {
  updatePreferences: (partial: Partial<Preferences>) => Promise<void>;
}

const defaults: Preferences = { horasSemanales: null, umbralCompraPequena: 5, inicioPeriodo: 1, cifraDestacada: null };
const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);
// Outside a provider (isolated component tests) the defaults apply and nothing is saved.
const fallback: PreferencesContextType = { ...defaults, updatePreferences: async () => {} };
const storageKey = (uid: string | null) => `flowt:prefs:${uid ?? 'demo'}`;
const inRange = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= max;

// Invalid stored data or updates never replace a valid preference.
function validated(partial: Partial<Preferences>): Partial<Preferences> {
  const result: Partial<Preferences> = {};
  if (partial.cifraDestacada === null || (typeof partial.cifraDestacada === 'string' && partial.cifraDestacada.length >= 1 && partial.cifraDestacada.length <= 128)) result.cifraDestacada = partial.cifraDestacada;
  if (partial.horasSemanales === null || inRange(partial.horasSemanales, 80)) result.horasSemanales = partial.horasSemanales;
  if (inRange(partial.umbralCompraPequena, 100)) result.umbralCompraPequena = partial.umbralCompraPequena;
  if (partial.inicioPeriodo === 'nomina' || (inRange(partial.inicioPeriodo, 28) && Number.isInteger(partial.inicioPeriodo))) result.inicioPeriodo = partial.inicioPeriodo;
  return result;
}

// The demo account is paid at the end of the month, so its periods run from payroll to payroll unless changed.
const demoDefaults: Preferences = { ...defaults, inicioPeriodo: 'nomina' };

function loadLocal(uid: string | null): Preferences {
  const base = uid ? defaults : demoDefaults;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(uid)) ?? '{}');
    return { ...base, ...validated(saved ?? {}) };
  } catch { return { ...base }; }
}

function saveLocal(uid: string | null, preferences: Preferences) {
  const { inicioPeriodo, ...existing } = preferences;
  try { localStorage.setItem(storageKey(uid), JSON.stringify(uid && inicioPeriodo === 1 ? existing : preferences)); }
  catch { /* Storage may be unavailable; preferences still work in memory. */ }
}

export function PreferencesProvider({ children, forceDemo = false }: { children: ReactNode; forceDemo?: boolean }) {
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const current = useRef(preferences);
  const userId = useRef<string | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async (uid: string | null) => {
      const version = ++revision.current;
      userId.current = uid;
      current.current = loadLocal(uid);
      setPreferences(current.current);
      if (!uid) return;
      try {
        const snapshot = await getDoc(doc(db, 'settings', uid));
        if (!active || version !== revision.current || !snapshot.exists()) return;
        const data = snapshot.data();
        current.current = { ...current.current, ...validated({
          horasSemanales: data.horas_semanales,
          umbralCompraPequena: data.umbral_compra_pequena,
          inicioPeriodo: data.inicio_periodo,
          cifraDestacada: data.cifra_destacada,
        }) };
        setPreferences(current.current);
        saveLocal(uid, current.current);
      } catch { /* Keep the local copy if Firestore is unavailable. */ }
    };
    const unsubscribe = forceDemo ? (void load(null), () => {}) : onAuthStateChanged(auth, user => { void load(user?.uid ?? null); });
    return () => { active = false; unsubscribe(); };
  }, [forceDemo]);

  const updatePreferences = useCallback(async (partial: Partial<Preferences>) => {
    const changes = validated(partial);
    if (!Object.keys(changes).length) return;
    ++revision.current;
    const uid = userId.current;
    current.current = { ...current.current, ...changes };
    setPreferences(current.current);
    saveLocal(uid, current.current);
    if (!uid) return;
    const data = {
      ...('horasSemanales' in changes ? { horas_semanales: changes.horasSemanales } : {}),
      ...('umbralCompraPequena' in changes ? { umbral_compra_pequena: changes.umbralCompraPequena } : {}),
      ...('inicioPeriodo' in changes ? { inicio_periodo: changes.inicioPeriodo } : {}),
      ...('cifraDestacada' in changes ? { cifra_destacada: changes.cifraDestacada } : {}),
    };
    try { await setDoc(doc(db, 'settings', uid), data, { merge: true }); }
    catch { /* The local copy remains available until rules are deployed. */ }
  }, []);

  return <PreferencesContext.Provider value={{ ...preferences, updatePreferences }}>{children}</PreferencesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences() {
  const context = useContext(PreferencesContext);
  return context ?? fallback;
}

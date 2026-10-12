import { buildDemoData, sortDemoMovements } from './demoData';
import { bankDate } from './banks';

export const DEMO_VERSION = '3';
const dataKeys = ['movimientos', 'huchas', 'suscripciones', 'stats', 'pending', 'bancos'] as const;

export function loadStoredDemoData(now = new Date()): ReturnType<typeof buildDemoData> {
  if (localStorage.getItem('flowt-demo-version') !== DEMO_VERSION) {
    dataKeys.forEach(key => localStorage.removeItem(`flowt-demo-${key}`));
  }
  if (dataKeys.slice(0, 5).some(key => localStorage.getItem(`flowt-demo-${key}`) === null)) {
    const data = buildDemoData(now);
    dataKeys.forEach(key => {
      if (key !== 'bancos' || localStorage.getItem('flowt-demo-bancos') === null) {
        localStorage.setItem(`flowt-demo-${key}`, JSON.stringify(data[key]));
      }
    });
  } else if (localStorage.getItem('flowt-demo-bancos') === null) {
    localStorage.setItem('flowt-demo-bancos', JSON.stringify(buildDemoData(now).bancos));
  }
  localStorage.setItem('flowt-demo-version', DEMO_VERSION);
  const data = Object.fromEntries(dataKeys.map(key => [key, JSON.parse(localStorage.getItem(`flowt-demo-${key}`)!)])) as ReturnType<typeof buildDemoData>;
  const bancos = Array.isArray(data.bancos) ? data.bancos.filter(b => typeof b?.id === 'string' && typeof b?.nombre === 'string').map(b => ({ ...b, anclaFecha: bankDate(b.anclaFecha) })) : [];
  return { ...data, movimientos: sortDemoMovements(data.movimientos), bancos };
}

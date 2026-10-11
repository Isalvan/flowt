import { type Hucha } from '../../types';


/** Wallet that gets an expense's money back: its own, or the default one when that is archived or gone. */
export const refundHuchaId = (huchaId: string | null | undefined, wallets: Hucha[]): string | undefined => {
  const own = wallets.find(h => h.id === huchaId);
  if (own && own.activa !== false) return own.id;
  return wallets.find(h => h.es_principal && h.activa !== false)?.id || wallets.find(h => h.activa !== false)?.id;
};

  // Redirect overflow logic
  export const redirectOverflowToResto = (
    deltas: Record<string, number>,
    huchasState: Hucha[]
  ): { adjusted: Record<string, number>; overflow: number; restoId: string | null } => {
    const adjusted: Record<string, number> = { ...deltas };
    let leftover = 0;

    for (const [hid, delta] of Object.entries(deltas)) {
      if (delta <= 0) continue;
      const h = huchasState.find(x => x.id === hid);
      if (!h) continue;
      if (!h.tope_objetivo || !h.objetivo || h.objetivo <= 0) continue;
      const room = Math.max(0, h.objetivo - h.saldo_acumulado);
      if (delta > room) {
        adjusted[hid] = room;
        leftover += delta - room;
      }
    }

    if (leftover <= 0) return { adjusted, overflow: 0, restoId: null };

    const candidates = huchasState.filter(h => h.activa !== false);
    const restoCandidate =
      candidates.find(h => h.tipo_aportacion === 'resto') ??
      candidates.find(h => h.es_principal) ??
      candidates[0];

    if (!restoCandidate) return { adjusted, overflow: leftover, restoId: null };

    const destRoom = restoCandidate.tope_objetivo && restoCandidate.objetivo
      ? Math.max(0, restoCandidate.objetivo - restoCandidate.saldo_acumulado - (adjusted[restoCandidate.id] ?? 0))
      : Infinity;
    const accepted = Math.min(leftover, destRoom);
    if (accepted > 0) {
      adjusted[restoCandidate.id] = (adjusted[restoCandidate.id] ?? 0) + accepted;
    }
    return { adjusted, overflow: leftover - accepted, restoId: restoCandidate.id };
  };
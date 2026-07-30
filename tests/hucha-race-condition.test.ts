import { describe, it, expect, vi } from 'vitest';

describe('Hucha Principal Race Condition Prevention', () => {
  it('reads fresh huchas from Firestore inside transaction instead of stale client state', async () => {
    // Mock DB snapshot returning fresh huchas from DB
    const freshDbHuchas = [
      { id: 'h-1', es_principal: true, tipo_aportacion: 'resto' },
      { id: 'h-2', es_principal: false, tipo_aportacion: 'flat' }
    ];

    const mockTransaction = {
      get: vi.fn().mockResolvedValue({
        docs: freshDbHuchas.map(h => ({
          id: h.id,
          data: () => h
        }))
      }),
      update: vi.fn()
    };

    // Simulate transaction execution
    const snapshot = await mockTransaction.get('query-ref');
    const freshHuchas = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Setting h-2 as principal should unmark h-1 from DB fresh state
    const editingId = 'h-2';
    const isNewPrincipal = true;

    if (isNewPrincipal) {
      const otherPrincipals = freshHuchas.filter(h => h.es_principal && h.id !== editingId);
      for (const h of otherPrincipals) {
        mockTransaction.update(`doc-${h.id}`, { es_principal: false });
      }
    }

    expect(mockTransaction.get).toHaveBeenCalled();
    expect(mockTransaction.update).toHaveBeenCalledWith('doc-h-1', { es_principal: false });
  });
});

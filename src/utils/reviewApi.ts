import { auth } from '../firebase';

export const hasReviewApi = () => !!import.meta.env.VITE_REVIEW_API_URL;

/** The service could not be reached at all: no answer, so nothing is known to have been applied. */
export class ReviewApiUnreachableError extends Error {
  constructor() {
    super('No se pudo contactar con el servicio');
  }
}

export async function editReviewedMovement(movementId: string, changes: { name?: string; category?: string; hucha_id?: string }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión para guardar');
  const owner = user.uid;
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== owner) throw new Error('La sesión ha cambiado');
  const base = String(import.meta.env.VITE_REVIEW_API_URL).replace(/\/$/, '');
  const response = await fetch(`${base}/api/reviews/edit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ movement_id: movementId, ...changes }),
  }).catch(() => { throw new ReviewApiUnreachableError(); });
  const result = await response.json();
  if (auth.currentUser?.uid !== owner) throw new Error('La sesión ha cambiado');
  if (!response.ok) throw new Error(result.message ?? 'No se pudo guardar el cambio');
  return result;
}

/**
 * Edits through the service when there is one and it answers. Returns false when
 * the caller must write to Firestore itself: no service configured, or it is
 * unreachable from this network. The direct write is the same edit, so repeating
 * it after a lost answer is harmless.
 */
export async function tryEditReviewedMovement(movementId: string, changes: { name?: string; category?: string; hucha_id?: string }): Promise<boolean> {
  if (!hasReviewApi()) return false;
  try {
    await editReviewedMovement(movementId, changes);
    return true;
  } catch (error) {
    if (error instanceof ReviewApiUnreachableError) return false;
    throw error;
  }
}

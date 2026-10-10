import { auth } from '../firebase';

export const hasReviewApi = () => !!import.meta.env.VITE_REVIEW_API_URL;

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
  });
  const result = await response.json();
  if (auth.currentUser?.uid !== owner) throw new Error('La sesión ha cambiado');
  if (!response.ok) throw new Error(result.message ?? 'No se pudo guardar el cambio');
  return result;
}

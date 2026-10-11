import { useEffect, useRef, useState } from 'react';
import { auth } from '../../firebase';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import type { Hucha, Suscripcion } from '../../types';

interface ReviewItem {
  id: string;
  movement_id: string;
  reason: string;
  created_at: string;
  reverted: boolean;
  effects: Record<string, { before: Record<string, unknown>; after: Record<string, unknown> }>;
}
interface HistoryPage { items: ReviewItem[]; next_cursor?: string | null }
interface ReviewQuestion { id: string; question: string; movement_ids: string[]; state: string }
interface ReviewIssue { id: string; movement_id: string; last_error: string | { message?: string } }
interface QuestionsPage { items: ReviewQuestion[]; errors: ReviewIssue[] }
interface RequestScope { owner: string; active: boolean; controller: AbortController; sequence: number }
interface ViewState { owner: string; items: ReviewItem[]; cursor: string | null; loading: boolean; error: string; busy: string; questions: ReviewQuestion[]; issues: ReviewIssue[]; answers: Record<string, string>; questionsError: string }
const emptyState = (owner = ''): ViewState => ({ owner, items: [], cursor: null, loading: false, error: '', busy: '', questions: [], issues: [], answers: {}, questionsError: '' });
const fieldLabels: Record<string, string> = { concepto: 'Nombre', categoria: 'Categoría', hucha_id: 'Hucha', suscripcion_id: 'Suscripción' };

export function ReviewHistoryView({ userId, demo = false, huchas = [], suscripciones = [] }: { userId?: string; demo?: boolean; huchas?: Hucha[]; suscripciones?: Suscripcion[] }) {
  const { isLocked, openUnlockModal } = usePrivacy();
  const { categoryLabel } = useCategories();
  const baseUrl = (import.meta.env.VITE_REVIEW_API_URL ?? '').replace(/\/$/, '');
  const scopeRef = useRef<RequestScope | null>(null);
  const [state, setState] = useState<ViewState>(emptyState);
  const enabled = !!userId && !isLocked && !demo && !!baseUrl;

  const request = async (scope: RequestScope, path: string, body: Record<string, unknown>) => {
    const user = auth.currentUser;
    if (!scope.active || user?.uid !== scope.owner) throw new Error('Inicia sesión de nuevo para consultar tus revisiones.');
    const token = await user.getIdToken();
    if (!scope.active || auth.currentUser?.uid !== scope.owner) return null;
    const response = await fetch(`${baseUrl}/api/reviews/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: scope.controller.signal,
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('No se pudo contactar con el servicio de revisiones. Inténtalo de nuevo.'); }
    if (!scope.active || auth.currentUser?.uid !== scope.owner) return null;
    if (!response.ok) {
      const message = payload.message ?? payload.error?.message ?? payload.detail;
      throw new Error(typeof message === 'string' ? message : 'No se pudo completar la operación. Inténtalo de nuevo.');
    }
    return payload;
  };

  const load = async (scope: RequestScope, cursor: string | null = null) => {
    const sequence = ++scope.sequence;
    setState(previous => ({ ...(previous.owner === scope.owner ? previous : emptyState(scope.owner)), loading: true, error: '' }));
    try {
      const [historyResult, questionsResult] = await Promise.allSettled([
        request(scope, 'history', { limit: 20, ...(cursor ? { cursor } : {}) }),
        cursor ? Promise.resolve(null) : request(scope, 'questions', {}),
      ]);
      if (!scope.active || sequence !== scope.sequence) return;
      if (questionsResult.status === 'fulfilled' && questionsResult.value) {
        const questions: QuestionsPage = questionsResult.value;
        if (Array.isArray(questions.items) && Array.isArray(questions.errors)) {
          setState(previous => ({ ...previous, questions: questions.items.filter(q => q.state !== 'resolved'), issues: questions.errors, questionsError: '' }));
        } else setState(previous => ({ ...previous, questionsError: 'No se pudieron cargar las dudas pendientes.' }));
      } else if (questionsResult.status === 'rejected') {
        setState(previous => ({ ...previous, questionsError: questionsResult.reason instanceof Error ? questionsResult.reason.message : 'No se pudieron cargar las dudas pendientes.' }));
      }
      if (historyResult.status === 'rejected') throw historyResult.reason;
      const page: HistoryPage | null = historyResult.value;
      if (!page || !scope.active || sequence !== scope.sequence) return;
      if (!Array.isArray(page.items)) throw new Error('No se pudo cargar el historial. Inténtalo de nuevo.');
      setState(previous => ({ ...previous, owner: scope.owner, items: cursor ? [...previous.items, ...page.items.filter(item => !previous.items.some(existing => existing.id === item.id))] : page.items,
        cursor: page.next_cursor ?? null, loading: false, error: '', busy: '' }));
    } catch (e) {
      if (!scope.active || sequence !== scope.sequence) return;
      setState(previous => ({ ...previous, loading: false, busy: '', error: e instanceof Error ? e.message : 'No se pudo cargar el historial.' }));
    }
  };

  useEffect(() => {
    if (!enabled || !userId) {
      scopeRef.current = null;
      // Clear retained sensitive data after locking or leaving the account.
      let cancelled = false;
      queueMicrotask(() => { if (!cancelled) setState(emptyState()); });
      return () => { cancelled = true; };
    }
    const scope: RequestScope = { owner: userId, active: true, controller: new AbortController(), sequence: 0 };
    scopeRef.current = scope;
    void load(scope);
    return () => { scope.active = false; scope.controller.abort(); };
    // Requests are scoped to identity, privacy and endpoint, never to the current page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, baseUrl]);

  const revert = async (item: ReviewItem) => {
    const scope = scopeRef.current;
    if (!enabled || !scope?.active || scope.owner !== userId) return;
    setState(previous => ({ ...previous, busy: item.id, error: '' }));
    try {
      const result = await request(scope, 'revert', { review_id: item.id });
      if (result && scope.active) await load(scope);
    } catch (e) {
      if (scope.active) setState(previous => ({ ...previous, busy: '', error: e instanceof Error ? e.message : 'No se pudo deshacer la revisión.' }));
    }
  };
  const answerQuestion = async (questionId: string) => {
    const scope = scopeRef.current;
    const answer = (state.answers[questionId] ?? '').trim();
    if (!answer || !enabled || !scope?.active || scope.owner !== userId || state.busy) return;
    setState(previous => ({ ...previous, busy: `question:${questionId}`, questionsError: '' }));
    try {
      const result = await request(scope, 'answer', { question_id: questionId, answer });
      if (!result || !scope.active) return;
      if (result.state !== 'resolved') throw new Error('No se pudo guardar la respuesta. Inténtalo de nuevo.');
      setState(previous => {
        const answers = { ...previous.answers };
        delete answers[questionId];
        return { ...previous, busy: '', questions: previous.questions.filter(question => question.id !== questionId), answers };
      });
    } catch (e) {
      if (scope.active) setState(previous => ({ ...previous, busy: '', questionsError: e instanceof Error ? e.message : 'No se pudo guardar la respuesta.' }));
    }
  };
  const valueLabel = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return 'Sin asignación';
    if (field === 'categoria') {
      const label = categoryLabel(String(value));
      return label === 'Sin categorizar' && value !== 'sin_categorizar' ? `Categoría ${String(value)}` : label;
    }
    if (field === 'hucha_id') return huchas.find(h => h.id === value)?.nombre ?? 'Hucha no disponible';
    if (field === 'suscripcion_id') return suscripciones.find(s => s.id === value)?.nombre ?? 'Suscripción no disponible';
    return String(value);
  };
  const visible = enabled && state.owner === userId;

  return <section className="w-full max-w-4xl mx-auto dashboard-surface p-5 sm:p-6">
    <h3 className="dashboard-heading">Revisiones automáticas</h3>
    {isLocked ? <div className="py-6 text-center"><p className="text-sm text-ink-soft mb-3">Desbloquea Flowt para ver tus revisiones.</p><button onClick={() => openUnlockModal()} className="dashboard-primary-button">Desbloquear</button></div>
      : demo ? <p className="mt-4 text-sm text-ink-soft">Las revisiones automáticas estarán disponibles en tu cuenta. La demo no modifica movimientos.</p>
      : !baseUrl ? <p className="mt-4 text-sm text-ink-soft">Las revisiones automáticas todavía no están disponibles.</p>
      : !userId ? <p className="mt-4 text-sm text-ink-soft">Inicia sesión para ver tus revisiones.</p>
      : <>
        <p className="dashboard-subtitle mt-2 mb-5">Consulta qué cambió Flowt y deshaz una revisión cuando lo necesites.</p>
        {visible && state.error && <p role="alert" className="notice is-danger mb-4">{state.error}</p>}
        {visible && state.questionsError && <p role="alert" className="notice is-danger mb-4">{state.questionsError}</p>}
        {visible && state.issues.length > 0 && <div className="notice is-warning mb-5 flex-col items-start p-4"><h4 className="font-semibold text-sm">Revisiones que necesitan atención</h4><ul className="mt-2 space-y-2 text-sm font-normal">{state.issues.map(issue => <li key={issue.id}>{typeof issue.last_error === 'string' ? issue.last_error : issue.last_error?.message ?? 'No se pudo completar una revisión.'}</li>)}</ul></div>}
        {visible && state.questions.length > 0 && <div className="mb-5 space-y-3"><h4 className="font-semibold text-sm text-ink">Dudas pendientes</h4>{state.questions.map(question => <div key={question.id} className="rounded-xl bg-surface-2 p-4"><label className="block text-sm text-ink"><span>{question.question}</span><textarea aria-label={`Respuesta: ${question.question}`} value={state.answers[question.id] ?? ''} maxLength={3000} disabled={state.loading || !!state.busy} onChange={event => { const answer = event.target.value; setState(previous => ({ ...previous, answers: { ...previous.answers, [question.id]: answer } })); }} rows={2} className="field mt-3 block bg-surface" /></label><button onClick={() => void answerQuestion(question.id)} disabled={state.loading || !!state.busy || !(state.answers[question.id] ?? '').trim()} className="dashboard-primary-button mt-3">{state.busy === `question:${question.id}` ? 'Guardando…' : 'Guardar respuesta'}</button></div>)}</div>}
        {visible && state.items.map(item => <article key={item.id} className="mb-3 rounded-xl bg-surface-2 p-4 text-sm text-ink">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{item.reverted ? 'Revisión deshecha' : 'Revisado automáticamente'}</span><time className="text-xs text-ink-soft">{Number.isNaN(Date.parse(item.created_at)) ? 'Fecha no disponible' : new Date(item.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</time></div>
          {item.reason && <p className="mt-2">{item.reason}</p>}
          <ul className="mt-3 space-y-1">{Object.entries(item.effects ?? {}).flatMap(([movement, effect]) => Object.entries(effect.after).filter(([field]) => field in fieldLabels).map(([field, after]) => <li key={`${movement}:${field}`}><span className="font-medium">{fieldLabels[field]}{movement !== item.movement_id ? ' de otro cobro relacionado' : ''}:</span> {valueLabel(field, effect.before[field])} → {valueLabel(field, after)}</li>))}</ul>
          {!item.reverted && <button onClick={() => void revert(item)} disabled={state.loading || !!state.busy} className="dashboard-secondary-button mt-3">{state.busy === item.id ? 'Deshaciendo…' : 'Deshacer'}</button>}
        </article>)}
        {(!visible || state.loading) && <p role="status" className="text-sm text-ink-soft">Cargando revisiones…</p>}
        {visible && !state.loading && !state.error && state.items.length === 0 && <p className="text-sm text-ink-soft">Todavía no hay revisiones automáticas.</p>}
        {visible && state.cursor && <button disabled={state.loading || !!state.busy} onClick={() => { const scope = scopeRef.current; if (scope?.active) void load(scope, state.cursor); }} className="dashboard-secondary-button mt-3">Ver más</button>}
        {visible && (state.error || state.questionsError) && <button disabled={state.loading || !!state.busy} onClick={() => { const scope = scopeRef.current; if (scope?.active) void load(scope); }} className="dashboard-secondary-button mt-3">Reintentar</button>}
      </>}
  </section>;
}


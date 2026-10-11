import { lazy } from 'react';

export const LazyDocsView = lazy(() => import('./DocsView').then((m) => ({ default: m.DocsView })));

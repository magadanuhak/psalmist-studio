import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';
import './trainer.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);

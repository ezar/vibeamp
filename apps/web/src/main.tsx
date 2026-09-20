import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';

const container = document.getElementById('root');
if (container === null) throw new Error('#root is missing from the page');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

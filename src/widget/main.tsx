import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { WidgetApp } from './WidgetApp';

createRoot(document.getElementById('widget-root')!).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);

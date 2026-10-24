import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/Landing';
import { ConsolePage, SinglePhonePage } from './pages/Pages';
import { SimulationPage } from './pages/Simulation';
import * as store from './store';
import './styles.css';

// Dev-only hook for the browser end-to-end check (scripts/e2e-browser.mjs). Not present in production builds.
if (import.meta.env.DEV) (window as unknown as { __rakshak: typeof store }).__rakshak = store;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/sim" element={<SimulationPage />} />
        <Route path="/predator" element={<SinglePhonePage side="predator" />} />
        <Route path="/victim" element={<SinglePhonePage side="victim" />} />
        <Route path="/console" element={<ConsolePage />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
);

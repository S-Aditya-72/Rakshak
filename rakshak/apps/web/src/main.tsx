import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { isNative } from './lib/native';
import { JoinLink, MobileHome, RoleScreen } from './mobile/MobileApp';
import { LandingPage } from './pages/Landing';
import { EnginePage } from './pages/Engine';
import { ConsolePage, SinglePhonePage } from './pages/Pages';
import { SimulationPage } from './pages/Simulation';
import * as store from './store';
import './styles.css';
import './phone.css';

// Dev-only hook for the browser end-to-end check (scripts/e2e-browser.mjs). Not present in production builds.
if (import.meta.env.DEV) (window as unknown as { __rakshak: typeof store }).__rakshak = store;

// The Android app opens on this phone's role, or setup the first time (index.html does it before anything loads).
if (isNative && (location.hash === '' || location.hash === '#/')) location.hash = '#/app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/sim" element={<SimulationPage />} />
        <Route path="/predator" element={<SinglePhonePage side="predator" />} />
        <Route path="/victim" element={<SinglePhonePage side="victim" />} />
        <Route path="/console" element={<ConsolePage />} />
        <Route path="/engine" element={<EnginePage />} />
        <Route path="/app" element={<MobileHome />} />
        <Route path="/join" element={<JoinLink />} />
        <Route path="/m/child" element={<RoleScreen role="child" />} />
        <Route path="/m/guardian" element={<RoleScreen role="guardian" />} />
        <Route path="/m/contact" element={<RoleScreen role="contact" />} />
        <Route path="/m/temp" element={<RoleScreen role="temp" />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Acceso al estado desde la consola del navegador (pruebas y depuración).
import { useStore } from './store';
(window as unknown as { __mice: typeof useStore }).__mice = useStore;
import { sceneApi } from './components/sceneApi';
(window as unknown as { __sceneApi: typeof sceneApi }).__sceneApi = sceneApi;

// Sincronización entre dispositivos (si este dispositivo está vinculado y no es un enlace de cliente)
import { startAutoSync } from './lib/sync';
import { isViewer, startAuth } from './lib/auth';
if (!location.hash.startsWith('#p-')) {
  startAuth();
  startAutoSync();
  // Gafas y pantallas (solo ver): cada proyecto se abre como presentación, sin editar
  useStore.subscribe((s, prev) => {
    if (s.project && s.project.id !== prev.project?.id && isViewer()) {
      s.setCloud({ readOnly: true });
      s.setClientMode(true);
    }
  });
}

// Gafas de realidad mixta / virtual (WebXR): comprobar si este navegador las admite
import { detectXR, useXR } from './lib/xr';
detectXR();
(window as unknown as { __xrState: () => unknown }).__xrState = () => {
  const { mode, step, message } = useXR.getState();
  return { mode, step, message };
};

// Registro de uso para las pruebas con usuarios (solo con una sesión de prueba activa)
import { attachUsageLog } from './lib/usageLog';
attachUsageLog(useStore);

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

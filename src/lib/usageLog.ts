// Registro automático de uso durante las pruebas con usuarios (capítulo 7 del TFG).
// Mientras hay una sesión de prueba activa se anotan, de forma anónima y con su hora, las
// acciones relevantes del participante. Se guarda solo en este navegador (localStorage).

import type { StoreApi, UseBoundStore } from 'zustand';
import type { Project } from '../types';
import { analyze } from './safety';

export interface UsageEvent {
  /** Milisegundos desde el inicio de la sesión. */
  t: number;
  type: string;
  detail?: string;
}

export interface UsageSession {
  id: string;
  participant: string;
  start: number;
  end?: number;
  events: UsageEvent[];
}

const KEY = 'mice-design-registro-uso';

function load(): UsageSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function save(list: UsageSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento: el registro se pierde, la app sigue funcionando */
  }
}

export const listSessions = (): UsageSession[] => load();
export const activeSession = (): UsageSession | undefined => load().find((s) => !s.end);

export function startSession(participant: string): UsageSession {
  const list = load().map((s) => (s.end ? s : { ...s, end: Date.now() }));
  const s: UsageSession = { id: Math.random().toString(36).slice(2, 10), participant: participant.trim() || 'sin código', start: Date.now(), events: [] };
  save([...list, s]);
  return s;
}

export function stopSession() {
  save(load().map((s) => (s.end ? s : { ...s, end: Date.now() })));
}

export function deleteSession(id: string) {
  save(load().filter((s) => s.id !== id));
}

/** Anota una acción en la sesión activa (si la hay). */
export function logEvent(type: string, detail?: string) {
  const list = load();
  const s = list.find((x) => !x.end);
  if (!s) return;
  s.events.push({ t: Date.now() - s.start, type, ...(detail ? { detail } : {}) });
  save(list);
}

export function summarize(s: UsageSession) {
  const count = (t: string) => s.events.filter((e) => e.type === t).length;
  return {
    duration: ((s.end ?? Date.now()) - s.start) / 1000,
    actions: s.events.length,
    undo: count('deshacer'),
    views: count('vista'),
    added: s.events.filter((e) => e.type === 'añadir').reduce((a, e) => a + (parseInt(e.detail ?? '1') || 1), 0),
    layouts: count('montaje'),
    warnings: count('aviso de seguridad'),
    exports: count('exportar'),
  };
}

export function sessionsCsv(list: UsageSession[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = list.flatMap((s) => s.events.map((e) => [s.participant, s.id, new Date(s.start).toISOString(), (e.t / 1000).toFixed(1), e.type, e.detail ?? ''].map(esc).join(';')));
  return '﻿' + ['participante;sesion;inicio;segundo;accion;detalle', ...rows].join('\n');
}

/**
 * Observa el estado de la app y anota las acciones del participante. Se llama una vez al
 * arrancar; solo registra cuando hay una sesión de prueba activa.
 */
export function attachUsageLog<S extends { project: Project | null; view: string; tool: string; placingType: string | null; clientMode: boolean; panel: string; past: unknown[]; future: unknown[] }>(
  store: UseBoundStore<StoreApi<S>>,
) {
  let lastErrors = 0;
  return store.subscribe((s, prev) => {
    if (!activeSession()) return;
    if (s.project?.id !== prev.project?.id) logEvent(s.project ? 'abrir proyecto' : 'cerrar proyecto', s.project?.name);
    if (s.view !== prev.view) logEvent('vista', s.view);
    if (s.panel !== prev.panel) logEvent('panel', s.panel);
    if (s.clientMode !== prev.clientMode) logEvent(s.clientMode ? 'vista cliente' : 'salir vista cliente');
    if (s.tool !== prev.tool || s.placingType !== prev.placingType) logEvent('herramienta', s.tool === 'place' ? `colocar ${s.placingType ?? ''}` : s.tool);
    // Deshacer / rehacer: el historial pasa de un lado a otro
    if (s.past.length < prev.past.length && s.future.length > prev.future.length) logEvent('deshacer');
    else if (s.future.length < prev.future.length && s.past.length > prev.past.length) logEvent('rehacer');
    const p = s.project;
    const q = prev.project;
    if (p && q && p.id === q.id) {
      if (p.event.layout !== q.event.layout && p.event.layout) logEvent('montaje', p.event.layout);
      const diff = p.items.length - q.items.length;
      if (diff > 0) logEvent('añadir', String(diff));
      if (diff < 0) logEvent('eliminar', String(-diff));
      if (p.activeVariant !== q.activeVariant) logEvent('cambiar propuesta');
      if (p.lighting !== q.lighting) logEvent('iluminación', p.lighting);
      if (p.items !== q.items) {
        const errors = analyze(p).checks.filter((c) => c.severity !== 'ok').length;
        if (errors > lastErrors) logEvent('aviso de seguridad', String(errors));
        lastErrors = errors;
      }
    }
  });
}

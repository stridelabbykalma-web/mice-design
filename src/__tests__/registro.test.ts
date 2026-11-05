import { beforeEach, describe, expect, it } from 'vitest';
import { activeSession, attachUsageLog, listSessions, logEvent, sessionsCsv, startSession, stopSession, summarize } from '../lib/usageLog';
import { useStore } from '../store';
import { item, project, space } from './helpers';

// localStorage mínimo para el entorno de pruebas (Node)
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
(globalThis as unknown as { window: unknown }).window = { setTimeout: () => 0, clearTimeout: () => undefined, dispatchEvent: () => true };

describe('registro de uso en las pruebas con usuarios', () => {
  beforeEach(() => mem.clear());

  it('solo registra con una sesión activa', () => {
    logEvent('vista', 'planta');
    expect(listSessions()).toHaveLength(0);
    startSession('P01');
    logEvent('vista', 'planta');
    stopSession();
    logEvent('vista', '3d');
    const [s] = listSessions();
    expect(s.participant).toBe('P01');
    expect(s.events.map((e) => e.detail)).toEqual(['planta']);
    expect(activeSession()).toBeUndefined();
  });

  it('anota las acciones a partir de los cambios de la app', () => {
    const stop = attachUsageLog(useStore);
    startSession('P02');
    const st = useStore.getState();
    st.openProject(project(space(12, 8)));
    st.setView('planta');
    st.addItem({ type: 'mesa-redonda-180', x: 0, z: 0, rot: 0, chairs: 10 });
    st.undo();
    st.setClientMode(true);
    stop();
    stopSession();
    const s = listSessions()[0];
    const types = s.events.map((e) => e.type);
    expect(types).toContain('abrir proyecto');
    expect(types).toContain('vista');
    expect(types).toContain('añadir');
    expect(types).toContain('deshacer');
    expect(types).toContain('vista cliente');
    const sum = summarize(s);
    expect(sum.undo).toBe(1);
    expect(sum.added).toBe(1);
    expect(sessionsCsv([s]).split('\n')[0]).toContain('participante;sesion;inicio;segundo;accion;detalle');
  });

  it('cuenta los avisos de seguridad que aparecen', () => {
    const stop = attachUsageLog(useStore);
    startSession('P03');
    useStore.getState().openProject(project(space(6, 6), [item('puerta', 0, 2.94, { rot: 180 })]));
    useStore.getState().addItem({ type: 'mesa-redonda-180', x: 0, z: 1.8, rot: 0, chairs: 10 }); // tapa la puerta
    stop();
    stopSession();
    expect(summarize(listSessions()[0]).warnings).toBeGreaterThan(0);
  });
});

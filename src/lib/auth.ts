// Inicio de sesión por hotel (Supabase Auth, por REST, sin dependencias).
//  · Personas: correo y contraseña. Cada hotel tiene sus propios proyectos, salas y catálogo.
//  · Gafas y móviles: código de un solo uso que da una persona del hotel (sesión anónima
//    unida al hotel), para no tener que escribir contraseñas con las gafas puestas.
// Cada hotel guarda sus datos locales en una base de datos propia del navegador
// (ver `db.ts`), así que al cambiar de hotel o cerrar sesión no se mezclan proyectos.

import { create } from 'zustand';
import { CLOUD, cloudReady } from './cloud';

export type Role = 'admin' | 'editor' | 'viewer';

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Segundos desde 1970. */
  expires_at: number;
  user: { id: string; email?: string; is_anonymous?: boolean };
}

export interface Hotel {
  id: string;
  name: string;
  role: Role;
}

export interface Member {
  user_id: string;
  role: Role;
  label: string | null;
  created_at: string;
  is_me: boolean;
}

const K_SESSION = 'mice-auth';
const K_HOTEL = 'mice-hotel';
const K_OFFLINE = 'mice-offline';
/** Proyecto que hay que abrir nada más entrar (código de gafas con proyecto). */
export const K_OPEN = 'mice-open-project';

export const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* almacenamiento no disponible */
    }
  },
};

function readJson<T>(k: string): T | null {
  try {
    return JSON.parse(ls.get(k) ?? '') as T;
  } catch {
    return null;
  }
}

interface AuthState {
  session: Session | null;
  hotel: Hotel | null;
  hotels: Hotel[];
  /** Se ha elegido trabajar sin cuenta (solo en este dispositivo). */
  offline: boolean;
}

export const useAuth = create<AuthState>(() => ({
  session: readJson<Session>(K_SESSION),
  hotel: readJson<Hotel>(K_HOTEL),
  hotels: [],
  offline: ls.get(K_OFFLINE) === '1',
}));

/** Identificador del hotel cuyos datos locales se usan (lo lee `db.ts` al abrir la base de datos). */
export function currentHotelId(): string | null {
  return readJson<Hotel>(K_HOTEL)?.id ?? null;
}

export const isViewer = () => useAuth.getState().hotel?.role === 'viewer';
export const canEdit = () => !isViewer();

/** Hace falta mostrar la pantalla de inicio de sesión. */
export function needsLogin() {
  const s = useAuth.getState();
  return cloudReady() && !s.offline && (!s.session || !s.hotel);
}

function saveSession(s: Session | null) {
  ls.set(K_SESSION, s ? JSON.stringify(s) : null);
  useAuth.setState({ session: s });
}

function errorText(body: unknown, status: number): string {
  const b = body as { msg?: string; message?: string; error_description?: string; error?: string; code?: string | number } | null;
  const raw = b?.message || b?.msg || b?.error_description || b?.error || `Error ${status}`;
  const known: [RegExp, string][] = [
    [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
    [/email not confirmed/i, 'Confirma el correo con el enlace que te hemos enviado y vuelve a entrar.'],
    [/user already registered/i, 'Ya existe una cuenta con ese correo: entra con tu contraseña.'],
    [/password should be at least/i, 'La contraseña debe tener al menos 6 caracteres.'],
    [/anonymous sign-ins are disabled/i, 'El servidor no admite todavía el acceso con código (activa «Allow anonymous sign-ins» en Supabase).'],
    [/rate limit/i, 'Demasiados intentos. Espera un minuto y vuelve a probar.'],
    [/invalid.*email|unable to validate email/i, 'El correo no es válido.'],
  ];
  return known.find(([r]) => r.test(raw))?.[1] ?? raw;
}

async function authCall(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${CLOUD.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: CLOUD.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorText(data, res.status));
  return (data ?? {}) as Record<string, unknown>;
}

function toSession(d: Record<string, unknown>): Session | null {
  if (!d.access_token) return null;
  const expiresIn = Number(d.expires_in ?? 3600);
  return {
    access_token: String(d.access_token),
    refresh_token: String(d.refresh_token),
    expires_at: Number(d.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn),
    user: d.user as Session['user'],
  };
}

let refreshing: Promise<string | null> | null = null;

/** Token de acceso válido (lo renueva si está a punto de caducar). */
export async function accessToken(): Promise<string | null> {
  const s = useAuth.getState().session;
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  refreshing ??= authCall('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    .then((d) => {
      const n = toSession(d);
      saveSession(n);
      return n?.access_token ?? null;
    })
    .catch((e: Error) => {
      // Sesión revocada o caducada: hay que volver a entrar
      if (/refresh token|invalid|not found|revoked/i.test(e.message)) signOut(false);
      return null;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const t = await accessToken();
  if (!t) throw new Error('La sesión ha caducado: vuelve a entrar.');
  return { apikey: CLOUD.key, Authorization: `Bearer ${t}`, ...extra };
}

/** Llamada a una función de la base de datos con la sesión del usuario. */
export async function authRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* texto plano */
    }
    throw new Error(msg || `Error ${res.status} del servidor`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function signIn(email: string, password: string) {
  const s = toSession(await authCall('token?grant_type=password', { email: email.trim(), password }));
  if (!s) throw new Error('No se ha podido iniciar sesión.');
  saveSession(s);
  await loadHotels();
}

/** Crea la cuenta. Devuelve false si hay que confirmar el correo antes de entrar. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const d = await authCall('signup', { email: email.trim(), password });
  const s = toSession(d);
  if (!s) return false;
  saveSession(s);
  return true;
}

export async function recoverPassword(email: string) {
  await authCall('recover', { email: email.trim() });
}

/** Gafas o móvil: entra con un código de un solo uso, sin cuenta propia. */
export async function signInWithCode(code: string) {
  const created = !useAuth.getState().session;
  if (created) {
    const s = toSession(await authCall('signup', { data: { device: navigator.userAgent.slice(0, 80) } }));
    if (!s) throw new Error('No se ha podido emparejar el dispositivo.');
    saveSession(s);
  }
  try {
    await joinWithCode(code);
  } catch (e) {
    // Código erróneo: no se deja una sesión anónima a medias
    if (created) saveSession(null);
    throw e;
  }
}

export async function joinWithCode(code: string) {
  const r = await authRpc<{ hotel_id: string; name: string; role: Role; project_id: string | null }>('join_code', { p_code: code });
  if (r.project_id) ls.set(K_OPEN, r.project_id);
  await loadHotels();
  selectHotel({ id: r.hotel_id, name: r.name, role: r.role });
}

export async function loadHotels(): Promise<Hotel[]> {
  const hotels = (await authRpc<Hotel[]>('my_hotels', {})) ?? [];
  useAuth.setState({ hotels });
  const cur = useAuth.getState().hotel;
  if (cur) {
    const fresh = hotels.find((h) => h.id === cur.id);
    // Ya no pertenece a ese hotel, o le han cambiado el rol
    if (!fresh) selectHotel(null);
    else if (fresh.role !== cur.role || fresh.name !== cur.name) {
      ls.set(K_HOTEL, JSON.stringify(fresh));
      useAuth.setState({ hotel: fresh });
    }
  } else if (hotels.length === 1) selectHotel(hotels[0]);
  return hotels;
}

export async function createHotel(name: string) {
  const id = await authRpc<string>('create_hotel', { p_name: name });
  selectHotel({ id, name: name.trim(), role: 'admin' });
}

/** Cambia de hotel. Los datos locales son de otra base de datos, así que se recarga la app. */
export function selectHotel(h: Hotel | null) {
  const prev = useAuth.getState().hotel?.id ?? null;
  ls.set(K_HOTEL, h ? JSON.stringify(h) : null);
  useAuth.setState({ hotel: h });
  if ((h?.id ?? null) !== prev && prev !== null) reloadApp();
  else if (h && prev === null) reloadApp();
}

export function workOffline(on: boolean) {
  ls.set(K_OFFLINE, on ? '1' : null);
  useAuth.setState({ offline: on });
}

export async function signOut(remote = true) {
  const s = useAuth.getState().session;
  if (remote && s) authCall('logout', {}, s.access_token).catch(() => undefined);
  saveSession(null);
  const had = useAuth.getState().hotel;
  ls.set(K_HOTEL, null);
  useAuth.setState({ hotel: null, hotels: [] });
  if (had) reloadApp();
}

export const createCode = (role: Role, opts: { project?: string; label?: string; minutes?: number } = {}) =>
  authRpc<string>('create_code', {
    p_hotel: useAuth.getState().hotel!.id,
    p_role: role,
    p_project: opts.project ?? null,
    p_label: opts.label ?? null,
    p_minutes: opts.minutes ?? 30,
  });

export const listMembers = () => authRpc<Member[]>('hotel_members_list', { p_hotel: useAuth.getState().hotel!.id });
export const removeMember = (user: string) => authRpc<null>('hotel_remove_member', { p_hotel: useAuth.getState().hotel!.id, p_user: user });

/** Código con guion para leerlo mejor: ABCD-EFGH. */
export const prettyCode = (c: string) => c.replace(/^(.{4})(.{4})$/, '$1-$2');

/** Enlace que empareja el dispositivo al abrirlo (QR para el móvil). */
export function codeLink(code: string) {
  const real = /^https?:/.test(location.protocol) && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('localhost');
  return `${real ? location.origin + location.pathname : 'https://stridelabbykalma-web.github.io/mice-design/'}#c-${code}`;
}

export function codeFromHash(): string | null {
  const m = location.hash.match(/^#c-([A-Z0-9]{8})$/i);
  return m ? m[1].toUpperCase() : null;
}

function reloadApp() {
  // En las pruebas se puede desactivar para no perder el estado de la página
  if ((window as unknown as { __noReload?: boolean }).__noReload) return;
  location.replace(location.pathname + location.search);
}

/** Al arrancar: comprueba la sesión y los hoteles (sin bloquear la app si no hay conexión). */
export function startAuth() {
  if (!cloudReady() || !useAuth.getState().session) return;
  loadHotels().catch(() => undefined);
}

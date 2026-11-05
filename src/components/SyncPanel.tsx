// Cuentas de hotel: inicio de sesión, emparejar gafas y móviles con código, miembros del
// equipo y estado de la sincronización.

import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { cloudReady } from '../lib/cloud';
import {
  type Member,
  type Role,
  K_OPEN,
  codeFromHash,
  codeLink,
  createCode,
  createHotel,
  joinWithCode,
  listMembers,
  loadHotels,
  ls,
  prettyCode,
  recoverPassword,
  removeMember,
  selectHotel,
  signIn,
  signInWithCode,
  signOut,
  signUp,
  useAuth,
  workOffline,
} from '../lib/auth';
import { copyLocalWithoutAccount, countLocalWithoutAccount, db } from '../lib/db';
import { acceptRemote, syncNow, useSync } from '../lib/sync';
import { useStore } from '../store';
import { ConfirmButton, Field } from './ui';

function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const src = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createDataURL(5, 2);
  }, [text]);
  return <img className="qr" src={src} alt="Código QR para emparejar el dispositivo" width={size} height={size} />;
}

const ago = (t: number | null) => {
  if (!t) return 'todavía no';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
};

const ROLE: Record<Role, string> = { admin: 'Administrador', editor: 'Diseña y edita', viewer: 'Solo ver (gafas, pantallas)' };

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return { busy, err, setErr, run };
}

/** Pantalla de entrada cuando hay servidor: cuenta del hotel, código de dispositivo o sin cuenta. */
export function AuthScreen() {
  const session = useAuth((s) => s.session);
  const hashCode = useMemo(codeFromHash, []);
  const [tab, setTab] = useState<'entrar' | 'crear' | 'codigo'>(hashCode ? 'codigo' : 'entrar');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState(hashCode ?? '');
  const [info, setInfo] = useState('');
  const { busy, err, setErr, run } = useBusy();

  if (session) return <HotelPicker />;

  const clearHash = () => location.hash.startsWith('#c-') && history.replaceState(null, '', location.pathname + location.search);

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="logo">◆</span> MICE Design
        </div>
        <p className="muted">Diseña el evento en el ordenador y míralo en directo en la sala con las gafas.</p>
        <div className="seg auth-tabs" role="tablist">
          {(
            [
              ['entrar', 'Entrar'],
              ['crear', 'Crear cuenta'],
              ['codigo', 'Gafas o móvil'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'active' : ''}
              onClick={() => {
                setTab(k);
                setErr('');
                setInfo('');
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {tab !== 'codigo' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (tab === 'entrar') await signIn(email, pw);
                else if (!(await signUp(email, pw))) setInfo('Te hemos enviado un correo para confirmar la cuenta. Ábrelo y vuelve aquí para entrar.');
              });
            }}
          >
            <Field label="Correo">
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Contraseña" hint={tab === 'crear' ? 'Al menos 6 caracteres.' : undefined}>
              <input type="password" autoComplete={tab === 'crear' ? 'new-password' : 'current-password'} required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <button className="btn primary wide" disabled={busy}>
              {busy ? 'Un momento…' : tab === 'entrar' ? 'Entrar' : 'Crear cuenta'}
            </button>
            {tab === 'entrar' && (
              <button
                type="button"
                className="link"
                onClick={() =>
                  email ? run(async () => (await recoverPassword(email), setInfo('Te hemos enviado un correo para cambiar la contraseña.'))) : setErr('Escribe primero tu correo.')
                }
              >
                ¿Has olvidado la contraseña?
              </button>
            )}
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await signInWithCode(code);
                clearHash();
              });
            }}
          >
            <p>
              En el ordenador, dentro del proyecto, pulsa <strong>«🥽 Ver en gafas»</strong> (o en la pantalla de inicio, «Emparejar gafas o móvil») y escribe aquí el código.
            </p>
            <input
              className="code-input"
              aria-label="Código de emparejamiento"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABCD-EFGH"
              maxLength={9}
              value={prettyCode(code)}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            />
            <button className="btn primary wide big" disabled={busy || code.length !== 8}>
              {busy ? 'Emparejando…' : 'Entrar con el código'}
            </button>
          </form>
        )}
        {err && <p className="error">{err}</p>}
        {info && <p className="hint">{info}</p>}
        <button
          className="link muted"
          onClick={() => {
            clearHash();
            workOffline(true);
          }}
        >
          Seguir sin cuenta (los proyectos se quedan solo en este dispositivo)
        </button>
      </div>
    </div>
  );
}

/** Con la sesión iniciada pero sin hotel elegido: elegir, crear o unirse con invitación. */
function HotelPicker() {
  const { hotels, session } = useAuth();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { busy, err, run } = useBusy();
  useEffect(() => {
    run(loadHotels).finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const anon = session?.user.is_anonymous;

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="logo">◆</span> MICE Design
        </div>
        <p className="muted">{anon ? 'Dispositivo emparejado' : session?.user.email}</p>
        {hotels.length > 0 && (
          <>
            <h3>Elige el hotel</h3>
            <div className="hotel-list">
              {hotels.map((h) => (
                <button key={h.id} className="btn wide" onClick={() => selectHotel(h)}>
                  <strong>{h.name}</strong> <span className="muted">· {ROLE[h.role]}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {loaded && !anon && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createHotel(name));
            }}
          >
            <h3>{hotels.length ? 'O da de alta otro hotel' : 'Da de alta tu hotel'}</h3>
            <div className="row gap">
              <input required placeholder="Nombre del hotel" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary" disabled={busy || !name.trim()}>
                Crear
              </button>
            </div>
          </form>
        )}
        {loaded && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => joinWithCode(code));
            }}
          >
            <h3>¿Te han invitado?</h3>
            <div className="row gap">
              <input placeholder="Código de invitación" value={prettyCode(code)} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} />
              <button className="btn" disabled={busy || code.length !== 8}>
                Unirme
              </button>
            </div>
          </form>
        )}
        {err && <p className="error">{err}</p>}
        <button className="link muted" onClick={() => signOut()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

/** Código para emparejar unas gafas o un móvil (y, si se indica, abrir directamente un proyecto). */
export function DeviceCodeModal({ project, onClose }: { project?: { id: string; name: string }; onClose: () => void }) {
  const [role, setRole] = useState<Role>(project ? 'viewer' : 'editor');
  const [code, setCode] = useState('');
  const { busy, err, run } = useBusy();
  const make = (r: Role) =>
    run(async () => {
      setCode('');
      setCode(await createCode(r, { project: project?.id, label: r === 'viewer' ? 'Gafas' : 'Móvil', minutes: 30 }));
    });
  useEffect(() => {
    make(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return (
    <div className="order-overlay" role="dialog" aria-label="Emparejar gafas o móvil">
      <div className="order-actions">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <article className="compare-sheet ar-sheet">
        <h1>{project ? 'Ver este proyecto en las gafas' : 'Emparejar gafas o móvil'}</h1>
        <div className="seg">
          <button className={role === 'viewer' ? 'active' : ''} onClick={() => setRole('viewer')}>
            🥽 Gafas (solo ver, en directo)
          </button>
          <button className={role === 'editor' ? 'active' : ''} onClick={() => setRole('editor')}>
            📱 Móvil (fotos y cambios)
          </button>
        </div>
        {code ? (
          <div className="device-code">
            <div className="device-code-text" aria-label="Código">
              {prettyCode(code)}
            </div>
            {role === 'editor' && <Qr text={codeLink(code)} size={170} />}
          </div>
        ) : (
          <p className="muted">{busy ? 'Generando el código…' : ''}</p>
        )}
        {role === 'viewer' ? (
          <ol className="ar-steps">
            <li>
              Con las gafas puestas, abre el navegador y entra en <strong>stridelabbykalma-web.github.io/mice-design</strong> (guárdala en favoritos para la próxima vez).
            </li>
            <li>
              Pulsa <strong>«Gafas o móvil»</strong>, escribe el código y pulsa «Entrar con el código».
            </li>
            <li>{project ? `Se abre «${project.name}».` : 'Abre el proyecto.'} Pulsa «🥽 Gafas» → «Realidad mixta» y marca las dos esquinas del frente de la sala.</li>
            <li>Lo que cambies aquí en el ordenador aparece en las gafas en un par de segundos, sin salir.</li>
          </ol>
        ) : (
          <ol className="ar-steps">
            <li>Escanea el QR con la cámara del móvil (o escribe el código en «Gafas o móvil»).</li>
            <li>El móvil queda unido al hotel: lo que hagas allí (por ejemplo, las fotos de las paredes) aparece aquí.</li>
          </ol>
        )}
        <p className="hint">El código sirve una sola vez y caduca en 30 minutos. Las gafas se quedan emparejadas: la próxima vez entran directamente.</p>
        {err && <p className="error">{err}</p>}
        {code && (
          <button className="btn small" onClick={() => make(role)} disabled={busy}>
            Otro código
          </button>
        )}
      </article>
    </div>
  );
}

/** Pantalla de inicio: hotel, sincronización, dispositivos y equipo. */
export function SyncSection() {
  const { session, hotel, hotels, offline } = useAuth();
  const { status, message, last } = useSync();
  const [pair, setPair] = useState(false);
  const [team, setTeam] = useState(false);
  const [local, setLocal] = useState(0);
  const [msg, setMsg] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (hotel && hotel.role !== 'viewer') countLocalWithoutAccount().then(setLocal);
  }, [hotel]);

  if (!cloudReady())
    return (
      <>
        <h2>Cuenta del hotel</h2>
        <p className="muted">Disponible cuando se configure el servidor (Supabase) en la app. Mientras tanto, los proyectos se guardan en este dispositivo.</p>
      </>
    );

  if (!session || !hotel)
    return (
      <>
        <h2>Cuenta del hotel</h2>
        <div className="card sync-card">
          <p>Sin cuenta, los proyectos se quedan solo en este dispositivo. Con la cuenta del hotel los tienes en el ordenador, el móvil y las gafas, y los ves en directo.</p>
          {offline && (
            <button className="btn primary" onClick={() => workOffline(false)}>
              Entrar o crear la cuenta del hotel
            </button>
          )}
        </div>
      </>
    );

  const viewer = hotel.role === 'viewer';
  return (
    <>
      <h2>{hotel.name}</h2>
      <div className="card sync-card linked">
        <div className="sync-info">
          <p>
            {session.user.is_anonymous ? 'Dispositivo emparejado' : session.user.email} · {ROLE[hotel.role]}
          </p>
          <p className={`sync-status ${status}`}>
            {status === 'syncing' ? 'Sincronizando…' : status === 'error' ? `Error: ${message}` : `Sincronizado ${ago(last)}`}
          </p>
          <div className="row gap wrap">
            {!viewer && (
              <button className="btn primary small" onClick={() => setPair(true)}>
                🥽 Emparejar gafas o móvil
              </button>
            )}
            <button className="btn small" onClick={() => setTeam(!team)}>
              Equipo
            </button>
            <button className="btn small" onClick={() => syncNow()}>
              Sincronizar ahora
            </button>
            {hotels.length > 1 && (
              <select className="btn small" value={hotel.id} onChange={(e) => selectHotel(hotels.find((h) => h.id === e.target.value) ?? null)} aria-label="Cambiar de hotel">
                {hotels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            )}
            <ConfirmButton className="btn small" title="Cerrar sesión en este dispositivo (los proyectos siguen en la nube)" onConfirm={() => signOut()}>
              Cerrar sesión
            </ConfirmButton>
          </div>
          {local > 0 && (
            <p className="hint">
              En este navegador hay {local} proyectos o elementos del catálogo guardados sin cuenta.{' '}
              <button
                className="link"
                onClick={async () => {
                  const n = await copyLocalWithoutAccount();
                  setLocal(0);
                  setMsg(`${n} copiados a ${hotel.name}.`);
                  syncNow();
                }}
              >
                Pasarlos a {hotel.name}
              </button>
            </p>
          )}
          {msg && <p className="hint">{msg}</p>}
        </div>
      </div>
      {team && <Team />}
      {pair && <DeviceCodeModal onClose={() => setPair(false)} />}
    </>
  );
}

function Team() {
  const hotel = useAuth((s) => s.hotel)!;
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<Role>('editor');
  const [code, setCode] = useState('');
  const { busy, err, run } = useBusy();
  const reload = () => run(async () => setMembers((await listMembers()) ?? []));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const admin = hotel.role === 'admin';
  return (
    <div className="card">
      <h3>Equipo de {hotel.name}</h3>
      <ul className="member-list">
        {members.map((mb) => (
          <li key={mb.user_id}>
            <span>
              {mb.label || (mb.role === 'viewer' ? 'Gafas' : 'Dispositivo')}
              {mb.is_me ? ' (tú)' : ''}
            </span>
            <span className="muted">{ROLE[mb.role]}</span>
            {(admin || mb.is_me) && (
              <ConfirmButton
                title={mb.is_me ? 'Salir de este hotel' : 'Quitar del hotel'}
                onConfirm={() =>
                  run(async () => {
                    await removeMember(mb.user_id);
                    if (mb.is_me) selectHotel(null);
                    else reload();
                  })
                }
              >
                ✕
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      {hotel.role !== 'viewer' && (
        <>
          <h4>Invitar a una persona</h4>
          <div className="row gap wrap">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Permisos">
              {admin && <option value="admin">{ROLE.admin}</option>}
              <option value="editor">{ROLE.editor}</option>
              <option value="viewer">Solo ver</option>
            </select>
            <button className="btn small" disabled={busy} onClick={() => run(async () => setCode(await createCode(role, { minutes: 7 * 24 * 60 })))}>
              Crear invitación
            </button>
          </div>
          {code && (
            <p className="hint">
              Código <strong className="invite-code">{prettyCode(code)}</strong> (válido 7 días, un solo uso). La persona crea su cuenta con su correo y lo escribe en «¿Te han
              invitado?».
            </p>
          )}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/** Abre el proyecto que venía en el código de las gafas en cuanto llega de la nube. */
export function usePendingOpen(onOpen: (id: string) => void) {
  const last = useSync((s) => s.last);
  useEffect(() => {
    const id = ls.get(K_OPEN);
    if (!id) return;
    db.getProject(id).then((p) => {
      if (!p) return;
      ls.set(K_OPEN, null);
      onOpen(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);
}

/** Barra del editor: estado, botón «Ver en gafas» y aviso si el proyecto cambió en otro dispositivo. */
export function SyncIndicator() {
  const { ws, status, conflict } = useSync();
  const hotel = useAuth((s) => s.hotel);
  const project = useStore((s) => s.project);
  const readOnly = useStore((s) => s.readOnly);
  const [pair, setPair] = useState(false);
  if (!ws || !hotel || readOnly || !cloudReady()) return null;
  return (
    <>
      <button className={`icon-btn sync-dot ${status}`} title={status === 'error' ? 'Error al sincronizar: pulsa para reintentar' : `Sincronizado con ${hotel.name}`} onClick={() => syncNow()}>
        {status === 'syncing' ? '⟳' : status === 'error' ? '⚠' : '☁'}
      </button>
      <button className="btn hide-sm" onClick={() => setPair(true)} title="Emparejar unas gafas y ver este proyecto en directo">
        🥽 Ver en gafas
      </button>
      {pair && project && <DeviceCodeModal project={{ id: project.id, name: project.name }} onClose={() => setPair(false)} />}
      {conflict && (
        <div className="sync-conflict">
          Este proyecto se ha cambiado en otro dispositivo y aquí también hay cambios.
          <button className="link" onClick={() => acceptRemote()}>
            Cargar los del otro dispositivo
          </button>
          <button
            className="link"
            onClick={() => {
              useSync.setState({ conflict: false });
              useStore.getState().patchProject({});
            }}
          >
            Mantener los míos
          </button>
        </div>
      )}
    </>
  );
}

/** Gafas: indicador «En directo» en la vista del proyecto. */
export function LiveBadge() {
  const { ws, status, last } = useSync();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  if (!ws) return null;
  const live = status !== 'error' && !!last && Date.now() - last < 10000;
  return (
    <span className={`live-badge ${live ? 'on' : ''}`} title={live ? 'Los cambios del ordenador aparecen aquí al momento' : 'Sin conexión con el servidor'}>
      ● {live ? 'En directo' : 'Sin conexión'}
    </span>
  );
}

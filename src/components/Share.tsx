import { useEffect, useRef, useState } from 'react';
import { syncedVariants, useStore } from '../store';
import { ShareComment, addComment, cloudReady, listComments, publishShare, setResolved, shareLink } from '../lib/cloud';
import { Toggle } from './ui';

/** Muestra en el plano los comentarios de un enlace (numerados). */
function showPins(shareId: string, list: ShareComment[]) {
  void shareId;
  // Solo las marcas: el identificador del enlace es para la vista del cliente
  useStore.getState().setCloud({
    comments: list.map((c, i) => ({ id: c.id, n: i + 1, x: c.x ?? NaN, z: c.z ?? NaN, resolved: c.resolved, author: c.author, body: c.body })),
  });
}

function CopyField({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="row gap copy-field">
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button
        className="btn small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          } catch {
            /* el usuario puede copiarlo a mano: el campo se selecciona al pulsar */
          }
        }}
      >
        {ok ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

/** Panel del hotel: crear enlaces para el cliente y leer sus comentarios. */
export function ShareModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const [includeGuests, setIncludeGuests] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const openRef = useRef<string | null>(null);
  openRef.current = open;
  const [comments, setComments] = useState<Record<string, ShareComment[]>>({});
  const shares = project.shares ?? [];

  const load = async (id: string) => {
    try {
      const list = await listComments(id);
      setComments((c) => ({ ...c, [id]: list }));
      if (openRef.current === id || (!openRef.current && id === shares[0]?.id)) showPins(id, list);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    shares.forEach((s) => load(s.id));
    // Las marcas se quedan en la escena al cerrar el panel (se quitan al cerrar el proyecto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setError('');
    try {
      const vs = syncedVariants(project);
      const id = await publishShare({ ...project, variants: project.variants ? vs : undefined }, { includeGuests }, setBusy);
      const entry = { id, createdAt: Date.now(), includeGuests, variant: vs.find((v) => v.id === project.activeVariant)?.name };
      useStore.getState().patchProject({ shares: [entry, ...shares] });
      setOpen(id);
    } catch (e) {
      setError(`No se pudo publicar: ${(e as Error).message}`);
    }
    setBusy('');
  };

  return (
    <div className="order-overlay">
      <div className="order-actions">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <article className="compare-sheet share-sheet">
        <h1>Compartir con el cliente</h1>
        {!cloudReady() ? (
          <p className="error">Falta configurar el servidor (Supabase): añade la Project URL en src/lib/cloud.ts.</p>
        ) : (
          <>
            <p className="muted">
              El cliente abre el enlace en su navegador o móvil, ve la propuesta en 3D, en plano y en recorrido (en su idioma), puede cambiar entre las propuestas y dejar
              comentarios señalando el punto del plano al que se refieren. Es una copia: los cambios que hagas después requieren crear un enlace nuevo.
            </p>
            <Toggle checked={includeGuests} onChange={setIncludeGuests} label="Incluir la lista de invitados (nombres y alergias son datos personales: compártelos solo con el organizador)" />
            <button className="btn primary" onClick={create} disabled={!!busy}>
              {busy || 'Crear enlace para el cliente'}
            </button>
          </>
        )}
        {error && <p className="error">{error}</p>}

        {shares.length > 0 && <h2>Enlaces enviados</h2>}
        <ul className="share-list">
          {shares.map((s) => {
            const list = comments[s.id];
            const pending = list?.filter((c) => !c.resolved).length ?? 0;
            return (
              <li key={s.id} className={open === s.id ? 'open' : ''}>
                <div className="share-head">
                  <div>
                    <strong>{new Date(s.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                    <span className="muted">
                      {s.variant ? ` · ${s.variant}` : ''}
                      {s.includeGuests ? ' · con invitados' : ''}
                    </span>
                  </div>
                  <button
                    className="btn small"
                    onClick={() => {
                      setOpen(open === s.id ? null : s.id);
                      if (list) showPins(s.id, list);
                    }}
                  >
                    {list ? `${list.length} comentarios${pending ? ` (${pending} sin resolver)` : ''}` : 'Comentarios'}
                  </button>
                </div>
                <CopyField value={shareLink(s.id)} />
                {open === s.id && (
                  <div className="comment-list">
                    {!list?.length && <p className="hint">Todavía no hay comentarios.</p>}
                    {list?.map((c, i) => (
                      <div key={c.id} className={`comment ${c.resolved ? 'resolved' : ''}`}>
                        <span className="comment-n">{i + 1}</span>
                        <div>
                          <strong>{c.author}</strong> <span className="muted">{new Date(c.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
                          {c.variant && <span className="badge">{c.variant}</span>}
                          <p>{c.body}</p>
                          {Number.isFinite(c.x) && <span className="hint">📍 Señalado en el plano (marca {i + 1})</span>}
                        </div>
                        <Toggle
                          checked={c.resolved}
                          label="Resuelto"
                          onChange={async (v) => {
                            await setResolved(c.id, s.id, v);
                            load(s.id);
                          }}
                        />
                      </div>
                    ))}
                    <button className="btn small" onClick={() => load(s.id)}>
                      Actualizar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {shares.length > 0 && <p className="hint">Al cerrar este panel, las marcas numeradas de los comentarios se quedan en la escena (se ven mejor en planta).</p>}
      </article>
    </div>
  );
}

/** Comentarios del cliente en la vista compartida (español o inglés). */
export function ClientComments() {
  const project = useStore((s) => s.project)!;
  const shareId = useStore((s) => s.shareId)!;
  const pendingPin = useStore((s) => s.pendingPin);
  const pinMode = useStore((s) => s.pinMode);
  const setCloud = useStore((s) => s.setCloud);
  const lang = project.event.language;
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  const [list, setList] = useState<ShareComment[]>([]);
  const [author, setAuthor] = useState(() => {
    try {
      return localStorage.getItem('mice-comment-author') ?? '';
    } catch {
      return '';
    }
  });
  const [body, setBody] = useState('');
  const [state, setState] = useState<'' | 'sending' | 'sent' | 'error'>('');
  const [open, setOpen] = useState(true);

  const refresh = async () => {
    try {
      const l = await listComments(shareId);
      setList(l);
      showPins(shareId, l);
    } catch {
      /* sin conexión: se mantiene la lista */
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  const send = async () => {
    if (!author.trim() || !body.trim()) return;
    setState('sending');
    try {
      const vs = syncedVariants(project);
      await addComment({
        share_id: shareId,
        author: author.trim().slice(0, 80),
        body: body.trim().slice(0, 2000),
        variant: vs.length > 1 ? vs.find((v) => v.id === project.activeVariant)?.name ?? null : null,
        x: pendingPin?.x ?? null,
        z: pendingPin?.z ?? null,
      });
      try {
        localStorage.setItem('mice-comment-author', author.trim());
      } catch {
        /* noop */
      }
      setBody('');
      setCloud({ pendingPin: null });
      setState('sent');
      refresh();
    } catch {
      setState('error');
    }
  };

  return (
    <div className={`client-comments ${open ? '' : 'closed'}`}>
      <button className="comments-toggle" onClick={() => setOpen(!open)}>
        💬 {L('Comentarios', 'Comments')} ({list.length}) {open ? '−' : '+'}
      </button>
      {open && (
        <div className="comments-body">
          <div className="comment-list">
            {list.map((c, i) => (
              <div key={c.id} className={`comment ${c.resolved ? 'resolved' : ''}`}>
                <span className="comment-n">{i + 1}</span>
                <div>
                  <strong>{c.author}</strong>
                  {c.resolved && <span className="badge">{L('resuelto', 'resolved')}</span>}
                  <p>{c.body}</p>
                </div>
              </div>
            ))}
          </div>
          <label className="field">
            <span className="field-label">{L('Tu nombre', 'Your name')}</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} onKeyDown={(e) => e.stopPropagation()} maxLength={80} />
          </label>
          <label className="field">
            <span className="field-label">{L('Comentario', 'Comment')}</span>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.stopPropagation()} maxLength={2000} />
          </label>
          <div className="row gap wrap">
            <button
              className={`btn small ${pinMode ? 'primary' : ''}`}
              onClick={() => {
                if (!pinMode && useStore.getState().view === 'paseo') useStore.getState().setView('planta');
                setCloud({ pinMode: !pinMode });
              }}
            >
              📍 {pendingPin ? L('Cambiar el punto', 'Move the pin') : L('Señalar en el plano', 'Pin on the plan')}
            </button>
            <button className="btn small primary" onClick={send} disabled={state === 'sending' || !author.trim() || !body.trim()}>
              {state === 'sending' ? L('Enviando…', 'Sending…') : L('Enviar comentario', 'Send comment')}
            </button>
          </div>
          {pinMode && <p className="hint">{L('Haz clic en el punto del plano al que se refiere tu comentario.', 'Click the point of the plan your comment refers to.')}</p>}
          {state === 'sent' && <p className="hint">{L('Comentario enviado al hotel.', 'Comment sent to the hotel.')}</p>}
          {state === 'error' && <p className="error">{L('No se pudo enviar. Comprueba la conexión e inténtalo de nuevo.', 'It could not be sent. Check your connection and try again.')}</p>}
        </div>
      )}
    </div>
  );
}

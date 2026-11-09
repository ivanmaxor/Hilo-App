import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { EFFORTS, MODELS, PALETTE } from '../../shared/defaults';
import { fuzzyMatch } from '../../shared/fuzzy';
import { eventToKeys, isModifierOnly, prettyKeys, shortcutProblem, SHORTCUTS } from '../../shared/shortcuts';
import { STATUS_LABEL, STATUS_PRIORITY } from '../../shared/statusMachine';
import { allSessions, findSession } from '../../shared/reducer';
import type { Modal } from '../controller';
import { moveToast } from './sidebar';
import type { SessionKind, Settings, StartupMode, TerminalColors, ThemeName, ToolCheck } from '../../shared/types';
import { RELEASES_URL, type UpdateStatus } from '../../shared/updates';
import { changesPaneId } from '../../shared/paneContent';
import type { DetectedIde } from '../../shared/ide';
import { api } from '../api';
import {
  addProjectFromFolder,
  app,
  confirmCloseSession,
  createSession,
  defaultSessionName,
  dispatch,
  dismissToast,
  focusActive,
  openInIde,
  selectSession,
  keysOf,
  toggleChanges,
  copyLastMessage,
  runCommand,
  sleepSession,
  startRename,
  statusOf,
  useStore,
  view,
  wakeSession,
} from '../controller';
import { CloseIcon, StatusIcon } from './icons';

const EFFORT_LABEL: Record<string, string> = {
  low: 'Bajo (low)',
  medium: 'Medio (medium)',
  high: 'Alto (high)',
  xhigh: 'Muy alto (xhigh)',
  max: 'Máximo (max)',
};

function closeModal(): void {
  view.set({ modal: null });
  focusActive();
}

function Backdrop({ children, onClose, labelledBy }: { children: ComponentChildren; onClose(): void; labelledBy: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // En la ventana: Esc tiene que funcionar aunque el foco no esté dentro del diálogo.
    const onKey = (e: KeyboardEvent) => {
      const root = dialog.current;
      if (!root) return;
      if (e.key === 'Escape') {
        if ((document.activeElement as HTMLElement | null)?.classList.contains('capturing')) return;
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // El foco no se escapa: detrás hay una terminal que recibiría lo que se escriba.
      const items = [...root.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (!current || !root.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      class="backdrop"
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        // Si no, el clic derecho caería sobre la terminal de detrás y pegaría ahí.
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div ref={dialog} class="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

export function Swatches({ value, onPick }: { value: string | null; onPick(color: string | null): void }) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Color">
      <button type="button" class={`swatch none${value === null ? ' on' : ''}`} role="radio" aria-checked={value === null} title="Sin color" onClick={() => onPick(null)} />
      {PALETTE.map((p) => (
        <button
          type="button"
          key={p.id}
          class={`swatch${value === p.hex ? ' on' : ''}`}
          role="radio"
          aria-checked={value === p.hex}
          title={p.label}
          aria-label={p.label}
          style={{ background: p.hex }}
          onClick={() => onPick(p.hex)}
        />
      ))}
    </div>
  );
}

function NewSessionDialog({ modal }: { modal: Extract<Modal, { type: 'newSession' }> }) {
  const { state } = useStore(app);
  const [kind, setKind] = useState<SessionKind>(modal.kind);
  const [projectId, setProjectId] = useState<string>(modal.projectId ?? state.projects[0]?.id ?? '');
  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const [name, setName] = useState(() => defaultSessionName(project, modal.kind));
  // En una ref: el efecto de abajo corre después del repintado y no debe pisar lo ya escrito.
  const touched = useRef(false);
  const [color, setColor] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  useEffect(() => {
    if (!touched.current) setName(defaultSessionName(project, kind));
  }, [projectId, kind]);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!project) return;
    const input: Parameters<typeof createSession>[0] = { projectId: project.id, kind, name: name.trim() || defaultSessionName(project, kind), color };
    if (kind === 'claude' && model.trim()) input.model = model.trim();
    if (kind === 'claude' && effort) input.effort = effort;
    view.set({ modal: null });
    void createSession(input);
  };

  return (
    <Backdrop onClose={closeModal} labelledBy="new-title">
      <form onSubmit={submit}>
        <h2 id="new-title">Nueva sesión</h2>
        <div class="seg" role="radiogroup" aria-label="Tipo de sesión">
          <button type="button" role="radio" aria-checked={kind === 'claude'} class={kind === 'claude' ? 'on' : ''} onClick={() => setKind('claude')}>
            Claude Code
          </button>
          <button type="button" role="radio" aria-checked={kind === 'shell'} class={kind === 'shell' ? 'on' : ''} onClick={() => setKind('shell')}>
            PowerShell
          </button>
        </div>
        <label class="field">
          <span>Proyecto</span>
          <div class="field-row">
            <select value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)}>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                void addProjectFromFolder().then((p) => {
                  if (p) setProjectId(p.id);
                })
              }
            >
              Otra carpeta
            </button>
          </div>
          {project && <small class="path">{project.path}</small>}
        </label>
        <label class="field">
          <span>Nombre</span>
          <input
            ref={nameRef}
            data-field="name"
            value={name}
            maxLength={80}
            onInput={(e) => {
              touched.current = true;
              setName(e.currentTarget.value);
            }}
          />
        </label>
        <div class="field">
          <span>Color</span>
          <Swatches value={color} onPick={setColor} />
        </div>
        {kind === 'claude' && (
          <div class="field-pair">
            <label class="field">
              <span>Modelo</span>
              <input data-field="model" list="models" value={model} placeholder="El de mi configuración" onInput={(e) => setModel(e.currentTarget.value)} />
              <datalist id="models">
                {MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label class="field">
              <span>Esfuerzo</span>
              <select data-field="effort" value={effort} onChange={(e) => setEffort(e.currentTarget.value)}>
                <option value="">El de mi configuración</option>
                {EFFORTS.map((m) => (
                  <option key={m} value={m}>
                    {EFFORT_LABEL[m] ?? m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div class="actions">
          <button type="button" onClick={closeModal}>
            Cancelar
          </button>
          <button type="submit" class="primary" disabled={!project}>
            Crear sesión
          </button>
        </div>
      </form>
    </Backdrop>
  );
}

function ConfirmDialog({ modal }: { modal: Extract<Modal, { type: 'confirm' }> }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const done = (ok: boolean) => {
    modal.resolve(ok);
    view.set({ modal: null });
  };
  return (
    <Backdrop onClose={() => done(false)} labelledBy="confirm-title">
      <h2 id="confirm-title">{modal.title}</h2>
      <p class="dialog-body">{modal.body}</p>
      {modal.list && (
        <ul class="proc-list">
          {modal.list.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div class="actions">
        <button ref={cancel} onClick={() => done(false)}>
          Cancelar
        </button>
        <button class={modal.danger ? 'danger' : 'primary'} data-confirm="ok" onClick={() => done(true)}>
          {modal.ok}
        </button>
      </div>
    </Backdrop>
  );
}

/** Qué IDE abre este proyecto. Se recuerda por proyecto, y la ruta del programa la decide el proceso principal. */
function IdeDialog({ modal }: { modal: Extract<Modal, { type: 'ide' }> }) {
  const { state } = useStore(app);
  const project = state.projects.find((p) => p.id === modal.projectId);
  const [found, setFound] = useState<DetectedIde[] | null>(null);
  const [problem, setProblem] = useState('');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void api.ideDetect().then(setFound, () => setFound([]));
  }, []);
  useEffect(() => first.current?.focus(), [found]);
  if (!project) return null;
  const done = () => {
    view.set({ modal: null });
    focusActive();
    // Se venía a abrir algo, y ahora ya hay con qué. Cambiar de IDE no abre nada.
    if (modal.file !== null || !project.ide) void openInIde(project.id, modal.file, modal.line);
  };
  const choose = (ide: DetectedIde) => {
    void api.ideChoose(project.id, ide.id).then((ok) => {
      if (ok) done();
      else setProblem('No se pudo guardar esa elección. Prueba otra vez.');
    });
  };
  const browse = () => {
    setProblem('');
    void api.idePick(project.id).then((r) => {
      if (r.ok) done();
      else if (r.message) setProblem(r.message);
    });
  };
  return (
    <Backdrop onClose={closeModal} labelledBy="ide-title">
      <h2 id="ide-title">¿Con qué abrir «{project.name}»?</h2>
      <p class="dialog-body">Hilo lo recordará para este proyecto. Se abre en su propia ventana.</p>
      {found === null && <p class="dialog-body">Buscando programas instalados…</p>}
      {found && found.length === 0 && <p class="dialog-body">No se encontró ninguno en las carpetas habituales. Puedes buscar el .exe a mano.</p>}
      {found && found.length > 0 && (
        <div class="ide-list">
          {found.map((ide, i) => (
            <button key={ide.id} ref={i === 0 ? first : undefined} class={`ide-item${project.ide?.path === ide.path ? ' on' : ''}`} data-ide={ide.name} title={ide.path} onClick={() => choose(ide)}>
              <span class="ide-name">{ide.name}</span>
              <span class="ide-path">{ide.path}</span>
            </button>
          ))}
        </div>
      )}
      {problem && (
        <p class="dialog-body warn" role="alert">
          {problem}
        </p>
      )}
      <div class="actions">
        <button onClick={closeModal}>Cancelar</button>
        <button data-action="pick-exe" onClick={browse}>
          Buscar otro programa…
        </button>
      </div>
    </Backdrop>
  );
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const marks = new Set(positions);
  const chars = Array.from(text);
  return (
    <>
      {chars.map((c, i) => (marks.has(i) ? <mark key={i}>{c}</mark> : c))}
    </>
  );
}

function QuickOpen() {
  const { state } = useStore(app);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const items = allSessions(state).filter((s) => !view.get().closing.includes(s.id)).map((s) => {
      const found = findSession(state, s.id)!;
      const match = fuzzyMatch(query, s.name);
      const projectMatch = match ? null : fuzzyMatch(query, found.project.name);
      return { s, project: found.project.name, match, score: match?.score ?? (projectMatch ? projectMatch.score - 2 : null) };
    });
    return items
      .filter((i) => i.score !== null)
      .sort((a, b) => {
        if (!query) return STATUS_PRIORITY[statusOf(a.s.id)] - STATUS_PRIORITY[statusOf(b.s.id)];
        return b.score! - a.score!;
      });
  }, [query, state]);

  const pick = (id: string) => {
    view.set({ modal: null });
    void selectSession(id);
  };
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('.quick-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [at, results]);

  return (
    <Backdrop onClose={closeModal} labelledBy="quick-label">
      <div class="quick">
        <span id="quick-label" class="sr-only">
          Saltar a una sesión
        </span>
        <input
          ref={input}
          value={query}
          placeholder="Saltar a una sesión"
          aria-label="Saltar a una sesión"
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAt((v) => Math.min(v + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAt((v) => Math.max(v - 1, 0));
            } else if (e.key === 'Enter' && results[at]) {
              e.preventDefault();
              pick(results[at]!.s.id);
            }
          }}
        />
        <div ref={list} class="quick-list" role="listbox">
          {results.map((r, i) => (
            <button key={r.s.id} role="option" aria-selected={i === at} class={`quick-item${i === at ? ' on' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => pick(r.s.id)}>
              <StatusIcon status={statusOf(r.s.id)} />
              <span class="name">
                <Highlight text={r.s.name} positions={r.match?.positions ?? []} />
              </span>
              <span class="sub">{r.project}</span>
              <span class="quick-status">{STATUS_LABEL[statusOf(r.s.id)]}</span>
            </button>
          ))}
          {results.length === 0 && <p class="quick-empty">{allSessions(state).length ? 'Ninguna sesión se llama así.' : 'Aún no hay sesiones.'}</p>}
        </div>
      </div>
    </Backdrop>
  );
}

/** Campo de ajustes: confirma al salir o con Enter. Un repintado no pisa lo que se está escribiendo. */
function DraftInput(props: {
  value: string | number;
  type?: 'number';
  min?: number;
  max?: number;
  step?: number;
  field?: string;
  placeholder?: string;
  onCommit(value: string): void;
}) {
  const { value, onCommit, field, ...rest } = props;
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    if (draft !== String(value)) onCommit(draft);
  };
  return (
    <input
      {...(rest as Record<string, unknown>)}
      data-field={field}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function ShortcutRow({ id, label, keys, note: outerNote, onSet }: { id: string; label: string; keys: string; note: string | undefined; onSet(id: string, keys: string | null): void }) {
  const [capturing, setCapturing] = useState(false);
  const [note, setNote] = useState('');
  const def = SHORTCUTS.find((s) => s.id === id)!;
  return (
    <div class="shortcut">
      <span class="shortcut-label">{label}</span>
      {(note || outerNote) && <span class="shortcut-note">{note || outerNote}</span>}
      <button
        type="button"
        class={`keycap${capturing ? ' capturing' : ''}`}
        onClick={() => {
          setCapturing(true);
          setNote('');
        }}
        onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          if (e.key !== 'Tab') {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === 'Escape') {
            setCapturing(false);
            setNote('');
            return;
          }
          if (e.key === 'Tab') {
            setCapturing(false);
            setNote('');
            return;
          }
          if (isModifierOnly(e)) return;
          const combo = eventToKeys(e);
          const problem = shortcutProblem(combo);
          if (problem) {
            setNote(problem);
            return;
          }
          setNote('');
          setCapturing(false);
          onSet(id, combo);
        }}
      >
        {capturing ? 'Pulsa la combinación' : prettyKeys(keys)}
      </button>
      {keys !== def.defaultKeys && (
        <button type="button" class="link" onClick={() => onSet(id, null)}>
          Restaurar
        </button>
      )}
    </div>
  );
}

const SETTINGS_SECTIONS = [
  ['look', 'Apariencia'],
  ['terminal', 'Terminal'],
  ['sessions', 'Sesiones'],
  ['claude', 'Claude Code'],
  ['updates', 'Actualizaciones'],
  ['changes', 'Cambios'],
  ['shortcuts', 'Atajos'],
] as const;

function updateMessage(status: UpdateStatus): string {
  switch (status.state) {
    case 'off':
      return 'Esta copia es de desarrollo o de pruebas: no se conecta a nada.';
    case 'idle':
      return 'Todavía no se buscó desde que abriste Hilo.';
    case 'checking':
      return 'Buscando…';
    case 'current':
      return 'Estás al día: tienes la última versión.';
    case 'available':
      return `Hay una versión nueva: ${status.version}. No se baja ni se instala nada hasta que lo pidas.`;
    case 'downloading':
      return `Bajando la versión ${status.version}: ${status.percent} %.`;
    case 'ready':
      return `La versión ${status.version} está lista. Al instalarla, Hilo se cierra, se actualiza sin mostrar pantallas y vuelve a abrirse solo. Tus sesiones vuelven con su conversación.`;
    case 'installing':
      return `Cerrando las sesiones para instalar la versión ${status.version}…`;
    case 'error':
      return status.message;
  }
}

function UpdatesSection({ version, checkOnStart, onCheckOnStart }: { version: string; checkOnStart: boolean; onCheckOnStart(on: boolean): void }) {
  const status = useStore(view).update;
  const [confirming, setConfirming] = useState(false);
  const install = (force: boolean) => void api.updateInstall(force).then((r) => setConfirming(r.needsConfirm));
  const busy = status.state === 'off' || status.state === 'checking' || status.state === 'downloading' || status.state === 'ready' || status.state === 'installing';
  return (
    <section class="settings-section" data-section="updates">
      <h3>Actualizaciones</h3>
      <p class="update-version">
        Versión instalada: <strong data-field="current-version">{version}</strong>
      </p>
      <label class="check">
        <input type="checkbox" data-field="check-updates" checked={checkOnStart} onChange={(e) => onCheckOnStart(e.currentTarget.checked)} />
        Buscar una versión nueva cada vez que abro Hilo
      </label>
      <p class={`update-status${status.state === 'error' ? ' warn' : ''}`} data-field="update-status" data-state={status.state} role="status">
        {updateMessage(status)}
      </p>
      {status.state === 'downloading' && <progress class="update-bar" max={100} value={status.percent} aria-label="Progreso de la descarga" />}
      {confirming && status.state === 'ready' ? (
        <>
          <p class="update-status warn" data-field="update-working">
            Hay sesiones trabajando. Si actualizas ahora se interrumpen; después vuelven con su conversación.
          </p>
          <div class="actions update-actions">
            <button type="button" class="danger" data-field="update-force" onClick={() => install(true)}>
              Reiniciar de todos modos
            </button>
            <button type="button" data-field="update-wait" onClick={() => setConfirming(false)}>
              Esperar
            </button>
          </div>
        </>
      ) : (
        <div class="actions update-actions">
          {status.state === 'available' && (
            <button type="button" class="primary" data-field="update-download" onClick={() => void api.updateDownload()}>
              Bajar la versión {status.version}
            </button>
          )}
          {status.state === 'ready' && (
            <button type="button" class="primary" data-field="update-install" onClick={() => install(false)}>
              Reiniciar e instalar
            </button>
          )}
          {status.state === 'error' && status.phase === 'download' && (
            <button type="button" class="primary" data-field="update-retry" onClick={() => void api.updateDownload()}>
              Reintentar la descarga
            </button>
          )}
          <button type="button" data-field="update-check" disabled={busy} onClick={() => void api.updateCheck()}>
            Buscar actualizaciones
          </button>
          {status.state === 'error' && (
            <button type="button" class="link" data-field="update-releases" onClick={() => api.openLink(RELEASES_URL)}>
              Abrir la página de versiones
            </button>
          )}
        </div>
      )}
      <small class="update-note">Es la única conexión de Hilo. Solo habla con GitHub para buscar y bajar versiones, no envía datos tuyos y nunca instala sin preguntarte.</small>
    </section>
  );
}

function SettingsDialog({ modal }: { modal: Extract<Modal, { type: 'settings' }> }) {
  const { state, info } = useStore(app);
  const s = state.settings;
  const set = (patch: Partial<Settings>) => void dispatch({ type: 'settings/set', patch });
  const num = (value: string, min: number, max: number, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [claudeMissing, setClaudeMissing] = useState(false);
  const [fontMissing, setFontMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (s.claudePath) void api.pathExists(s.claudePath).then((ok) => live && setClaudeMissing(!ok));
    else setClaudeMissing(false);
    return () => {
      live = false;
    };
  }, [s.claudePath]);
  useEffect(() => {
    setFontMissing(!document.fonts.check(`16px "${s.fontFamily}"`));
  }, [s.fontFamily]);
  const setShortcut = (id: string, keys: string | null) => {
    const next = { ...s.shortcuts };
    const notes: Record<string, string> = {};
    if (keys === null) delete next[id];
    else {
      // Si otra acción la usaba, queda sin asignar y se avisa.
      for (const def of SHORTCUTS) {
        if (def.id !== id && (next[def.id] ?? def.defaultKeys) === keys) {
          next[def.id] = '';
          notes[id] = `Se quitó de «${def.label}»`;
        }
      }
      next[id] = keys;
    }
    setConflicts(notes);
    set({ shortcuts: next });
  };
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<string>(SETTINGS_SECTIONS[0]![0]);
  useEffect(() => {
    if (!modal.section) return;
    setSection(modal.section);
    bodyRef.current?.querySelector(`[data-section="${modal.section}"]`)?.scrollIntoView({ block: 'start' });
  }, [modal]);

  return (
    <Backdrop onClose={closeModal} labelledBy="settings-title">
      <div class="settings">
        <header class="settings-head">
          <h2 id="settings-title" ref={titleRef} tabIndex={-1}>
            Ajustes
          </h2>
          <button class="icon-btn" aria-label="Cerrar ajustes" onClick={closeModal}>
            <CloseIcon />
          </button>
        </header>
        <div class="settings-main">
          <nav class="settings-nav" aria-label="Secciones de ajustes">
            {SETTINGS_SECTIONS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                class={section === id ? 'on' : ''}
                aria-current={section === id ? 'true' : undefined}
                onClick={() => {
                  setSection(id);
                  bodyRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ block: 'start' });
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div
            ref={bodyRef}
            class="settings-body"
            onScroll={(e) => {
              const area = e.currentTarget;
              const top = area.getBoundingClientRect().top + 24;
              let current: string = SETTINGS_SECTIONS[0]![0];
              for (const [id] of SETTINGS_SECTIONS) {
                const el = area.querySelector(`[data-section="${id}"]`);
                if (el && el.getBoundingClientRect().top <= top) current = id;
              }
              // Al final de la lista, la última sección puede no llegar arriba.
              if (area.scrollTop + area.clientHeight >= area.scrollHeight - 2) current = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]![0];
              setSection(current);
            }}
          >
            <section class="settings-section" data-section="look">
              <h3>Apariencia</h3>
              <div class="field">
                <span id="font-size-label">Tamaño de la letra en las terminales</span>
                <div class="stepper">
                  <button type="button" aria-label="Letra más chica" onClick={() => set({ fontSize: Math.max(9, s.fontSize - 1) })}>
                    −
                  </button>
                  <DraftInput field="font-size" aria-labelledby="font-size-label" type="number" min={9} max={32} value={s.fontSize} onCommit={(v) => set({ fontSize: num(v, 9, 32, s.fontSize) })} />
                  <button type="button" aria-label="Letra más grande" onClick={() => set({ fontSize: Math.min(32, s.fontSize + 1) })}>
                    +
                  </button>
                </div>
              </div>
              <div class="font-preview" style={{ fontFamily: `"${s.fontFamily}", "Cascadia Mono", "Hilo Mono", monospace`, fontSize: `${s.fontSize}px`, lineHeight: s.lineHeight }}>
                Así se ve el texto. 0123456789
              </div>
              <label class="field">
                <span>Tamaño de toda la ventana</span>
                <select data-field="app-zoom" value={s.appZoom} onChange={(e) => set({ appZoom: Number(e.currentTarget.value) })}>
                  {[80, 90, 100, 110, 125, 150].map((z) => (
                    <option key={z} value={z}>
                      {z} %{z === 100 ? ' (normal)' : ''}
                    </option>
                  ))}
                </select>
                <small>Agranda también la lista de sesiones, las pestañas y estos ajustes.</small>
              </label>
              <div class="field-pair">
                <label class="field">
                  <span>Fuente</span>
                  <DraftInput field="font" value={s.fontFamily} onCommit={(v) => set({ fontFamily: v.trim() || 'Cascadia Mono' })} />
                  {fontMissing && <small class="warn">No está instalada: se usa Cascadia Mono.</small>}
                </label>
                <label class="field">
                  <span>Interlineado</span>
                  <DraftInput type="number" min={1} max={2} step={0.05} value={s.lineHeight} onCommit={(v) => set({ lineHeight: num(v, 1, 2, s.lineHeight) })} />
                </label>
              </div>
              <div class="field-pair">
                <label class="field">
                  <span>Tema</span>
                  <select data-field="theme" value={s.theme} onChange={(e) => set({ theme: e.currentTarget.value as ThemeName })}>
                    <option value="dark">Oscuro</option>
                    <option value="light">Claro</option>
                  </select>
                </label>
                <label class="field">
                  <span>Colores de la terminal</span>
                  <select data-field="colors" value={s.terminalColors} onChange={(e) => set({ terminalColors: e.currentTarget.value as TerminalColors })}>
                    <option value="hilo">Los de Hilo, con mejor contraste</option>
                    <option value="campbell">Los de Windows Terminal (Campbell)</option>
                  </select>
                </label>
              </div>
            </section>

            <section class="settings-section" data-section="terminal">
              <h3>Terminal y desplazamiento</h3>
              <label class="check">
                <input type="checkbox" data-field="scrollbar-always" checked={s.scrollbarAlways} onChange={(e) => set({ scrollbarAlways: e.currentTarget.checked })} />
                Mostrar siempre la barra de desplazamiento, si hay historial
              </label>
              <label class="field">
                <span>Velocidad con la rueda del ratón</span>
                <div class="range-row">
                  <input type="range" data-field="wheel-speed" min={25} max={300} step={25} value={s.wheelSpeed} onChange={(e) => set({ wheelSpeed: Number(e.currentTarget.value) })} />
                  <output>{s.wheelSpeed} %</output>
                </div>
              </label>
              <label class="field">
                <span>Velocidad con dos dedos en el touchpad</span>
                <div class="range-row">
                  <input type="range" data-field="touchpad-speed" min={10} max={100} step={5} value={s.touchpadSpeed} onChange={(e) => set({ touchpadSpeed: Number(e.currentTarget.value) })} />
                  <output>{s.touchpadSpeed} %</output>
                </div>
                <small>Si baja muy rápido, reduce este valor. Vale al momento, sin reiniciar.</small>
              </label>
              <label class="field">
                <span>Líneas de historial por terminal</span>
                <DraftInput field="scrollback" type="number" min={500} max={100000} step={500} value={s.scrollback} onCommit={(v) => set({ scrollback: num(v, 500, 100000, s.scrollback) })} />
                <small>Cada 3000 líneas usan unos 8 MB si la terminal está llena.{s.scrollback >= 20000 ? ` Con ${s.scrollback} líneas, unos ${Math.round((s.scrollback / 3000) * 8)} MB por terminal.` : ''}</small>
              </label>
              <label class="check">
                <input type="checkbox" data-field="confirm-multiline" checked={s.confirmMultilinePaste} onChange={(e) => set({ confirmMultilinePaste: e.currentTarget.checked })} />
                Avisar antes de pegar varias líneas en una terminal donde se ejecutarían, como PowerShell
              </label>
            </section>

            <section class="settings-section" data-section="sessions">
              <h3>Sesiones</h3>
              <label class="field">
                <span>Al abrir Hilo</span>
                <select data-field="startup" value={s.startup} onChange={(e) => set({ startup: e.currentTarget.value as StartupMode })}>
                  <option value="restore">Encender las que dejé encendidas</option>
                  <option value="asleep">Todas las sesiones dormidas</option>
                  <option value="wakeLast">Despertar la última que usé</option>
                  <option value="wakeAll">Despertar todas</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" checked={s.wakeOnSelect} onChange={(e) => set({ wakeOnSelect: e.currentTarget.checked })} />
                Despertar una sesión al seleccionarla
              </label>
              <label class="field">
                <span>Dormir tras estos minutos sin actividad (0 = nunca)</span>
                <DraftInput field="autosleep" type="number" min={0} max={1440} value={s.autoSleepMinutes} onCommit={(v) => set({ autoSleepMinutes: num(v, 0, 1440, 0) })} />
                <small>Nunca duerme una sesión que trabaja, que te espera, sin leer o con procesos en segundo plano.</small>
              </label>
              <label class="check">
                <input type="checkbox" data-field="notifications" checked={s.notifications} onChange={(e) => set({ notifications: e.currentTarget.checked })} />
                Avisar con una notificación de Windows si una sesión termina o me espera mientras no la miro
              </label>
            </section>

            <section class="settings-section" data-section="claude">
              <h3>Claude Code</h3>
              <label class="field">
                <span>Ruta de claude</span>
                <div class="field-row">
                  <DraftInput field="claude" value={s.claudePath} placeholder={info.claudePath ?? 'No se encontró en el PATH'} onCommit={(v) => set({ claudePath: v.trim() })} />
                  <button
                    type="button"
                    onClick={() =>
                      void api.pickFile().then((p) => {
                        if (p) set({ claudePath: p });
                      })
                    }
                  >
                    Elegir
                  </button>
                </div>
                <small>Déjala vacía para que Hilo la busque sola.</small>
              </label>
              {claudeMissing && <small class="warn block">No existe ese archivo.</small>}
              <div class="field-row setup-open">
                <button type="button" onClick={() => void api.toolsCheck().then((tools) => view.set({ modal: { type: 'setup', tools } }))}>
                  Ver requisitos
                </button>
              </div>
              <label class="check">
                <input type="checkbox" checked={s.useHooks} onChange={(e) => set({ useHooks: e.currentTarget.checked })} />
                Detectar el estado con hooks, solo en las sesiones de Hilo. Sin esto el amarillo llega hasta 2 segundos tarde.
              </label>
              <label class="check">
                <input type="checkbox" data-field="usage-meter" checked={s.usageMeter} disabled={!s.useHooks} onChange={(e) => set({ usageMeter: e.currentTarget.checked })} />
                Mostrar cuánto llevas usado de tu plan, en la barra lateral y abajo en cada sesión. Reemplaza tu línea de estado de Claude, solo en las sesiones de Hilo. Necesita los hooks y vale desde el próximo despertar.
              </label>
              <label class="check">
                <input type="checkbox" data-field="skip-permissions" checked={s.skipPermissions} onChange={(e) => set({ skipPermissions: e.currentTarget.checked })} />
                Abrir Claude sin pedir permisos (--dangerously-skip-permissions). Claude ejecutaría todo sin preguntar: déjalo apagado si no sabes lo que hace. Vale desde el próximo despertar.
              </label>
            </section>

            <UpdatesSection version={info.version} checkOnStart={s.checkUpdatesOnStart} onCheckOnStart={(on) => set({ checkUpdatesOnStart: on })} />
            <section class="settings-section" data-section="changes">
              <h3>Panel de cambios</h3>
              <label class="check">
                <input type="checkbox" data-field="changes-signs" checked={s.changesShowSigns} onChange={(e) => set({ changesShowSigns: e.currentTarget.checked })} />
                Mostrar + y − en los cambios, además del color de fondo
              </label>
            </section>

            <section class="settings-section" data-section="shortcuts">
              <h3>Atajos</h3>
              <div class="shortcuts">
                {SHORTCUTS.filter((d) => !/^go[2-9]$/.test(d.id)).map((d) => (
                  <ShortcutRow key={d.id} id={d.id} label={d.id === 'go1' ? 'Ir a la sesión 1 (de la 2 a la 9, con Ctrl y su número)' : d.label} keys={s.shortcuts[d.id] ?? d.defaultKeys} note={conflicts[d.id]} onSet={setShortcut} />
                ))}
              </div>
              <p class="about">Hilo {info.version}. Sin telemetría. Solo se conecta a GitHub para las actualizaciones.</p>
            </section>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="setup-command">
      <code>{command}</code>
      <button
        type="button"
        onClick={() =>
          void api.clipWrite(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function SetupGuide({ initial }: { initial: ToolCheck }) {
  const [tools, setTools] = useState(initial);
  const [checked, setChecked] = useState(false);
  const close = () => {
    void dispatch({ type: 'settings/set', patch: { setupSeen: true } });
    closeModal();
  };
  const recheck = () =>
    void api.toolsCheck().then((t) => {
      setTools(t);
      setChecked(true);
    });
  const ready = !!tools.claude && !!tools.git;
  return (
    <Backdrop onClose={close} labelledBy="setup-title">
      <h2 id="setup-title">{ready ? 'Todo listo para usar Hilo' : 'Lo que Hilo necesita en este PC'}</h2>
      <div class="setup-scroll">
        <section class="setup-tool" data-tool="claude">
          <h3>
            Claude Code: <span class={tools.claude ? 'st-done' : 'warn'}>{tools.claude ? 'instalado' : 'falta instalarlo'}</span>
          </h3>
          {tools.claude ? (
            <p>Si todavía no entras a tu cuenta, abre una sesión de Claude en Hilo y sigue lo que aparece en el navegador. Hilo no puede comprobarlo, porque no lee tus credenciales.</p>
          ) : (
            <>
              <p>Hilo abre tus sesiones con este programa. Sin él solo funcionan las terminales de PowerShell. Necesitas una cuenta de Claude de pago: el plan gratis no incluye Claude Code.</p>
              <ol>
                <li>
                  Abre PowerShell desde el menú Inicio, pega esto y presiona Enter:
                  <CopyCommand command="irm https://claude.ai/install.ps1 | iex" />
                </li>
                <li>
                  Cuando termine, abre otra ventana de PowerShell, escribe <code>claude</code> y sigue lo que aparece en el navegador para entrar a tu cuenta.
                </li>
                <li>Vuelve aquí y presiona "Comprobar de nuevo".</li>
              </ol>
            </>
          )}
        </section>
        <section class="setup-tool" data-tool="git">
          <h3>
            Git: <span class={tools.git ? 'st-done' : 'warn'}>{tools.git ? 'instalado' : 'falta instalarlo'}</span>
          </h3>
          {!tools.git && (
            <>
              <p>Es opcional, pero conviene tenerlo: con él, Claude Code puede usar Git Bash, y el panel Cambios lo necesita para mostrar lo que cambió. Descárgalo desde su página o pega este comando en PowerShell:</p>
              <div class="setup-links">
                <button type="button" onClick={() => api.openLink('https://git-scm.com/downloads/win')}>
                  Abrir la página de descarga
                </button>
              </div>
              <CopyCommand command="winget install Git.Git" />
            </>
          )}
        </section>
        {checked && !ready && <p class="warn setup-note">Sigue faltando algo. Si ya lo instalaste, cierra y vuelve a abrir Hilo.</p>}
      </div>
      <div class="actions">
        {!ready && <button onClick={recheck}>Comprobar de nuevo</button>}
        <button class="primary" data-confirm="ok" onClick={close}>
          {ready ? 'Empezar' : 'Seguir sin esto por ahora'}
        </button>
      </div>
    </Backdrop>
  );
}

export function Modals() {
  const v = useStore(view);
  const m = v.modal;
  if (!m) return null;
  switch (m.type) {
    case 'newSession':
      return <NewSessionDialog modal={m} />;
    case 'confirm':
      // Con clave propia: otro diálogo no hereda el foco en el botón de confirmar del anterior.
      return <ConfirmDialog key={m.title} modal={m} />;
    case 'quick':
      return <QuickOpen />;
    case 'setup':
      return <SetupGuide initial={m.tools} />;
    case 'ide':
      return <IdeDialog modal={m} />;
    case 'settings':
      return <SettingsDialog modal={m} />;
  }
}

export function ContextMenu() {
  const v = useStore(view);
  const { state } = useStore(app);
  const ref = useRef<HTMLDivElement>(null);
  const m = v.menu;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !m) return;
    const overflow = el.getBoundingClientRect().bottom - window.innerHeight + 4;
    if (overflow > 0) el.style.top = `${Math.max(4, m.y - overflow)}px`;
  }, [m]);

  useEffect(() => {
    if (!m) return;
    const close = () => view.set({ menu: null });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        close();
        focusActive();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      e.stopPropagation();
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]!.focus();
    };
    // En captura: la terminal corta el evento, y un clic en ella también tiene que cerrar el menú.
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [m]);

  if (!m) return null;
  const close = () => {
    view.set({ menu: null });
    focusActive();
  };
  const stop = (e: Event) => e.stopPropagation();
  const left = Math.min(m.x, window.innerWidth - 228);
  // Se mide en useLayoutEffect si no cabe: con muchos proyectos el menú es más alto.
  const top = m.y;

  if (m.target.type === 'session') {
    const found = findSession(state, m.target.id);
    if (!found) return null;
    const { session, project } = found;
    const status = statusOf(session.id);
    return (
      <div ref={ref} class="menu" role="menu" style={{ left: `${left}px`, top: `${Math.max(4, top)}px` }} onMouseDown={stop}>
        <button role="menuitem" onClick={() => { view.set({ menu: null }); startRename(session.id); }}>
          Renombrar <kbd>{keysOf('rename')}</kbd>
        </button>
        {session.kind === 'claude' && (
          <button role="menuitem" onClick={() => { close(); void copyLastMessage(session.id); }}>
            Copiar el último mensaje <kbd>{keysOf('copyLastMessage')}</kbd>
          </button>
        )}
        {status === 'asleep' ? (
          <button role="menuitem" onClick={() => { close(); void wakeSession(session.id); }}>
            Despertar <kbd>{keysOf('toggleSleep')}</kbd>
          </button>
        ) : (
          <button
            role="menuitem"
            disabled={status === 'working'}
            title={status === 'working' ? 'Está trabajando: podrás dormirla cuando termine' : undefined}
            onClick={() => { close(); void sleepSession(session.id); }}
          >
            Dormir <kbd>{keysOf('toggleSleep')}</kbd>
          </button>
        )}
        {status !== 'asleep' && (
          <button role="menuitem" onClick={() => { view.set({ menu: null }); void selectSession(session.id).then(() => runCommand('search')); }}>
            Buscar <kbd>{keysOf('search')}</kbd>
          </button>
        )}
        {state.ui.activeSessionId !== session.id && (
          <button
            role="menuitem"
            onClick={() => {
              close();
              void (async () => {
                const { ui } = app.get().state;
                if (ui.layout === 1) await dispatch({ type: 'ui/layout', layout: 2 });
                const panes = app.get().state.ui.panes;
                const other = panes.findIndex((_, i) => i !== app.get().state.ui.activePane);
                await dispatch({ type: 'ui/pane', pane: other, sessionId: session.id });
                await selectSession(session.id);
              })();
            }}
          >
            Ver junto a la actual
          </button>
        )}
        <div class="menu-sep" />
        <div class="menu-label">Color</div>
        <div class="menu-swatches">
          <Swatches value={session.color} onPick={(color) => { close(); void dispatch({ type: 'session/color', id: session.id, color }); }} />
        </div>
        {state.projects.length > 1 && (
          <>
            <div class="menu-sep" />
            <div class="menu-label">Mover a</div>
            {state.projects
              .filter((p) => p.id !== project.id)
              .map((p) => (
                <button
                  key={p.id}
                  role="menuitem"
                  onClick={() => {
                    close();
                    void dispatch({ type: 'session/move', id: session.id, toProjectId: p.id, toIndex: p.sessions.length });
                    moveToast(session, p, false);
                  }}
                >
                  {p.name}
                </button>
              ))}
          </>
        )}
        <div class="menu-sep" />
        <button role="menuitem" class="danger-item" onClick={() => { close(); void confirmCloseSession(session.id); }}>
          Cerrar esta sesión <kbd>{keysOf('closeSession')}</kbd>
        </button>
      </div>
    );
  }

  const project = state.projects.find((p) => p.id === (m.target as { id: string }).id);
  if (!project) return null;
  return (
    <div ref={ref} class="menu" role="menu" style={{ left: `${left}px`, top: `${Math.max(4, top)}px` }} onMouseDown={stop}>
      <button role="menuitem" onClick={() => { view.set({ menu: null, modal: { type: 'newSession', kind: 'claude', projectId: project.id } }); }}>
        Nueva sesión
      </button>
      <button role="menuitem" onClick={() => { view.set({ menu: null, renaming: project.id }); }}>
        Renombrar
      </button>
      <div class="menu-sep" />
      <button role="menuitem" data-action="menu-changes" onClick={() => { close(); void toggleChanges(project.id); }}>
        {state.ui.panes.includes(changesPaneId(project.id)) ? 'Quitar los cambios' : 'Ver los cambios'} <kbd>{keysOf('toggleChanges')}</kbd>
      </button>
      <button role="menuitem" data-action="menu-ide" onClick={() => { view.set({ menu: null }); void openInIde(project.id); }}>
        {project.ide ? `Abrir en ${project.ide.name}` : 'Abrir en un IDE…'}
      </button>
      {project.ide && (
        <button role="menuitem" data-action="menu-ide-change" onClick={() => view.set({ menu: null, modal: { type: 'ide', projectId: project.id, file: null, line: null } })}>
          Cambiar de IDE…
        </button>
      )}
      <div class="menu-sep" />
      <div class="menu-label">Color</div>
      <div class="menu-swatches">
        <Swatches value={project.color} onPick={(color) => { close(); void dispatch({ type: 'project/color', id: project.id, color }); }} />
      </div>
      <div class="menu-sep" />
      <button
        role="menuitem"
        class="danger-item"
        onClick={() => {
          view.set({ menu: null });
          const count = project.sessions.length;
          void (async () => {
            const { confirmDialog } = await import('../controller');
            const ok = await confirmDialog({
              title: `Quitar «${project.name}» de Hilo`,
              body: count
                ? `${count === 1 ? 'Se cierra su sesión' : `Se cierran sus ${count} sesiones`}. Los archivos de la carpeta y las conversaciones de Claude no se tocan.`
                : 'Los archivos de la carpeta no se tocan.',
              ok: 'Quitar proyecto',
              danger: true,
            });
            focusActive();
            if (!ok) return;
            await api.removeProject(project.id);
          })();
        }}
      >
        Quitar proyecto
      </button>
    </div>
  );
}

export function Toasts() {
  const v = useStore(view);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {v.toasts.map((t) => (
        <div class="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              class="link"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          {t.sticky && (
            <button class="link" onClick={() => dismissToast(t.id)}>
              Ahora no
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

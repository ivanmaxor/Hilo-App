import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { STATUS_LABEL } from '../../shared/statusMachine';
import { findSession } from '../../shared/reducer';
import { changesPaneId, changesProjectOf, sessionInPane } from '../../shared/paneContent';
import { ChangesPanel } from './changes';
import {
  activeProject,
  app,
  cancelPendingWake,
  closeTab,
  confirmCloseSession,
  createShellQuick,
  dispatch,
  displayStatus,
  focusActive,
  keysOf,
  newProjectFlow,
  selectSession,
  runCommand,
  statusOf,
  terminals,
  toast,
  toggleChanges,
  useStore,
  view,
  wakeSession,
  subagentsOf,
} from '../controller';
import { CloseIcon, DiffIcon, LayoutIcon, PlusIcon, SearchIcon, ShellMark, StatusIcon, subagentsLabel } from './icons';
import { draggedPaneContent, endDragging, InlineRename, startDraggingPane, startDraggingSession } from './sidebar';
import { MAX_PANES, moveDivider, paneDividers, paneRects, presetTree, resetDivider, type PaneDivider, type PaneEdge, type PaneNode, type PaneRect } from '../../shared/paneLayout';
import type { SessionRecord } from '../../shared/types';

export function Tabs() {
  const { state } = useStore(app);
  const v = useStore(view);
  const project = activeProject();
  const sessions = (project?.sessions ?? []).filter((s) => !v.closing.includes(s.id) && !state.ui.hiddenTabs.includes(s.id));
  const activeId = state.ui.activeSessionId;
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, sessions.length]);
  // Las pestañas que no caben se indican con un degradado, y la rueda las recorre.
  const markOverflow = () => {
    const el = bar.current;
    if (!el) return;
    el.classList.toggle('more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    el.classList.toggle('more-left', el.scrollLeft > 1);
  };
  useEffect(() => {
    markOverflow();
    const el = bar.current;
    if (!el) return;
    // Al encoger la ventana, la activa sigue a la vista.
    const observer = new ResizeObserver(() => {
      markOverflow();
      el.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    observer.observe(el);
    return () => observer.disconnect();
  });
  return (
    <div class="tabbar">
      <div
        ref={bar}
        class="tabs"
        role="tablist"
        aria-label={project ? `Sesiones de ${project.name}` : 'Sesiones'}
        onScroll={markOverflow}
        onWheel={(e) => {
          if (e.ctrlKey || !e.deltaY) return;
          e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
      {sessions.map((s) => {
        const status = displayStatus(s.id);
        const active = state.ui.activeSessionId === s.id;
        const renaming = v.renaming === `tab:${s.id}`;
        return (
          <div
            key={s.id}
            role="tab"
            aria-selected={active}
            class={`tab${active ? ' active' : ''}${status === 'done' ? ' unread' : ''}${status === 'asleep' ? ' dim' : ''}`}
            style={{ '--tab-color': s.color ?? project?.color ?? 'transparent' }}
            title={`${s.name}\n${STATUS_LABEL[status]}${subagentsOf(s.id) ? `, ${subagentsLabel(subagentsOf(s.id))}` : ''}`}
            data-tab={s.id}
            draggable={!renaming}
            onDragStart={(e) => startDraggingSession(e, s)}
            onDragEnd={endDragging}
            onClick={() => void selectSession(s.id, { delayWake: true })}
            onDblClick={() => {
              cancelPendingWake();
              view.set({ renaming: `tab:${s.id}` });
            }}
            onAuxClick={(e) => {
              if (e.button === 1) void closeTab(s.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              view.set({ menu: { x: e.clientX, y: e.clientY, target: { type: 'session', id: s.id } } });
            }}
          >
            <StatusIcon status={status} />
            {renaming ? (
              <InlineRename
                value={s.name}
                onDone={(next) => {
                  view.set({ renaming: null });
                  if (next !== null) void dispatch({ type: 'session/rename', id: s.id, name: next });
                  focusActive();
                }}
              />
            ) : (
              <span class="tab-name">{s.name}</span>
            )}
            {s.kind === 'shell' && <ShellMark />}
            <button
              class="tab-close"
              title="Cerrar la pestaña. La sesión sigue en la barra lateral."
              aria-label={`Cerrar la pestaña de ${s.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(s.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      </div>
      {project && (
        <button
          class="icon-btn tab-add"
          title={`Nueva sesión (${keysOf('newClaude')})`}
          aria-label="Nueva sesión"
          onClick={() => view.set({ modal: { type: 'newSession', kind: 'claude', projectId: project.id } })}
        >
          <PlusIcon />
        </button>
      )}
      <div class="tab-drag" />
      {project && (
        <div class="view-tools">
          <button
            class={`tool-text${state.ui.panes.includes(changesPaneId(project.id)) ? ' on' : ''}`}
            data-action="toggle-changes"
            title={`Ver qué archivos cambiaron en «${project.name}» (${keysOf('toggleChanges')})`}
            aria-pressed={state.ui.panes.includes(changesPaneId(project.id))}
            onClick={() => void toggleChanges(project.id)}
          >
            <DiffIcon />
            <span>Cambios</span>
          </button>
          <button
            class="icon-btn"
            title={`Buscar en la terminal (${keysOf('search')})`}
            aria-label="Buscar en la terminal"
            onClick={() => runCommand('search')}
          >
            <SearchIcon />
          </button>
          {([1, 2, 3, 4] as const).map((count) => (
            <button
              key={count}
              class={`icon-btn${state.ui.layout === count ? ' on' : ''}`}
              title={`Ver ${count === 1 ? '1 terminal' : `${count} terminales`} (${keysOf(`layout${count}`)})`}
              aria-label={`Ver ${count === 1 ? '1 terminal' : `${count} terminales`}`}
              aria-pressed={state.ui.layout === count}
              onClick={() => void dispatch({ type: 'ui/layout', layout: count }).then(focusActive)}
            >
              <LayoutIcon count={count} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchBar({ sessionId }: { sessionId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);
  useEffect(() => {
    ref.current?.focus();
    const stop = terminals.listenSearch(sessionId, (index, count) => setResults({ index, count }));
    return () => {
      stop();
      terminals.clearSearch(sessionId);
    };
  }, [sessionId]);
  const close = () => {
    view.set({ searchOpen: false });
    focusActive();
  };
  const run = (next: boolean) => {
    if (!query) return;
    const found = next ? terminals.findNext(sessionId, query) : terminals.findPrevious(sessionId, query);
    setMissing(!found);
  };
  return (
    <div class="searchbar" role="search">
      <input
        ref={ref}
        class={missing && query ? 'missing' : ''}
        value={query}
        placeholder="Buscar en la terminal"
        aria-label="Buscar en la terminal"
        onInput={(e) => {
          const q = e.currentTarget.value;
          setQuery(q);
          if (q) setMissing(!terminals.findNext(sessionId, q));
          else {
            setMissing(false);
            setResults(null);
            terminals.clearSearch(sessionId);
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') run(!e.shiftKey);
          if (e.key === 'Escape') close();
        }}
      />
      {missing && query && <span class="search-none">Sin resultados</span>}
      {!missing && query && results && results.count > 0 && (
        <span class="search-count">{results.index >= 0 ? `${results.index + 1} de ${results.count}${results.count >= 1000 ? '+' : ''}` : `Más de ${results.count}`}</span>
      )}
      <button class="icon-btn" title="Anterior (Shift+Enter)" aria-label="Anterior" onClick={() => run(false)}>↑</button>
      <button class="icon-btn" title="Siguiente (Enter)" aria-label="Siguiente" onClick={() => run(true)}>↓</button>
      <button class="icon-btn" title="Cerrar (Esc)" aria-label="Cerrar búsqueda" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  );
}

function Overlay({ sessionId, name, active }: { sessionId: string; name: string; active: boolean }) {
  const { runtime } = useStore(app);
  const status = statusOf(sessionId);
  const btn = useRef<HTMLButtonElement>(null);
  const message = runtime[sessionId]?.message;
  const blocking = status === 'error' && !!message;
  useEffect(() => {
    // Un doble clic en la fila puede estar abriendo el campo de renombrar: no se le quita el foco.
    if (active && (status === 'asleep' || blocking) && !view.get().renaming && !view.get().modal) btn.current?.focus();
  }, [status, sessionId, blocking, active]);

  if (status === 'asleep') {
    return (
      <div class="overlay center">
        <StatusIcon status="asleep" size={28} />
        <p class="overlay-title">{name}</p>
        <p class="overlay-sub">Dormida. No usa memoria hasta que la despiertes.</p>
        <button ref={btn} class="primary" onClick={() => void wakeSession(sessionId).then(focusActive)}>
          Despertar
        </button>
      </div>
    );
  }
  // No llegó a arrancar: no hay salida que mostrar, y el mensaje dice qué hacer.
  if (blocking) {
    const isClaude = message!.includes('claude');
    return (
      <div class="overlay center" role="alert">
        <StatusIcon status="error" size={28} />
        <p class="overlay-title">{name}</p>
        <p class="overlay-sub pre">{message}</p>
        <div class="overlay-actions">
          {isClaude && (
            <button ref={btn} class="primary" onClick={() => view.set({ modal: { type: 'settings' } })}>
              Abrir Ajustes
            </button>
          )}
          <button
            ref={isClaude ? undefined : btn}
            class={isClaude ? 'secondary' : 'primary'}
            onClick={() =>
              void wakeSession(sessionId).then(() => {
                if (statusOf(sessionId) === 'error') toast('Sigue sin poder arrancar.');
                focusActive();
              })
            }
          >
            Reintentar
          </button>
          <button class="secondary" onClick={() => void confirmCloseSession(sessionId)}>
            Cerrar esta sesión
          </button>
        </div>
      </div>
    );
  }
  if (status === 'error' || status === 'exited') {
    const code = runtime[sessionId]?.exitCode;
    return (
      <div class={`overlay banner ${status}`} role="alert">
        <StatusIcon status={status} />
        <span class="banner-text">
          {status === 'error' ? `El proceso terminó con error (código ${code ?? '?'}).` : 'La terminal se cerró.'}
        </span>
        <button class="primary" onClick={() => void wakeSession(sessionId).then(focusActive)}>
          {status === 'error' ? 'Retomar' : 'Abrir de nuevo'}
        </button>
      </div>
    );
  }
  return null;
}

function EmptyProject({ name }: { name: string }) {
  return (
    <div class="overlay center">
      <p class="overlay-title">«{name}» no tiene sesiones</p>
      <p class="overlay-sub">Crea una para empezar a trabajar en esta carpeta.</p>
      <div class="overlay-actions">
        <button class="primary" onClick={() => runCommand('newClaude')}>
          Nueva sesión
        </button>
        <button class="secondary" onClick={() => void createShellQuick()}>
          Nueva PowerShell
        </button>
      </div>
      <p class="overlay-hint">
        <kbd>{keysOf('newClaude')}</kbd>
      </p>
    </div>
  );
}

/** Lo que se puede mostrar en un panel vacío: primero las de este proyecto, sin las que ya se ven. */
function PanePicker({ index }: { index: number }) {
  const { state } = useStore(app);
  const v = useStore(view);
  const current = activeProject();
  const projects = current ? [current, ...state.projects.filter((p) => p.id !== current.id)] : state.projects;
  const available = projects.flatMap((project) =>
    project.sessions
      .filter((s) => !state.ui.panes.includes(s.id) && !v.closing.includes(s.id))
      .map((session) => ({ session, project })),
  );
  const choose = (session: SessionRecord) => {
    void dispatch({ type: 'ui/pane', pane: index, sessionId: session.id }).then(() => selectSession(session.id));
  };
  const moveFocus = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <div class="overlay center picker" onKeyDown={moveFocus}>
      <p class="overlay-title">{available.length ? 'Elige qué mostrar aquí' : 'No hay más sesiones para mostrar'}</p>
      {available.length > 0 && (
        <div class="picker-list">
          {available.map(({ session, project }) => (
            <button key={session.id} class="picker-item" data-pick={session.id} onClick={() => choose(session)}>
              <StatusIcon status={displayStatus(session.id)} />
              <span class="picker-name">{session.name}</span>
              {session.kind === 'shell' && <ShellMark />}
              <span class="picker-project">{project.name}</span>
            </button>
          ))}
        </div>
      )}
      <div class="overlay-actions">
        <button
          class="secondary"
          onClick={() => {
            void dispatch({ type: 'ui/activePane', pane: index }).then(() => runCommand('newClaude'));
          }}
        >
          Nueva sesión
        </button>
        {current && !state.ui.panes.includes(changesPaneId(current.id)) && (
          <button class="secondary" data-pick-changes onClick={() => void dispatch({ type: 'ui/pane', pane: index, sessionId: changesPaneId(current.id) }).then(focusActive)}>
            Ver cambios
          </button>
        )}
        {state.ui.panes.length > 1 && (
          <button class="secondary" onClick={() => void dispatch({ type: 'ui/paneRemove', pane: index }).then(focusActive)}>
            Quitar este panel
          </button>
        )}
      </div>
    </div>
  );
}

type DropZone = PaneEdge | 'center';

/** Cerca de un borde es sumar un panel; en el resto, cambiar lo que se muestra. */
function zoneAt(e: DragEvent, el: HTMLElement, canAdd: boolean): DropZone {
  if (!canAdd) return 'center';
  const box = el.getBoundingClientRect();
  const dist: [PaneEdge, number, number][] = [
    ['left', e.clientX - box.left, box.width],
    ['right', box.right - e.clientX, box.width],
    ['top', e.clientY - box.top, box.height],
    ['bottom', box.bottom - e.clientY, box.height],
  ];
  let best: DropZone = 'center';
  let closest = Infinity;
  for (const [edge, d, size] of dist) {
    if (d < Math.min(72, size * 0.25) && d < closest) {
      best = edge;
      closest = d;
    }
  }
  return best;
}

function DropMark({ zone, label, rect }: { zone: DropZone; label: string; rect: PaneRect }) {
  if (zone === 'center') {
    return (
      <div class="drop-mark center" aria-hidden="true">
        <span class="drop-label">{label}</span>
      </div>
    );
  }
  const outer =
    (zone === 'left' && rect.x < 0.001) ||
    (zone === 'top' && rect.y < 0.001) ||
    (zone === 'right' && rect.x + rect.w > 0.999) ||
    (zone === 'bottom' && rect.y + rect.h > 0.999);
  return (
    <div class={`drop-mark edge ${zone}${outer ? ' outer' : ''}`} aria-hidden="true">
      <span class="drop-ghost" />
      <span class="drop-line" />
      <span class="drop-plus">
        <PlusIcon />
      </span>
    </div>
  );
}

function Pane({ index, content, rect }: { index: number; content: string | null; rect: PaneRect }) {
  const { state, runtime } = useStore(app);
  const sessionId = sessionInPane(content);
  const changesProjectId = changesProjectOf(content);
  const changesProject = changesProjectId ? (state.projects.find((p) => p.id === changesProjectId) ?? null) : null;
  const v = useStore(view);
  const host = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<DropZone | null>(null);
  const found = sessionId ? findSession(state, sessionId) : null;
  const session = found?.session ?? null;
  const status = sessionId ? (runtime[sessionId]?.status ?? 'asleep') : 'asleep';
  const hasTerm = !!sessionId && status !== 'asleep' && terminals.has(sessionId);
  const generation = hasTerm && sessionId ? terminals.generationOf(sessionId) : 0;
  const active = state.ui.activePane === index;

  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !sessionId || !hasTerm) return;
    terminals.attach(sessionId, el);
    const observer = new ResizeObserver(() => {
      terminals.fit(sessionId);
      if (activeRef.current) terminals.setParkingSize(el.clientWidth, el.clientHeight);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      terminals.detach(sessionId, el);
    };
    // Sin `active`: cambiar de panel no debe desmontar la terminal ni recrear WebGL.
  }, [sessionId, generation]);

  // Las sesiones que se crean fuera de pantalla nacen del tamaño del panel.
  useLayoutEffect(() => {
    const el = host.current;
    if (el && active) terminals.setParkingSize(el.clientWidth, el.clientHeight);
  });

  useEffect(() => {
    if (active && sessionId && hasTerm && !view.get().modal && !view.get().renaming) {
      // Sin proceso o con la búsqueda abierta el foco va a otro sitio; si no, directo: la tecla siguiente ya es para esta.
      if (status === 'error' || status === 'exited' || view.get().searchOpen) focusActive();
      else terminals.focus(sessionId);
    }
  }, [active, sessionId, generation]);

  // El panel Cambios siempre lleva cabecera: es donde está su X, también cuando va solo.
  const showHeader = state.ui.layout > 1 || !!changesProject;
  const candidate = activeProject();
  const emptyProject = active && candidate && candidate.sessions.length === 0 ? candidate : null;

  // Si el arrastre acaba fuera de la ventana o con Esc, no llega ningún drop.
  useEffect(() => {
    if (!zone) return;
    const clear = () => setZone(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, [zone]);

  const title = session?.name ?? (changesProject ? 'Cambios' : null);

  const trackDrag = (e: DragEvent) => {
    const dragged = draggedPaneContent();
    // Soltar algo sobre sí mismo no cambiaría nada.
    if (!dragged || dragged === content) return;
    e.preventDefault();
    // Sumar necesita un sitio libre; mover una que ya se ve no agrega ninguno.
    const canAdd = !!title && (state.ui.panes.includes(dragged) || state.ui.panes.length < MAX_PANES);
    setZone(zoneAt(e, e.currentTarget as HTMLElement, canAdd));
  };

  const draggedId = zone ? draggedPaneContent() : null;
  const draggedShown = !!draggedId && state.ui.panes.includes(draggedId);
  const dropLabel = !title
    ? 'Mostrar aquí'
    : draggedShown
      ? `Intercambiar con «${title}»`
      : state.ui.panes.length >= MAX_PANES
        ? `Reemplazar «${title}». Ya hay ${MAX_PANES} paneles`
        : `Reemplazar «${title}»`;

  return (
    <div
      class={`pane${active && showHeader ? ' active' : ''}${zone ? ' drop-target' : ''}`}
      data-pane={index}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        // El hueco de 1 px deja ver la línea que separa los paneles.
        width: rect.x + rect.w < 0.999 ? `calc(${rect.w * 100}% - 1px)` : `${rect.w * 100}%`,
        height: rect.y + rect.h < 0.999 ? `calc(${rect.h * 100}% - 1px)` : `${rect.h * 100}%`,
      }}
      onMouseDown={() => {
        if (!active) void dispatch({ type: 'ui/activePane', pane: index });
      }}
      onDragEnter={trackDrag}
      onDragOver={trackDrag}
      onDragLeave={(e) => {
        // Pasar sobre un hijo del panel también avisa, y `relatedTarget` puede venir vacío: manda la posición.
        const box = e.currentTarget.getBoundingClientRect();
        if (e.clientX <= box.left || e.clientX >= box.right || e.clientY <= box.top || e.clientY >= box.bottom) setZone(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = draggedPaneContent();
        const where = zone;
        setZone(null);
        if (!dragged || !where) return;
        const done = where === 'center' ? dispatch({ type: 'ui/pane', pane: index, sessionId: dragged }) : dispatch({ type: 'ui/paneInsert', pane: index, edge: where, sessionId: dragged });
        // Un panel Cambios no se despierta: basta con dejarlo donde se soltó.
        void done.then(() => (sessionInPane(dragged) ? selectSession(dragged) : focusActive()));
      }}
    >
      {zone && <DropMark zone={zone} label={dropLabel} rect={rect} />}
      {showHeader && (
        <div
          class="pane-head"
          draggable={!!session || !!changesProject}
          onDragStart={(e) => {
            if (session) startDraggingSession(e, session);
            else if (content && changesProject) startDraggingPane(e, content, 'Cambios');
          }}
          onDragEnd={endDragging}
        >
          {session ? (
            <>
              <StatusIcon status={displayStatus(session.id)} size={14} />
              <span class="pane-name">{session.name}</span>
              <span class="pane-project">{found?.project.name}</span>
              <button
                class="icon-btn pane-close"
                title="Quitar de la vista. La sesión sigue abierta en la barra lateral."
                aria-label={`Quitar ${session.name} de la vista`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void dispatch({ type: 'ui/paneRemove', pane: index }).then(focusActive)}
              >
                <CloseIcon />
              </button>
            </>
          ) : changesProject ? (
            <>
              <DiffIcon />
              <span class="pane-name">Cambios</span>
              <span class="pane-project">{changesProject.name}</span>
              <button
                class="icon-btn pane-close"
                title="Quitar el panel de cambios"
                aria-label="Quitar el panel de cambios"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void dispatch({ type: 'ui/paneRemove', pane: index }).then(focusActive)}
              >
                <CloseIcon />
              </button>
            </>
          ) : (
            <span class="pane-name muted">Panel vacío</span>
          )}
        </div>
      )}
      <div class="pane-body">
        <div ref={host} class="term-slot" />
        {session && <Overlay sessionId={session.id} name={session.name} active={active} />}
        {changesProject && <ChangesPanel key={changesProject.id} project={changesProject} />}
        {!session && !changesProject && state.projects.length > 0 && (emptyProject ? (
          <EmptyProject name={emptyProject.name} />
        ) : (
          <PanePicker index={index} />
        ))}
        {active && v.searchOpen && sessionId && hasTerm && <SearchBar key={sessionId} sessionId={sessionId} />}
      </div>
    </div>
  );
}

function EmptyApp() {
  return (
    <div class="empty">
      <h1>Abre la carpeta de un proyecto</h1>
      <p>Cada proyecto agrupa sus sesiones de Claude Code y sus terminales.</p>
      <button class="primary" onClick={() => void newProjectFlow()}>
        Abrir carpeta
      </button>
      <p class="empty-hint">
        <kbd>{keysOf('newProject')}</kbd>
      </p>
    </div>
  );
}

export function Workspace() {
  const { state } = useStore(app);
  const { ui } = state;
  const box = useRef<HTMLDivElement>(null);
  // Mientras se arrastra un divisor manda esto; se guarda al soltar.
  const [preview, setPreview] = useState<PaneNode | null>(null);
  if (state.projects.length === 0) return <EmptyApp />;
  const tree = preview ?? ui.tree ?? presetTree(ui.panes.length);
  const rects = paneRects(tree);
  const save = (next: PaneNode) => {
    void dispatch({ type: 'ui/tree', tree: next }).finally(() => {
      setPreview(null);
      focusActive();
    });
  };
  const startDrag = (e: PointerEvent, d: PaneDivider) => {
    const el = e.currentTarget as HTMLElement;
    const area = box.current;
    if (!area) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    let latest = tree;
    const move = (ev: PointerEvent) => {
      const r = area.getBoundingClientRect();
      const pos = d.dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      latest = moveDivider(tree, d, pos);
      setPreview(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      save(latest);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div ref={box} class={`panes layout-${ui.layout}`}>
      {ui.panes.map((content, i) => (
        <Pane key={i} index={i} content={content} rect={rects[i] ?? { x: 0, y: 0, w: 1, h: 1 }} />
      ))}
      {paneDividers(tree).map((d) => (
        <div
          key={`${d.path.join('.')}:${d.index}`}
          class={`pane-divider ${d.dir === 'row' ? 'along-x' : 'along-y'}`}
          title="Arrastra para cambiar el tamaño. Doble clic: partes iguales."
          style={
            d.dir === 'row'
              ? { left: `${d.x * 100}%`, top: `${d.y * 100}%`, height: `${d.length * 100}%` }
              : { left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.length * 100}%` }
          }
          onPointerDown={(e) => startDrag(e, d)}
          onDblClick={() => save(resetDivider(tree, d.path))}
        />
      ))}
    </div>
  );
}


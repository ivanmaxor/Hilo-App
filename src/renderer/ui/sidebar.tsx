import { useEffect, useRef, useState } from 'preact/hooks';
import { STATUS_LABEL, STATUS_PRIORITY } from '../../shared/statusMachine';
import { allSessions, findSession } from '../../shared/reducer';
import type { ProjectRecord, SessionRecord } from '../../shared/types';
import {
  app,
  attentionSessions,
  cancelPendingWake,
  dispatch,
  displayStatus,
  focusActive,
  newProjectFlow,
  selectSession,
  keysOf,
  statusOf,
  toast,
  useStore,
  view,
  subagentsOf,
} from '../controller';
import { Chevron, GearIcon, MoreIcon, PanelIcon, PlusIcon, ShellMark, StatusIcon, SubagentsBadge, subagentsLabel } from './icons';
import { UsageMeter } from './usage';

type Drag = { type: 'session'; id: string } | { type: 'project'; id: string } | { type: 'pane'; id: string } | null;
let dragging: Drag = null;

export function isDraggingSession(): string | null {
  return dragging?.type === 'session' ? dragging.id : null;
}

/** Lo que se está arrastrando y se puede soltar en un panel: una sesión o un panel Cambios. */
export function draggedPaneContent(): string | null {
  return dragging?.type === 'session' || dragging?.type === 'pane' ? dragging.id : null;
}

/** Un panel que no es una sesión: se suelta en otro panel, pero no se ordena en la barra lateral. */
export function startDraggingPane(e: DragEvent, id: string, label: string): void {
  dragging = { type: 'pane', id };
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', label);
}

/** Una sesión también se arrastra desde su pestaña o desde la cabecera de su panel. */
export function startDraggingSession(e: DragEvent, session: SessionRecord): void {
  dragging = { type: 'session', id: session.id };
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', session.name);
}

export function endDragging(): void {
  dragging = null;
  // El navegador no emite mouseup al terminar de arrastrar.
  focusActive();
}

export function InlineRename({ value, onDone }: { value: string; onDone(next: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <input
      ref={ref}
      class="rename"
      aria-label="Nuevo nombre"
      value={draft}
      maxLength={80}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => {
        // El menú contextual o cambiar de ventana no terminan la edición: el campo sigue activo.
        if (document.activeElement !== e.currentTarget) finish(e.currentTarget.value);
      }}
    />
  );
}

export function moveToast(session: SessionRecord, target: ProjectRecord, sameProject: boolean): void {
  if (!sameProject && session.cwd.toLowerCase() !== target.path.toLowerCase()) {
    toast(`Se movió a «${target.name}». Sigue trabajando en ${session.cwd}`);
  }
}

function SessionRow({ session, project, index, globalIndex }: { session: SessionRecord; project: ProjectRecord; index: number; globalIndex: number }) {
  const { state } = useStore(app);
  const v = useStore(view);
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const status = displayStatus(session.id);
  const subagents = subagentsOf(session.id);
  const active = state.ui.activeSessionId === session.id;
  const open = state.ui.panes.includes(session.id);
  const renaming = v.renaming === session.id;

  return (
    <div
      class={`row${active ? ' active' : ''}${open && !active ? ' open' : ''}${status === 'done' ? ' unread' : ''}${status === 'asleep' ? ' dim' : ''}${drop ? ` drop-${drop}` : ''}`}
      style={session.color ? { '--seg': session.color } : undefined}
      data-session={session.id}
      draggable={!renaming}
      title={`${session.name}\n${STATUS_LABEL[status]}${subagents ? `, ${subagentsLabel(subagents)}` : ''}\n${session.cwd}`}
      onClick={() => void selectSession(session.id, { delayWake: true })}
      onDblClick={(e) => {
        e.preventDefault();
        cancelPendingWake();
        view.set({ renaming: session.id });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        view.set({ menu: { x: e.clientX, y: e.clientY, target: { type: 'session', id: session.id } } });
      }}
      onDragStart={(e) => startDraggingSession(e, session)}
      onDragEnd={endDragging}
      onDragOver={(e) => {
        if (dragging?.type !== 'session' || dragging.id === session.id) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setDrop(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const where = drop;
        setDrop(null);
        if (dragging?.type !== 'session') return;
        const fromSame = project.sessions.findIndex((s) => s.id === dragging!.id);
        let toIndex = where === 'after' ? index + 1 : index;
        if (fromSame >= 0 && fromSame < toIndex) toIndex--;
        const moved = findSession(app.get().state, dragging.id)?.session;
        void dispatch({ type: 'session/move', id: dragging.id, toProjectId: project.id, toIndex });
        if (moved) moveToast(moved, project, fromSame >= 0);
        dragging = null;
      }}
    >
      <StatusIcon status={status} />
      {renaming ? (
        <InlineRename
          value={session.name}
          onDone={(next) => {
            view.set({ renaming: null });
            if (next !== null) void dispatch({ type: 'session/rename', id: session.id, name: next });
            focusActive();
          }}
        />
      ) : (
        <span class="name">{session.name}</span>
      )}
      {session.kind === 'shell' && <ShellMark />}
      <SubagentsBadge count={subagents} />
      {status === 'done' && <span class="unread-dot" aria-hidden="true" />}
      {v.ctrlHeld && globalIndex < 9 && <kbd class="idx">{globalIndex + 1}</kbd>}
      {!renaming && (
        <button
          class="row-more"
          title="Opciones: dormir, color, mover, cerrar"
          aria-label={`Opciones de ${session.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            view.set({ menu: { x: box.left, y: box.bottom, target: { type: 'session', id: session.id } } });
          }}
        >
          <MoreIcon />
        </button>
      )}
    </div>
  );
}

function ProjectBlock({ project, startIndex, index }: { project: ProjectRecord; startIndex: number; index: number }) {
  const v = useStore(view);
  const { state } = useStore(app);
  const [drop, setDrop] = useState<'before' | 'after' | 'into' | null>(null);
  const live = project.sessions.filter((s) => statusOf(s.id) !== 'asleep' && statusOf(s.id) !== 'exited').length;
  const renaming = v.renaming === project.id;

  const hidden = project.collapsed ? [...project.sessions].sort((a, b) => STATUS_PRIORITY[statusOf(a.id)] - STATUS_PRIORITY[statusOf(b.id)])[0] : null;
  const showRollup = hidden && ['waiting', 'error', 'done', 'working'].includes(statusOf(hidden.id));

  return (
    <section class="project" style={project.color ? { '--hilo': project.color } : undefined} data-project={project.id}>
      <header
        class={`project-head${drop ? ` drop-${drop}` : ''}`}
        draggable={!renaming}
        title={`${project.name}
${project.path}`}
        onClick={() => void dispatch({ type: 'project/collapse', id: project.id, collapsed: !project.collapsed })}
        onDblClick={(e) => {
          e.preventDefault();
          void dispatch({ type: 'project/collapse', id: project.id, collapsed: project.collapsed });
          view.set({ renaming: project.id });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          view.set({ menu: { x: e.clientX, y: e.clientY, target: { type: 'project', id: project.id } } });
        }}
        onDragStart={(e) => {
          dragging = { type: 'project', id: project.id };
          e.dataTransfer!.effectAllowed = 'move';
          e.dataTransfer!.setData('text/plain', project.name);
        }}
        onDragEnd={() => {
          dragging = null;
          focusActive();
        }}
        onDragOver={(e) => {
          if (!dragging || dragging.type === 'pane') return;
          e.preventDefault();
          if (dragging.type === 'session') {
            setDrop('into');
          } else if (dragging.id !== project.id) {
            const rect = e.currentTarget.getBoundingClientRect();
            setDrop(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
          }
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          const where = drop;
          setDrop(null);
          if (!dragging || dragging.type === 'pane') return;
          if (dragging.type === 'session') {
            const moved = findSession(app.get().state, dragging.id)?.session;
            const same = project.sessions.some((s) => s.id === dragging!.id);
            void dispatch({ type: 'session/move', id: dragging.id, toProjectId: project.id, toIndex: 0 });
            // Para que no desaparezca de la vista al soltarla en un proyecto colapsado.
            if (project.collapsed) void dispatch({ type: 'project/collapse', id: project.id, collapsed: false });
            if (moved) moveToast(moved, project, same);
          } else if (dragging.id !== project.id) {
            const from = state.projects.findIndex((p) => p.id === dragging!.id);
            let toIndex = where === 'after' ? index + 1 : index;
            if (from < toIndex) toIndex--;
            void dispatch({ type: 'project/move', id: dragging.id, toIndex });
          }
          dragging = null;
        }}
      >
        <Chevron open={!project.collapsed} />
        {renaming ? (
          <InlineRename
            value={project.name}
            onDone={(next) => {
              view.set({ renaming: null });
              if (next !== null) void dispatch({ type: 'project/rename', id: project.id, name: next });
              focusActive();
            }}
          />
        ) : (
          <span class="name">{project.name}</span>
        )}
        {showRollup && hidden && <StatusIcon status={statusOf(hidden.id)} size={14} />}
        <span class="count" title={`${live} de ${project.sessions.length} despiertas`}>
          {live}/{project.sessions.length}
        </span>
        <button
          class="icon-btn add"
          title="Nueva sesión en este proyecto"
          aria-label={`Nueva sesión en ${project.name}`}
          onClick={(e) => {
            e.stopPropagation();
            view.set({ modal: { type: 'newSession', kind: 'claude', projectId: project.id } });
          }}
        >
          <PlusIcon size={13} />
        </button>
      </header>
      {!project.collapsed &&
        project.sessions.filter((s) => !view.get().closing.includes(s.id)).map((session, i) => (
          <SessionRow key={session.id} session={session} project={project} index={i} globalIndex={startIndex + i} />
        ))}
      {!project.collapsed && project.sessions.length === 0 && (
        <button class="row ghost" onClick={() => view.set({ modal: { type: 'newSession', kind: 'claude', projectId: project.id } })}>
          <PlusIcon size={13} />
          <span class="name">Nueva sesión</span>
        </button>
      )}
    </section>
  );
}

function NeedsYou() {
  useStore(app);
  const list = attentionSessions();
  const { state } = app.get();
  if (!list.length) return null;
  return (
    <section class="needs" aria-label="Te necesitan">
      <h2>
        Te necesitan <span class="needs-count">{list.length}</span>
      </h2>
      <div class="needs-list">
        {list.map((s) => {
          const project = state.projects.find((p) => p.sessions.some((x) => x.id === s.id));
          return (
            <button key={s.id} class={`need${state.ui.activeSessionId === s.id ? ' active' : ''}`} data-need={s.id} title={`${s.name}\n${STATUS_LABEL[statusOf(s.id)]}`} onClick={() => void selectSession(s.id)}>
              <StatusIcon status={statusOf(s.id)} />
              <span class="need-text">
                <span class="name">{s.name}</span>
                <span class="sub">{project?.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Rail() {
  const { state } = useStore(app);
  return (
    <nav class="rail" aria-label="Sesiones">
      {state.projects.map((project) => (
        <div class="rail-group" key={project.id} style={project.color ? { '--hilo': project.color } : undefined} title={project.name}>
          {project.sessions.filter((s) => !view.get().closing.includes(s.id)).map((s) => (
            <button
              key={s.id}
              class={`rail-cell${state.ui.activeSessionId === s.id ? ' active' : ''}`}
              data-session={s.id}
              title={`${s.name}\n${STATUS_LABEL[statusOf(s.id)]}`}
              aria-label={`${s.name}: ${STATUS_LABEL[statusOf(s.id)]}`}
              onClick={() => void selectSession(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                view.set({ menu: { x: e.clientX, y: e.clientY, target: { type: 'session', id: s.id } } });
              }}
            >
              <StatusIcon status={displayStatus(s.id)} />
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ narrow }: { narrow: boolean }) {
  const { state } = useStore(app);
  useStore(view);
  const resizing = useRef(false);
  const collapsed = state.ui.sidebarCollapsed || narrow;

  if (collapsed) {
    return (
      <aside class="sidebar is-rail">
        <div class="brand" aria-hidden="true" />
        <Rail />
        <UsageMeter compact />
        <footer class="side-foot rail-foot">
          {!narrow && (
            <button class="icon-btn" title={`Mostrar la barra lateral (${keysOf('toggleSidebar')})`} aria-label="Mostrar la barra lateral" onClick={() => void dispatch({ type: 'ui/sidebar', collapsed: false }).then(focusActive)}>
              <PanelIcon />
            </button>
          )}
          <button class="icon-btn" title={`Ajustes (${keysOf('settings')})`} aria-label="Ajustes" onClick={() => view.set({ modal: { type: 'settings' } })}>
            <GearIcon />
          </button>
        </footer>
      </aside>
    );
  }

  let offset = 0;
  return (
    <aside class="sidebar" style={{ width: `${state.ui.sidebarWidth}px` }}>
      <div class="brand">Hilo</div>
      <div class="tree">
        {state.projects.map((project, i) => {
          const start = offset;
          offset += project.sessions.length;
          return <ProjectBlock key={project.id} project={project} index={i} startIndex={start} />;
        })}
        {state.projects.length > 0 && (
          <button class="add-project" onClick={() => void newProjectFlow().then(focusActive)}>
            <PlusIcon size={13} /> Añadir proyecto
          </button>
        )}
      </div>
      <UsageMeter />
      <NeedsYou />
      <footer class="side-foot">
        <span class="foot-hint" title="Saltar a una sesión">
          {allSessions(state).length > 0 && (
            <>
              <span class="foot-label">Buscar:</span> <kbd>{keysOf('quickOpen')}</kbd>
            </>
          )}
        </span>
        <button class="icon-btn" title={`Solo íconos (${keysOf('toggleSidebar')})`} aria-label="Reducir la barra lateral" onClick={() => void dispatch({ type: 'ui/sidebar', collapsed: true }).then(focusActive)}>
          <PanelIcon />
        </button>
        <button class="icon-btn" title={`Ajustes (${keysOf('settings')})`} aria-label="Ajustes" onClick={() => view.set({ modal: { type: 'settings' } })}>
          <GearIcon />
        </button>
      </footer>
      <div
        class="side-resize"
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(e) => {
          e.preventDefault();
          resizing.current = true;
          const move = (ev: MouseEvent) => {
            if (resizing.current) void dispatch({ type: 'ui/sidebar', width: ev.clientX });
          };
          const up = () => {
            resizing.current = false;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
    </aside>
  );
}


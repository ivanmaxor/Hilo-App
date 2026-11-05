import { changesPaneId, changesProjectOf, isChangesPane, sessionInPane } from './paneContent';
import { insertLeaf, isValidTree, MAX_PANES, presetTree, removeLeaf, type PaneEdge, type PaneNode } from './paneLayout';
import type { Action, LayoutCount, PersistedState, ProjectRecord, SessionRecord, UiState } from './types';

export function findSession(
  state: Pick<PersistedState, 'projects'>,
  id: string,
): { project: ProjectRecord; session: SessionRecord; index: number } | null {
  for (const project of state.projects) {
    const index = project.sessions.findIndex((s) => s.id === id);
    if (index >= 0) return { project, session: project.sessions[index]!, index };
  }
  return null;
}

/** Orden visible: proyectos y sesiones tal como aparecen en la barra. */
export function allSessions(state: Pick<PersistedState, 'projects'>): SessionRecord[] {
  return state.projects.flatMap((p) => p.sessions);
}

function clampMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

function mapSession(state: PersistedState, id: string, fn: (s: SessionRecord) => SessionRecord): PersistedState {
  return {
    ...state,
    projects: state.projects.map((p) =>
      p.sessions.some((s) => s.id === id) ? { ...p, sessions: p.sessions.map((s) => (s.id === id ? fn(s) : s)) } : p,
    ),
  };
}

/**
 * Deja activo un panel. `activeSessionId` solo nombra sesiones; con un panel Cambios no hay sesión activa,
 * y su proyecto es el que se ve en las pestañas.
 */
function focusPane(ui: UiState, pane: number): UiState {
  const content = ui.panes[pane] ?? null;
  const project = changesProjectOf(content);
  return { ...ui, activePane: pane, activeSessionId: sessionInPane(content), ...(project ? { emptyProjectId: project } : {}) };
}

/**
 * Los paneles nuevos nacen vacíos: lo que se muestra lo elige el dueño, nada se abre solo.
 * Al reducir se queda lo que estaba activo, y antes una sesión que un panel vacío.
 */
function resizePanes(ui: UiState, layout: LayoutCount): UiState {
  const activeId = ui.panes[ui.activePane] ?? null;
  let panes = ui.panes.slice();
  if (panes.length > layout) {
    const shown = panes.filter((p): p is string => !!p);
    const ordered = activeId ? [activeId, ...shown.filter((p) => p !== activeId)] : shown;
    const kept = new Set(ordered.slice(0, layout));
    let empties = layout - kept.size;
    panes = panes.filter((p) => {
      if (p) return kept.has(p);
      return empties-- > 0;
    });
  }
  while (panes.length < layout) panes.push(null);
  const at = activeId ? panes.indexOf(activeId) : -1;
  const first = panes.findIndex((p) => !!p);
  const activePane = at >= 0 ? at : first >= 0 && ui.panes.length > layout ? first : Math.min(ui.activePane, layout - 1);
  return focusPane({ ...ui, layout, panes, tree: presetTree(layout) }, activePane);
}

function currentTree(ui: UiState): PaneNode {
  return ui.tree && isValidTree(ui.tree, ui.panes.length) ? ui.tree : presetTree(ui.panes.length);
}

/** Saca un panel de la vista. La sesión sigue como estaba, solo deja de mostrarse. */
function removePane(ui: UiState, pane: number): UiState {
  if (pane < 0 || pane >= ui.panes.length) return ui;
  if (ui.panes.length === 1) {
    // Un panel Cambios solo no tiene adónde ir: queda el selector.
    return isChangesPane(ui.panes[pane]) ? { ...ui, panes: [null], activeSessionId: null } : ui;
  }
  const panes = ui.panes.filter((_, i) => i !== pane);
  const tree = removeLeaf(currentTree(ui), pane) ?? presetTree(panes.length);
  const activePane = ui.activePane > pane ? ui.activePane - 1 : Math.min(ui.activePane, panes.length - 1);
  return focusPane({ ...ui, panes, tree, layout: panes.length as LayoutCount }, activePane);
}

function insertPane(ui: UiState, target: number, edge: PaneEdge, sessionId: string): UiState {
  const targetId = ui.panes[target];
  if (target < 0 || target >= ui.panes.length || !targetId || targetId === sessionId) return ui;
  // Si ya está a la vista es moverla: su sitio viejo se libera antes.
  const from = ui.panes.indexOf(sessionId);
  const base = from >= 0 ? removePane(ui, from) : ui;
  if (base.panes.length >= MAX_PANES) return ui;
  const panes = [...base.panes, sessionId];
  const added = panes.length - 1;
  const tree = insertLeaf(currentTree(base), base.panes.indexOf(targetId), edge, added);
  return focusPane({ ...base, panes, tree, layout: panes.length as LayoutCount }, added);
}

function dropSessionFromUi(state: PersistedState, id: string, neighbours: SessionRecord[] = []): PersistedState {
  const all = allSessions(state);
  // En un panel que no es el activo queda el selector: nada se abre sin pedirlo.
  const panes = state.ui.panes.map((p) => (p === id ? null : p));
  let activeSessionId = state.ui.activeSessionId === id ? null : state.ui.activeSessionId;
  if (activeSessionId === null) {
    activeSessionId = sessionInPane(panes[state.ui.activePane]);
    // Un panel Cambios activo sigue en su sitio: ahí no entra otra sesión.
    if (!panes[state.ui.activePane] && all.length > 0) {
      const free = [...neighbours, ...all].find((s) => !panes.includes(s.id));
      if (free) {
        panes[state.ui.activePane] = free.id;
        activeSessionId = free.id;
      }
    }
  }
  return { ...state, ui: { ...state.ui, panes, activeSessionId, awake: state.ui.awake.filter((x) => x !== id), hiddenTabs: state.ui.hiddenTabs.filter((x) => x !== id) } };
}

/** Sin proyecto no hay nada que comparar: su panel queda a la espera de que se elija otra cosa. */
function dropChangesFromUi(state: PersistedState, projectId: string): PersistedState {
  const id = changesPaneId(projectId);
  if (!state.ui.panes.includes(id)) return state;
  return { ...state, ui: { ...state.ui, panes: state.ui.panes.map((p) => (p === id ? null : p)) } };
}

/** Mostrar una sesión vuelve a abrir su pestaña. */
function reopenTab(ui: UiState, id: string | null): UiState {
  return id && ui.hiddenTabs.includes(id) ? { ...ui, hiddenTabs: ui.hiddenTabs.filter((x) => x !== id) } : ui;
}

/**
 * Cerrar la pestaña solo deja de mostrarla, como en un editor: el proceso y la barra lateral no cambian.
 * En su panel entra la pestaña vecina, y sin vecina queda el selector.
 */
function closeTab(state: PersistedState, id: string): PersistedState {
  const found = findSession(state, id);
  if (!found) return state;
  const { ui } = state;
  const hiddenTabs = ui.hiddenTabs.includes(id) ? ui.hiddenTabs : [...ui.hiddenTabs, id];
  const pane = ui.panes.indexOf(id);
  if (pane < 0) return { ...state, ui: { ...ui, hiddenTabs } };
  const open = found.project.sessions.filter((s) => s.id === id || !hiddenTabs.includes(s.id));
  const at = open.findIndex((s) => s.id === id);
  const candidates = [...open.slice(at + 1), ...open.slice(0, at).reverse()];
  const next = candidates.find((s) => !ui.panes.includes(s.id));
  const panes = ui.panes.slice();
  panes[pane] = next?.id ?? null;
  const activeSessionId = pane === ui.activePane ? (next?.id ?? null) : ui.activeSessionId;
  return { ...state, ui: { ...ui, hiddenTabs, panes, activeSessionId, emptyProjectId: found.project.id } };
}

/** Una sesión lo comprueba quien la dibuja; un panel Cambios necesita que su proyecto siga ahí. */
function contentExists(state: PersistedState, content: string): boolean {
  const project = changesProjectOf(content);
  return project === null || state.projects.some((p) => p.id === project);
}

export function reduce(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'project/add':
      if (state.projects.some((p) => p.id === action.project.id)) return state;
      return { ...state, projects: [...state.projects, action.project] };

    case 'project/rename':
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...p, name: action.name.trim() || p.name } : p)),
      };

    case 'project/color':
      return { ...state, projects: state.projects.map((p) => (p.id === action.id ? { ...p, color: action.color } : p)) };

    case 'project/collapse':
      return {
        ...state,
        projects: state.projects.map((p) => (p.id === action.id ? { ...p, collapsed: action.collapsed } : p)),
      };

    case 'project/remove': {
      const project = state.projects.find((p) => p.id === action.id);
      if (!project) return state;
      let next: PersistedState = { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
      for (const s of project.sessions) next = dropSessionFromUi(next, s.id);
      return dropChangesFromUi(next, project.id);
    }

    case 'project/ide':
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id !== action.id) return p;
          const { ide: _old, ...rest } = p;
          return action.ide ? { ...rest, ide: action.ide } : rest;
        }),
      };

    case 'project/move': {
      const from = state.projects.findIndex((p) => p.id === action.id);
      if (from < 0) return state;
      return { ...state, projects: clampMove(state.projects, from, action.toIndex) };
    }

    case 'session/add': {
      if (!state.projects.some((p) => p.id === action.projectId)) return state;
      // Dos "Deshacer" no pueden dejar dos filas con el mismo id.
      if (findSession(state, action.session.id)) return state;
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id !== action.projectId) return p;
          const sessions = p.sessions.slice();
          sessions.splice(action.index ?? sessions.length, 0, action.session);
          return { ...p, collapsed: false, sessions };
        }),
      };
    }

    case 'session/rename':
      return mapSession(state, action.id, (s) => ({ ...s, name: action.name.trim() || s.name }));

    case 'session/color':
      return mapSession(state, action.id, (s) => ({ ...s, color: action.color }));

    case 'session/remove': {
      // Se sigue en el mismo proyecto: primero la de abajo, después la de arriba.
      const found = findSession(state, action.id);
      const neighbours = found ? [...found.project.sessions.slice(found.index + 1), ...found.project.sessions.slice(0, found.index).reverse()] : [];
      const next: PersistedState = {
        ...state,
        projects: state.projects.map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.id !== action.id) })),
      };
      return dropSessionFromUi(next, action.id, neighbours);
    }

    case 'session/awake': {
      const has = state.ui.awake.includes(action.id);
      if (has === action.awake) return state;
      const awake = action.awake ? [...state.ui.awake, action.id] : state.ui.awake.filter((id) => id !== action.id);
      return { ...state, ui: { ...state.ui, awake } };
    }

    case 'session/claudeId':
      return mapSession(state, action.id, (s) => ({ ...s, claudeId: action.claudeId }));

    case 'session/move': {
      const found = findSession(state, action.id);
      if (!found || !state.projects.some((p) => p.id === action.toProjectId)) return state;
      if (found.project.id === action.toProjectId) {
        return {
          ...state,
          projects: state.projects.map((p) =>
            p.id === found.project.id ? { ...p, sessions: clampMove(p.sessions, found.index, action.toIndex) } : p,
          ),
        };
      }
      return {
        ...state,
        projects: state.projects.map((p) => {
          if (p.id === found.project.id) return { ...p, sessions: p.sessions.filter((s) => s.id !== action.id) };
          if (p.id === action.toProjectId) {
            const sessions = p.sessions.slice();
            sessions.splice(Math.max(0, Math.min(action.toIndex, sessions.length)), 0, found.session);
            return { ...p, sessions };
          }
          return p;
        }),
      };
    }

    case 'ui/select': {
      const { ui } = state;
      if (action.id === null) return { ...state, ui: { ...ui, activeSessionId: null } };
      // Si ya está en otro panel, se enfoca ese panel en vez de duplicarla.
      const existing = ui.panes.indexOf(action.id);
      if (existing >= 0) return { ...state, ui: { ...reopenTab(ui, action.id), activePane: existing, activeSessionId: action.id } };
      const panes = ui.panes.slice();
      // Con un panel esperando, lo elegido va ahí y no le quita el sitio a la que ya se ve.
      let target = panes[ui.activePane] && !action.inPlace ? panes.indexOf(null) : ui.activePane;
      // Se está mirando un panel Cambios: la sesión va a la terminal de al lado, no encima de él.
      if (target < 0 && isChangesPane(panes[ui.activePane])) target = panes.findIndex((p) => !!p && !isChangesPane(p));
      const pane = target >= 0 ? target : ui.activePane;
      panes[pane] = action.id;
      return { ...state, ui: { ...reopenTab(ui, action.id), panes, activePane: pane, activeSessionId: action.id } };
    }

    case 'ui/layout':
      return { ...state, ui: resizePanes(state.ui, action.layout) };

    case 'ui/paneInsert':
      if (!contentExists(state, action.sessionId)) return state;
      return { ...state, ui: reopenTab(insertPane(state.ui, action.pane, action.edge, action.sessionId), action.sessionId) };

    case 'ui/paneRemove':
      return { ...state, ui: removePane(state.ui, action.pane) };

    case 'ui/tree':
      return isValidTree(action.tree, state.ui.panes.length) ? { ...state, ui: { ...state.ui, tree: action.tree } } : state;

    case 'ui/pane': {
      const panes = state.ui.panes.slice();
      if (action.pane < 0 || action.pane >= panes.length) return state;
      if (action.sessionId && !contentExists(state, action.sessionId)) return state;
      const other = action.sessionId ? panes.indexOf(action.sessionId) : -1;
      if (other >= 0 && other !== action.pane) panes[other] = panes[action.pane] ?? null;
      panes[action.pane] = action.sessionId;
      return { ...state, ui: focusPane({ ...reopenTab(state.ui, action.sessionId), panes }, action.pane) };
    }

    case 'ui/tabClose':
      return closeTab(state, action.id);

    case 'ui/activePane': {
      if (action.pane < 0 || action.pane >= state.ui.panes.length) return state;
      return { ...state, ui: focusPane(state.ui, action.pane) };
    }

    case 'ui/sidebar':
      return {
        ...state,
        ui: {
          ...state.ui,
          sidebarWidth: action.width !== undefined ? Math.max(180, Math.min(420, action.width)) : state.ui.sidebarWidth,
          sidebarCollapsed: action.collapsed ?? state.ui.sidebarCollapsed,
        },
      };

    case 'settings/set':
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case 'window/bounds':
      return { ...state, window: action.bounds };
  }
}

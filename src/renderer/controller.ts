import type { PlanUsage } from '../shared/usage';
import type { ToolCheck } from '../shared/types';
import { changesPaneId, sessionInPane } from '../shared/paneContent';
import { MAX_PANES, paneInDirection, presetTree } from '../shared/paneLayout';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { STATUS_PRIORITY } from '../shared/statusMachine';
import { allSessions, findSession } from '../shared/reducer';
import { buildKeymap, eventToKeys, isModifierOnly, prettyKeys, SHORTCUTS } from '../shared/shortcuts';
import type {
  Action,
  AppInfo,
  BackgroundProcess,
  LayoutCount,
  PersistedState,
  ProjectRecord,
  RuntimeMap,
  SessionKind,
  SessionRecord,
  SessionStatus,
} from '../shared/types';
import type { UpdateStatus } from '../shared/updates';
import { api } from './api';
import { TerminalManager } from './term/terminals';

export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: Partial<T>) {
      value = { ...value, ...next };
      for (const fn of listeners) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: { get(): T; subscribe(fn: () => void): () => unknown }): T {
  const [, force] = useState(0);
  const rendered = store.get();
  useEffect(() => {
    // Lo que cambió entre dibujar y suscribirse no llega por subscribe.
    if (store.get() !== rendered) force((n) => n + 1);
    const unsubscribe = store.subscribe(() => force((n) => n + 1));
    return () => void unsubscribe();
  }, [store]);
  return store.get();
}

export type Modal =
  | { type: 'newSession'; kind: SessionKind; projectId: string | null }
  | { type: 'settings'; section?: string }
  | { type: 'quick' }
  | { type: 'setup'; tools: ToolCheck }
  /** Elegir el IDE de un proyecto. Si se venía a abrir algo, se abre después de elegir. */
  | { type: 'ide'; projectId: string; file: string | null; line: number | null }
  | { type: 'confirm'; title: string; body: string; ok: string; danger: boolean; list?: string[]; resolve(ok: boolean): void };

export interface MenuState {
  x: number;
  y: number;
  target: { type: 'session'; id: string } | { type: 'project'; id: string };
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run(): void };
  /** No se va sola: la cierra la persona. */
  sticky?: boolean;
}

export const app = createStore<{ state: PersistedState; runtime: RuntimeMap; info: AppInfo }>(
  null as unknown as { state: PersistedState; runtime: RuntimeMap; info: AppInfo },
);

export const view = createStore<{
  modal: Modal | null;
  menu: MenuState | null;
  renaming: string | null;
  toasts: Toast[];
  searchOpen: boolean;
  focused: boolean;
  ctrlHeld: boolean;
  /** Sesiones con una operación en curso (dormir): se muestra que algo está pasando. */
  busy: string[];
  /** Cerrándose: desaparecen enseguida, aunque el proceso aún no se haya comprobado. */
  closing: string[];
  update: UpdateStatus;
}>({ modal: null, menu: null, renaming: null, toasts: [], searchOpen: false, focused: true, ctrlHeld: false, busy: [], closing: [], update: { state: 'idle' } });

export let terminals: TerminalManager;

let toastSeq = 1;
export function toast(text: string, action?: Toast['action']): void {
  const id = toastSeq++;
  view.set({ toasts: [...view.get().toasts, action ? { id, text, action } : { id, text }] });
  setTimeout(() => dismissToast(id), action ? 8000 : 6000);
}
export function dismissToast(id: number): void {
  view.set({ toasts: view.get().toasts.filter((t) => t.id !== id) });
}

let updateToast: number | null = null;
let announcedVersion: string | null = null;

/** La búsqueda al abrir encontró algo: se avisa sin quitar el foco y sin irse, y se decide en Ajustes. */
function onUpdateStatus(status: UpdateStatus): void {
  view.set({ update: status });
  if (status.state === 'available' && status.auto && announcedVersion !== status.version) {
    announcedVersion = status.version;
    const id = toastSeq++;
    updateToast = id;
    view.set({
      toasts: [
        ...view.get().toasts,
        { id, text: `Hay una versión nueva de Hilo: ${status.version}.`, sticky: true, action: { label: 'Ver', run: () => view.set({ modal: { type: 'settings', section: 'updates' }, menu: null }) } },
      ],
    });
  } else if (status.state !== 'available' && updateToast !== null) {
    dismissToast(updateToast);
    updateToast = null;
  }
}

export const dispatch = (action: Action): Promise<void> => api.dispatch(action);
export const statusOf = (id: string): SessionStatus => app.get().runtime[id]?.status ?? 'asleep';
export const subagentsOf = (id: string): number => app.get().runtime[id]?.subagents ?? 0;
/** Lo que se dibuja: durante una operación en curso, el ícono de "arrancando". */
export const displayStatus = (id: string): SessionStatus => (view.get().busy.includes(id) ? 'starting' : statusOf(id));

/** La combinación vigente de una acción, para mostrarla en textos y tooltips. */
export function keysOf(action: string): string {
  const { shortcuts } = app.get().state.settings;
  const def = SHORTCUTS.find((s) => s.id === action);
  return prettyKeys(shortcuts[action] ?? def?.defaultKeys ?? '');
}

export function activeProject(): ProjectRecord | null {
  const { state } = app.get();
  const id = state.ui.activeSessionId;
  const found = id ? findSession(state, id) : null;
  return found?.project ?? state.projects.find((p) => p.id === state.ui.emptyProjectId) ?? state.projects[0] ?? null;
}

/** En la barra si la fila está a la vista; si el proyecto está colapsado o en modo riel, en la pestaña. */
export function startRename(id: string): void {
  const inRow = document.querySelector(`.row[data-session="${id}"]`);
  if (inRow) {
    view.set({ renaming: id });
    return;
  }
  const open = () => view.set({ renaming: `tab:${id}` });
  if (document.querySelector(`[data-tab="${id}"]`)) open();
  // En el riel, una sesión de otro proyecto no tiene ni fila ni pestaña: primero se va a ella.
  else void dispatch({ type: 'ui/select', id }).then(() => requestAnimationFrame(open));
}

export function focusActive(): void {
  requestAnimationFrame(() => {
    // Si mientras tanto se abrió un diálogo o un campo de nombre, no se le quita el foco.
    const v = view.get();
    if (v.modal || v.menu) return;
    if (v.renaming) {
      // Un nombre que nunca llegó a abrir su campo no puede dejar la app sin foco.
      if (document.querySelector('input.rename')) return;
      view.set({ renaming: null });
    }
    const { activeSessionId: id, activePane } = app.get().state.ui;
    if (v.searchOpen) {
      const field = document.querySelector<HTMLInputElement>('.searchbar input');
      if (field) {
        // Quien hizo clic en la terminal para seguir escribiendo ahí se queda.
        if (!id || !terminals.hasFocus(id)) field.focus();
        return;
      }
      view.set({ searchOpen: false });
    }
    // Un panel Cambios no recibe texto: el foco queda en él para moverse con el teclado, sin quitárselo a lo que ya lo tenga dentro.
    const changes = document.querySelector<HTMLElement>(`[data-pane="${activePane}"] .changes`);
    if (changes) {
      if (!changes.contains(document.activeElement)) changes.focus();
      return;
    }
    // Sin proceso, lo que se escriba se perdería: el foco va al botón que lo resuelve.
    const button =
      document.querySelector<HTMLElement>(`[data-pane="${activePane}"] .overlay button.primary`) ??
      document.querySelector<HTMLElement>(`[data-pane="${activePane}"] .picker button`) ??
      document.querySelector<HTMLElement>('.empty button.primary');
    if (button) button.focus();
    else if (id) terminals.focus(id);
  });
}

function publishView(): void {
  const { state } = app.get();
  api.setView(state.ui.panes.map(sessionInPane).filter((p): p is string => !!p), view.get().focused);
}

export async function wakeSession(id: string): Promise<void> {
  const found = findSession(app.get().state, id);
  if (!found) return;
  const status = statusOf(id);
  if (status === 'error' || status === 'exited') terminals.dispose(id);
  await terminals.wake(id, found.session.kind);
}

let pendingWake: { timer: ReturnType<typeof setTimeout>; id: string } | null = null;

/** Un doble clic para renombrar no debe arrancar un Claude. */
export function cancelPendingWake(): void {
  if (pendingWake) clearTimeout(pendingWake.timer);
  pendingWake = null;
}

/**
 * Se teclea o se pega antes de que venza la espera del doble clic: es que la sesión se
 * quiere ya. Se despierta en el acto y esa tecla no se pierde.
 */
const isPasteKeys = (keys: string) => keys === 'Ctrl+V' || keys === 'Ctrl+Shift+V' || keys === 'Shift+Insert';

const SWALLOW_ENTER_MS = 1500;
let lastSwallowedAt = 0;
const ONCE_TOAST_MS = 6000;
let onceToastUntil = 0;

/** Un solo aviso aunque se sigan pulsando teclas. */
function toastOnce(text: string): void {
  const now = Date.now();
  if (now <= onceToastUntil) return;
  onceToastUntil = now + ONCE_TOAST_MS;
  toast(text);
}

/**
 * Red de seguridad: con el foco en ninguna parte (una terminal que se está montando, un diálogo que se
 * acaba de cerrar), lo que se escribe es para la sesión activa, no para el vacío.
 */
function inputWithoutFocus(event: KeyboardEvent): boolean {
  if (document.activeElement && document.activeElement !== document.body) return false;
  const v = view.get();
  const id = app.get().state.ui.activeSessionId;
  if (v.modal || v.menu || v.renaming || !id || !terminals.has(id)) return false;
  const status = statusOf(id);
  if (status === 'asleep' || status === 'error' || status === 'exited') return false;
  const isPaste = isPasteKeys(eventToKeys(event));
  const text = event.key === 'Enter' ? '\r' : event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey ? event.key : null;
  if (!isPaste && text === null) return false;
  event.preventDefault();
  event.stopPropagation();
  terminals.focus(id);
  if (isPaste) void terminals.pasteInto(id);
  else terminals.typeInto(id, text!);
  return true;
}

/** Lo que se tecleó mientras se cerraba otra: a la que quedó, aunque esté dormida. */
async function deliverToActive(held: (string | null)[], id: string | null): Promise<void> {
  if (!held.length) return;
  const typed = held.some((item) => item === null || !item.startsWith('\x1b'));
  const status = id ? statusOf(id) : null;
  if (id && typed && status === 'asleep') {
    if (app.get().state.settings.wakeOnSelect) wakeAndFocus(id);
    else toast('Lo que escribiste no llegó: la sesión está dormida.');
  } else if (typed && (status === 'error' || status === 'exited')) {
    toast('Lo que escribiste no llegó: esa terminal ya no tiene proceso.');
    return;
  } else if (typed && !id) {
    toast('Lo que escribiste no llegó: ya no hay ninguna sesión abierta.');
  }
  await terminals.deliverHeld(held, id);
}

/** Despierta y deja la terminal lista para recibir: lo tecleado desde ahora espera en su cola. */
function wakeAndFocus(id: string): void {
  void wakeSession(id).then(focusActive);
  terminals.focus(id);
}

/**
 * Sobre una sesión activa dormida o terminada no hay terminal escuchando: ni Ctrl+V ni lo que se
 * escriba pueden perderse sin más. Con "Despertar al seleccionar", la despierta y le llega.
 * Espacio y Enter no entran aquí: son del botón que tiene el foco.
 */
function inputOnAsleep(event: KeyboardEvent): boolean {
  if (event.repeat) return false;
  const v = view.get();
  const tag = document.activeElement?.tagName;
  if (v.modal || v.menu || v.renaming || tag === 'INPUT' || tag === 'TEXTAREA') return false;
  const id = app.get().state.ui.activeSessionId;
  if (!id || terminals.hasFocus(id)) return false;
  const isPaste = isPasteKeys(eventToKeys(event));
  const text = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey ? event.key : null;
  // El Enter de una frase que no llegó no es para el botón: dispararía justo lo que se avisó.
  if (event.key === 'Enter' && Date.now() - lastSwallowedAt < SWALLOW_ENTER_MS) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (!isPaste && text === null) return false;
  const status = statusOf(id);
  if (status === 'error' || status === 'exited') {
    lastSwallowedAt = Date.now();
    // Ni letras ni Espacio pulsan el botón: el resto de la frase se ejecutaría en el proceso nuevo.
    event.preventDefault();
    event.stopPropagation();
    toastOnce('Esta terminal ya no tiene proceso: pulsa Enter para abrirla de nuevo.');
    return true;
  }
  if (status !== 'asleep') return false;
  event.preventDefault();
  event.stopPropagation();
  if (!app.get().state.settings.wakeOnSelect) {
    lastSwallowedAt = Date.now();
    toastOnce('Esta sesión está dormida: pulsa Enter para despertarla.');
    return true;
  }
  wakeAndFocus(id);
  if (isPaste) void terminals.pasteInto(id);
  else terminals.typeInto(id, text!);
  return true;
}

/** La tecla de menú o Mayús+F10: el menú de la sesión activa, que se maneja con flechas. */
function openMenuFromKeyboard(event: KeyboardEvent): boolean {
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return false;
  const v = view.get();
  const id = app.get().state.ui.activeSessionId;
  if (v.modal || v.menu || v.renaming || !id) return false;
  event.preventDefault();
  event.stopPropagation();
  const anchor = document.querySelector(`.row[data-session="${id}"]`) ?? document.querySelector(`[data-tab="${id}"]`);
  const box = anchor?.getBoundingClientRect();
  // Una pestaña desplazada puede estar fuera de la ventana.
  view.set({ menu: { x: box ? Math.max(8, box.left + 12) : 60, y: box ? Math.max(8, box.bottom) : 60, target: { type: 'session', id } } });
  return true;
}

function keyDuringPendingWake(event: KeyboardEvent): boolean {
  if (!pendingWake || view.get().modal || view.get().renaming) return false;
  const { id } = pendingWake;
  cancelPendingWake();
  const keys = eventToKeys(event);
  const isPaste = isPasteKeys(keys);
  const text = event.key === 'Enter' ? '\r' : event.key.length === 1 && !event.ctrlKey && !event.altKey ? event.key : null;
  wakeAndFocus(id);
  if (isPaste) void terminals.pasteInto(id);
  else if (text) terminals.typeInto(id, text);
  if (!isPaste && !text) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export async function selectSession(id: string, opts: { delayWake?: boolean } = {}): Promise<void> {
  cancelPendingWake();
  await dispatch({ type: 'ui/select', id });
  const { settings } = app.get().state;
  if (statusOf(id) === 'asleep' && settings.wakeOnSelect) {
    if (opts.delayWake) {
      pendingWake = {
        id,
        timer: setTimeout(() => {
          pendingWake = null;
          if (statusOf(id) === 'asleep' && !view.get().renaming) void wakeSession(id).then(focusActive);
        }, 260),
      };
      return;
    }
    await wakeSession(id);
  }
  focusActive();
}

export function confirmDialog(opts: { title: string; body: string; ok: string; danger?: boolean; list?: string[] }): Promise<boolean> {
  return new Promise((resolve) => {
    const modal: Modal = { type: 'confirm', title: opts.title, body: opts.body, ok: opts.ok, danger: opts.danger ?? false, resolve };
    if (opts.list) modal.list = opts.list;
    view.set({ modal, menu: null });
  });
}

function backgroundList(procs: BackgroundProcess[]): string[] {
  const counts = new Map<string, number>();
  for (const p of procs) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} (${n})` : name));
}

const WORKING_MESSAGE = 'Esta sesión está trabajando. Podrás dormirla cuando termine.';

/** Una sesión sin proceso, con el proceso ya dormido: su terminal ya no sirve. Si se está despertando, es de la nueva. */
function disposeIfAsleep(id: string): void {
  if (statusOf(id) === 'asleep' && !terminals.isWaking(id)) terminals.dispose(id);
}

function closeSearchOf(id: string): void {
  if (view.get().searchOpen && app.get().state.ui.activeSessionId === id) view.set({ searchOpen: false });
}

/** Lo mismo para dormir y cerrar: lo que hay corriendo se pierde, y hay que decirlo. Devuelve si se sigue. */
async function confirmBackground(id: string, verb: { title: string; ok: string; okUnknown: string; unknown: string }): Promise<boolean> {
  const procs = await api.background(id);
  if (procs === null) {
    return confirmDialog({ title: 'No se pudo comprobar qué procesos tiene', body: verb.unknown, ok: verb.okUnknown, danger: true });
  }
  if (procs.length === 0) return true;
  const kind = findSession(app.get().state, id)?.session.kind;
  return confirmDialog({
    title: verb.title,
    body: kind === 'shell' ? 'Esta terminal tiene estos procesos corriendo y se cerrarán:' : 'Claude lanzó estos procesos en segundo plano y se cerrarán:',
    list: backgroundList(procs),
    ok: verb.ok,
    danger: true,
  });
}

function setBusy(id: string, on: boolean): void {
  const busy = view.get().busy.filter((x) => x !== id);
  view.set({ busy: on ? [...busy, id] : busy });
}

export async function sleepSession(id: string): Promise<void> {
  const status = statusOf(id);
  if (status === 'asleep' || view.get().busy.includes(id)) return;
  if (status === 'working') {
    toast(WORKING_MESSAGE);
    return;
  }
  setBusy(id, true);
  try {
    if (status !== 'error' && status !== 'exited') {
      const go = await confirmBackground(id, {
        title: 'Dormir esta sesión cierra sus procesos',
        ok: 'Dormir y cerrarlos',
        okUnknown: 'Dormir de todos modos',
        unknown: 'Si hay algo corriendo en segundo plano, se cerrará al dormir la sesión.',
      });
      if (!go) return;
      // Pudo haber empezado a trabajar mientras se comprobaba o el diálogo estaba abierto.
      if (statusOf(id) === 'working') {
        toast(WORKING_MESSAGE);
        return;
      }
    }
    const slept = await api.sleep(id);
    if (slept) {
      // Con proceso, la terminal ya se fue con su salida. Esto es para las que no tenían.
      disposeIfAsleep(id);
      closeSearchOf(id);
    } else toast(WORKING_MESSAGE);
  } finally {
    setBusy(id, false);
    focusActive();
  }
}

export async function toggleSleep(id: string): Promise<void> {
  if (statusOf(id) === 'asleep') await wakeSession(id);
  else await sleepSession(id);
}

/** La que queda al cerrar: primero la de abajo en el proyecto, después la de arriba, después otra. */
function neighbourOf(id: string): string | null {
  const { state } = app.get();
  const found = findSession(state, id);
  if (!found) return null;
  const { sessions } = found.project;
  const closing = view.get().closing;
  const usable = (s: SessionRecord) => s.id !== id && !closing.includes(s.id);
  const near = [...sessions.slice(found.index + 1), ...sessions.slice(0, found.index).reverse()];
  const free = (s: SessionRecord) => usable(s) && !state.ui.panes.includes(s.id);
  // En vista dividida, mejor una que no esté ya en otro panel: el suyo no queda vacío.
  return (near.find(free) ?? allSessions(state).find(free) ?? near.find(usable) ?? allSessions(state).find(usable))?.id ?? null;
}

function setClosing(id: string, on: boolean): void {
  const closing = view.get().closing.filter((x) => x !== id);
  view.set({ closing: on ? [...closing, id] : closing });
}

/** Sesiones avisadas de que tienen procesos: volver a cerrarlas ahora sí las cierra. */
const closeWarned = new Map<string, { until: number; from: string | null }>();
/**
 * Un segundo atajo mientras se comprueba el primero no sabe todavía qué pasó, y podría cerrar la vecina
 * por error: se ignora. Dura lo que una foto de procesos, y pulsarlo otra vez no cuesta nada.
 */
let closeChecks = 0;
const CLOSE_DOUBLE_PRESS_MS = 800;
let lastCloseKeyAt = 0;
let lastCloseWarningAt = 0;
/** Cuanto dura repetir el atajo como respuesta. Después, el atajo vuelve a ser para lo que se está viendo. */
const CLOSE_WARNING_MS = 4000;

/**
 * Comprobar los procesos tarda lo que una foto de procesos, y mientras tanto la vista ya pasó a la
 * vecina y se puede estar escribiendo ahí. Por eso el aviso no es un diálogo: un diálogo que salta le
 * quitaría el foco a media frase. Si hay procesos la sesión sigue abierta, que es lo seguro.
 */
async function closeWithCheck(id: string, name: string, wasActive: boolean): Promise<boolean> {
  closeChecks++;
  try {
    return await runCloseCheck(id, name, wasActive);
  } finally {
    closeChecks--;
  }
}

async function runCloseCheck(id: string, name: string, wasActive: boolean): Promise<boolean> {
  setClosing(id, true);
  closeSearchOf(id);
  let next: string | null = null;
  if (wasActive) {
    terminals.holdInput(id);
    next = neighbourOf(id);
    if (next) {
      // La vecina ocupa el sitio de la que se cierra, aunque haya otro panel esperando.
      await dispatch({ type: 'ui/select', id: next, inPlace: true });
      focusActive();
      // Lo que llegó en este instante se entrega ya: lo siguiente irá directo y no se cruzan.
      const early = terminals.takeHeld(id);
      terminals.holdInput(id);
      await deliverToActive(early, next);
    }
  }
  let problem: string | null = null;
  try {
    const procs = await api.background(id);
    if (procs === null) problem = 'no se pudo comprobar qué procesos tiene';
    else if (procs.length > 0) problem = `tiene procesos corriendo (${backgroundList(procs).join(', ')})`;
    else if (statusOf(id) === 'working') problem = 'empezó a trabajar';
  } catch (err) {
    console.error('[cerrar]', err);
    problem = 'no se pudo comprobar qué procesos tiene';
  }
  if (!problem) return true;
  const held = terminals.takeHeld(id);
  setClosing(id, false);
  lastCloseWarningAt = Date.now();
  closeWarned.set(id, { until: Date.now() + CLOSE_WARNING_MS, from: next ?? (wasActive ? id : app.get().state.ui.activeSessionId) });
  toast(`«${name}» sigue abierta: ${problem}. ${keysOf('closeSession')} otra vez la termina.`, {
    label: 'Cerrar y terminarla',
    run: () => void closeSession(id, true),
  });
  if (!next && wasActive) focusActive();
  await deliverToActive(held, next ?? id);
  return false;
}

export async function closeSession(id: string, force = false): Promise<void> {
  const found = findSession(app.get().state, id);
  if (!found || view.get().busy.includes(id) || view.get().closing.includes(id)) return;
  const wasActive = app.get().state.ui.activeSessionId === id;
  const warned = (closeWarned.get(id)?.until ?? 0) > Date.now();
  closeWarned.delete(id);
  const status = statusOf(id);
  if (status === 'working') {
    const ok = await confirmDialog({
      title: `«${found.session.name}» está trabajando`,
      body: 'Si la cierras, Claude se interrumpe.',
      ok: 'Cerrar de todos modos',
      danger: true,
    });
    focusActive();
    if (!ok) return;
  } else if (!force && !warned && status !== 'asleep' && status !== 'error' && status !== 'exited') {
    if (!(await closeWithCheck(id, found.session.name, wasActive))) return;
  }
  // Mientras se comprobaba pudo cerrarse por otro lado, o Claude pudo cambiar de conversación.
  const current = findSession(app.get().state, id);
  if (!current) {
    setClosing(id, false);
    return;
  }
  const { session, project, index } = current;
  const held = terminals.takeHeld(id);
  closeSearchOf(id);
  await api.removeSession(id);
  setClosing(id, false);
  focusActive();
  await deliverToActive(held, app.get().state.ui.activeSessionId);
  toast(`Se cerró «${session.name}».`, {
    label: 'Deshacer',
    run: () => {
      const home = app.get().state.projects.find((p) => p.id === project.id);
      if (!home) {
        toast(`No se pudo deshacer: el proyecto «${project.name}» ya no está.`);
        focusActive();
        return;
      }
      void dispatch({ type: 'session/add', projectId: project.id, session, index }).then(() => {
        if (wasActive) void selectSession(id);
        else focusActive();
      });
    },
  });
}

/** La X de la pestaña: deja de mostrarla. La sesión sigue en la barra lateral, con su proceso. */
export async function closeTab(id: string): Promise<void> {
  closeSearchOf(id);
  await dispatch({ type: 'ui/tabClose', id });
  focusActive();
}

/** Desde un menú o un botón no hay nada a medio escribir: aquí sí se puede preguntar. */
export async function confirmCloseSession(id: string): Promise<void> {
  const found = findSession(app.get().state, id);
  if (!found) return;
  // Si está trabajando, closeSession ya pregunta.
  if (statusOf(id) !== 'working') {
    const ok = await confirmDialog({
      title: `¿Cerrar «${found.session.name}»?`,
      body: 'Se detiene y sale de la lista de sesiones. La conversación queda guardada por Claude, pero para volver a ella necesitarás retomarla.',
      ok: 'Cerrar sesión',
      danger: true,
    });
    focusActive();
    if (!ok) return;
  }
  await closeSession(id);
}

export async function addProjectFromFolder(): Promise<ProjectRecord | null> {
  const path = await api.pickFolder();
  if (!path) return null;
  const existing = app.get().state.projects.find((p) => p.path.toLowerCase() === path.toLowerCase());
  if (existing) return existing;
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const project: ProjectRecord = { id: crypto.randomUUID(), name, path, color: null, collapsed: false, sessions: [] };
  await dispatch({ type: 'project/add', project });
  return project;
}

export async function newProjectFlow(): Promise<void> {
  const project = await addProjectFromFolder();
  if (project) view.set({ modal: { type: 'newSession', kind: 'claude', projectId: project.id } });
}

export interface NewSessionInput {
  projectId: string;
  kind: SessionKind;
  name: string;
  color: string | null;
  model?: string;
  effort?: string;
}

export async function createSession(input: NewSessionInput): Promise<void> {
  const project = app.get().state.projects.find((p) => p.id === input.projectId);
  if (!project) return;
  const id = crypto.randomUUID();
  const session: SessionRecord = {
    id,
    claudeId: id,
    kind: input.kind,
    name: input.name,
    color: input.color,
    cwd: project.path,
    createdAt: Date.now(),
  };
  if (input.model) session.model = input.model;
  if (input.effort) session.effort = input.effort;
  await dispatch({ type: 'session/add', projectId: project.id, session });
  await dispatch({ type: 'ui/select', id });
  await wakeSession(id);
  focusActive();
}

export function defaultSessionName(project: ProjectRecord | null, kind: SessionKind): string {
  const base = kind === 'shell' ? 'PowerShell' : 'Sesión';
  const used = new Set((project?.sessions ?? []).map((s) => s.name));
  if (!used.has(base) && kind === 'shell') return base;
  for (let n = kind === 'shell' ? 2 : 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

export async function createShellQuick(): Promise<void> {
  const project = activeProject();
  if (!project) {
    await newProjectFlow();
    return;
  }
  await createSession({ projectId: project.id, kind: 'shell', name: defaultSessionName(project, 'shell'), color: null });
}

function cycle(delta: number): void {
  const { state } = app.get();
  const all = allSessions(state).filter((s) => !view.get().closing.includes(s.id));
  // Ciclar no despierta nada: pasa por las que están vivas.
  const awake = all.filter((s) => statusOf(s.id) !== 'asleep');
  const list = awake.length ? awake : all;
  if (!list.length) return;
  const at = list.findIndex((s) => s.id === state.ui.activeSessionId);
  const next = list[(at + delta + list.length) % list.length]!;
  void selectSession(next.id);
}

export function attentionSessions(): SessionRecord[] {
  const { state } = app.get();
  return allSessions(state)
    .filter((s) => ['waiting', 'error', 'done'].includes(statusOf(s.id)))
    .sort((a, b) => STATUS_PRIORITY[statusOf(a.id)] - STATUS_PRIORITY[statusOf(b.id)]);
}

function goNextAttention(): void {
  const list = attentionSessions();
  if (!list.length) {
    toast('Ninguna sesión requiere atención.');
    return;
  }
  const active = app.get().state.ui.activeSessionId;
  const at = list.findIndex((s) => s.id === active);
  void selectSession(list[(at + 1) % list.length]!.id);
}

function setFontSize(size: number): void {
  void dispatch({ type: 'settings/set', patch: { fontSize: Math.max(9, Math.min(32, size)) } });
}

function movePane(dx: number, dy: number): void {
  const { ui } = app.get().state;
  if (ui.panes.length <= 1) return;
  const pane = paneInDirection(ui.tree ?? presetTree(ui.panes.length), ui.activePane, dx, dy);
  void dispatch({ type: 'ui/activePane', pane }).then(focusActive);
}

/** Muestra el panel Cambios del proyecto junto a lo que se está viendo, o lo quita si ya está a la vista. */
export async function toggleChanges(projectId?: string): Promise<void> {
  const { ui, projects } = app.get().state;
  const project = projects.find((p) => p.id === projectId) ?? activeProject();
  if (!project) return;
  const id = changesPaneId(project.id);
  const at = ui.panes.indexOf(id);
  if (at >= 0) {
    await dispatch({ type: 'ui/paneRemove', pane: at });
  } else if (ui.panes.includes(null)) {
    await dispatch({ type: 'ui/pane', pane: ui.panes.indexOf(null), sessionId: id });
  } else if (ui.panes.length >= MAX_PANES) {
    toast(`Ya hay ${MAX_PANES} paneles: quita uno para ver los cambios.`);
    return;
  } else {
    await dispatch({ type: 'ui/paneInsert', pane: ui.activePane, edge: 'right', sessionId: id });
  }
  focusActive();
}

/** Abre el proyecto o un archivo en el IDE del proyecto. Sin IDE elegido, primero lo pregunta. */
export async function openInIde(projectId: string, file: string | null = null, line: number | null = null): Promise<void> {
  const project = app.get().state.projects.find((p) => p.id === projectId);
  if (!project) return;
  if (!project.ide) {
    view.set({ modal: { type: 'ide', projectId, file, line }, menu: null });
    return;
  }
  const result = await api.ideOpen(projectId, file, line);
  if (!result.ok) {
    toast(result.message);
    if (result.reason === 'missing') view.set({ modal: { type: 'ide', projectId, file, line }, menu: null });
    return;
  }
  // Lo dice para que no se busque la línea donde no llegó: Visual Studio y Eclipse solo abren el archivo.
  if (line && !result.jumped) toast(`${project.ide.name} abrió el archivo, pero no permite pedirle que vaya a una línea. Es la línea ${line}.`);
}

export function runCommand(action: string): void {
  const { state } = app.get();
  const active = state.ui.activeSessionId;
  switch (action) {
    case 'newClaude':
      if (!state.projects.length) void newProjectFlow();
      else view.set({ modal: { type: 'newSession', kind: 'claude', projectId: activeProject()?.id ?? null } });
      return;
    case 'newShell':
      void createShellQuick();
      return;
    case 'newProject':
      void newProjectFlow();
      return;
    case 'closeSession': {
      // Una doble pulsación sin querer no cierra dos, y repetir nada más salir el aviso no lo responde.
      const pressedAt = Date.now();
      if (closeChecks > 0 || pressedAt - lastCloseKeyAt < CLOSE_DOUBLE_PRESS_MS || pressedAt - lastCloseWarningAt < CLOSE_DOUBLE_PRESS_MS) return;
      lastCloseKeyAt = pressedAt;
      // Tras el aviso la vista ya está en la vecina: repetir el atajo es para la avisada.
      const now = Date.now();
      // Si ya se fue a otra sesión, el atajo vuelve a ser para esa.
      const warned = [...closeWarned].find(([, w]) => w.until > now && w.from === active)?.[0];
      const target = warned ?? active;
      if (target) void closeSession(target);
      return;
    }
    case 'rename':
      if (active) startRename(active);
      else toast('No hay ninguna sesión abierta.');
      return;
    case 'toggleSleep':
      if (active) void toggleSleep(active);
      return;
    case 'quickOpen':
      view.set({ modal: { type: 'quick' } });
      return;
    case 'nextSession':
      cycle(1);
      return;
    case 'prevSession':
      cycle(-1);
      return;
    case 'nextAttention':
      goNextAttention();
      return;
    case 'search':
      if (view.get().searchOpen) {
        const field = document.querySelector<HTMLInputElement>('.searchbar input');
        field?.focus();
        field?.select();
      }
      else if (active && terminals.has(active)) view.set({ searchOpen: true });
      else if (active) toast('Despierta la sesión para buscar.');
      return;
    case 'toggleChanges':
      void toggleChanges();
      return;
    case 'copyJoined':
      if (active) void terminals.copyJoined(active);
      return;
    case 'zoomIn':
      setFontSize(state.settings.fontSize + 1);
      return;
    case 'zoomOut':
      setFontSize(state.settings.fontSize - 1);
      return;
    case 'zoomReset':
      setFontSize(DEFAULT_SETTINGS.fontSize);
      return;
    case 'toggleSidebar':
      void dispatch({ type: 'ui/sidebar', collapsed: !state.ui.sidebarCollapsed });
      return;
    case 'layout1':
    case 'layout2':
    case 'layout3':
    case 'layout4':
      void dispatch({ type: 'ui/layout', layout: Number(action.slice(6)) as LayoutCount }).then(focusActive);
      return;
    case 'paneLeft':
      movePane(-1, 0);
      return;
    case 'paneRight':
      movePane(1, 0);
      return;
    case 'paneUp':
      movePane(0, -1);
      return;
    case 'paneDown':
      movePane(0, 1);
      return;
    case 'settings':
      view.set({ modal: { type: 'settings' } });
      return;
    case 'fullscreen':
      api.toggleFullscreen();
      return;
    default:
      if (/^go[1-9]$/.test(action)) {
        const target = allSessions(state).filter((s) => !view.get().closing.includes(s.id))[Number(action.slice(2)) - 1];
        if (target) void selectSession(target.id);
      }
  }
}

/** Lo único que tiene sentido repetir manteniendo pulsado. */
const REPEATABLE = new Set(['zoomIn', 'zoomOut', 'nextSession', 'prevSession', 'paneLeft', 'paneRight', 'paneUp', 'paneDown']);

function installKeyboard(): void {
  let keymap = buildKeymap(app.get().state.settings.shortcuts);
  let prev = app.get().state.settings.shortcuts;
  app.subscribe(() => {
    const next = app.get().state.settings.shortcuts;
    if (next !== prev) {
      prev = next;
      keymap = buildKeymap(next);
    }
  });
  // Los números de las sesiones salen solo si se mantiene Ctrl: con Ctrl+C y Ctrl+V todo el día
  // la barra no debe parpadear.
  let ctrlTimer: ReturnType<typeof setTimeout> | null = null;
  const stopCtrl = () => {
    if (ctrlTimer) clearTimeout(ctrlTimer);
    ctrlTimer = null;
    if (view.get().ctrlHeld) view.set({ ctrlHeld: false });
  };
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Control' && !event.repeat) {
        stopCtrl();
        ctrlTimer = setTimeout(() => view.set({ ctrlHeld: true }), 500);
      } else if (event.key !== 'Control') {
        stopCtrl();
      }
      if (isModifierOnly(event)) return;
      if (keyDuringPendingWake(event)) return;
      if (view.get().modal) return;
      // Con la barra a la vista, Esc la cierra aunque el foco esté en la terminal: no debe interrumpir a Claude.
      if (event.key === 'Escape' && view.get().searchOpen && !view.get().menu && !view.get().renaming) {
        event.preventDefault();
        event.stopPropagation();
        // Ya, no en el siguiente cuadro: la tecla que venga detrás es para la terminal.
        const active = app.get().state.ui.activeSessionId;
        if (active) terminals.focus(active);
        view.set({ searchOpen: false });
        focusActive();
        return;
      }
      if (inputOnAsleep(event) || inputWithoutFocus(event) || openMenuFromKeyboard(event)) return;
      const action = keymap.get(eventToKeys(event));
      if (!action) return;
      // En un campo de texto, Ctrl+Shift+Z es rehacer: no debe dormir la sesión.
      const tag = document.activeElement?.tagName;
      const inField = tag === 'INPUT' || (tag === 'TEXTAREA' && !document.activeElement?.classList.contains('xterm-helper-textarea'));
      if (inField && action === 'toggleSleep') return;
      event.preventDefault();
      event.stopPropagation();
      // Mantener pulsado un atajo no puede cerrar una sesión tras otra.
      if (event.repeat && !REPEATABLE.has(action)) return;
      runCommand(action);
    },
    true,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Control') stopCtrl();
      // Windows abre el menú contextual al soltar la tecla: ya está abierto el de la sesión.
      if (event.key === 'ContextMenu') {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
  // Una rueda de alta resolución manda muchos eventos pequeños: se acumula hasta una muesca.
  let wheelDelta = 0;
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || view.get().modal) return;
      event.preventDefault();
      event.stopPropagation();
      wheelDelta += event.deltaMode === 0 ? event.deltaY : event.deltaY * 33;
      if (Math.abs(wheelDelta) < 100) return;
      const { fontSize } = app.get().state.settings;
      setFontSize(fontSize + (wheelDelta < 0 ? 1 : -1));
      wheelDelta = 0;
    },
    { capture: true, passive: false },
  );
  window.addEventListener('blur', stopCtrl);
  // Tras un clic en cualquier zona muerta el foco cae en el cuerpo de la página, y lo
  // escrito o pegado se perdería. Vuelve a la terminal, salvo que se esté seleccionando texto.
  window.addEventListener(
    'mouseup',
    () => {
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const selection = document.getSelection();
        if (selection && !selection.isCollapsed) return;
        focusActive();
      }, 0);
    },
    true,
  );
}

/** Una sola vez, y solo si falta algo: quien ya tiene todo nunca la ve. */
export async function offerSetupGuide(): Promise<void> {
  if (app.get().state.settings.setupSeen || view.get().modal) return;
  const tools = await api.toolsCheck();
  if ((tools.claude && tools.git) || view.get().modal) return;
  view.set({ modal: { type: 'setup', tools } });
}

/** Uso del plan de Claude: lo último que dijo alguna sesión de Hilo (D25). */
export const planUsage = createStore<{ usage: PlanUsage | null }>({ usage: null });

export async function initController(): Promise<void> {
  void api.usageGet().then((usage) => {
    if (usage && (!planUsage.get().usage || usage.at >= planUsage.get().usage!.at)) planUsage.set({ usage });
  });
  api.onUsage((usage) => planUsage.set({ usage }));
  const initial = await api.getState();
  app.set(initial);
  view.set({ focused: initial.focused ?? true });

  try {
    await document.fonts.load(`${initial.state.settings.fontSize}px "Hilo Mono"`);
  } catch {
    // La fuente empaquetada falla: se cae a la siguiente de la lista.
  }

  terminals = new TerminalManager(initial.state.settings, {
    toast: (text) => toast(text),
    windowFocused: () => view.get().focused,
    statusOf: (id) => statusOf(id),
    activate: (id) => {
      if (app.get().state.ui.activeSessionId !== id) void dispatch({ type: 'ui/select', id });
    },
    confirmMultilinePaste: async (lines) => {
      const ok = await confirmDialog({
        title: lines > 1 ? `Vas a pegar ${lines} líneas` : 'Lo que vas a pegar termina en un salto de línea',
        body: 'Esta terminal no distingue un pegado de lo que escribes: cada salto de línea se ejecuta como si pulsaras Enter. Esto se puede desactivar en Ajustes.',
        ok: 'Pegar',
      });
      focusActive();
      return ok;
    },
  });
  terminals.setWindowsBuild(initial.info.windowsBuild);

  api.onState((state) => {
    const prev = app.get().state;
    app.set({ state });
    if (state.settings !== prev.settings) terminals.applySettings(state.settings);
    if (state.ui.panes !== prev.ui.panes) publishView();
    // Una sesión quitada desde otro lado no debe dejar su terminal viva.
    const ids = new Set(allSessions(state).map((s) => s.id));
    for (const s of allSessions(prev)) if (!ids.has(s.id)) terminals.dispose(s.id);
  });
  api.onRuntime((id, runtime) => {
    app.set({ runtime: { ...app.get().runtime, [id]: runtime } });
  });
  api.onPtyExit((id, _code, status) => {
    // Es la salida de un proceso anterior: esta terminal ya es del que se está lanzando.
    if (terminals.isWaking(id)) return;
    if (status === 'asleep') terminals.dispose(id);
    else terminals.markExited(id);
    focusActive();
  });
  api.onWindowFocus((focused) => {
    view.set({ focused });
    publishView();
    if (focused) focusActive();
  });
  api.onSessionFocus((id) => void selectSession(id));
  api.onAutoSlept((id) => disposeIfAsleep(id));
  api.onNotice((message) => toast(message));
  api.onUpdateStatus(onUpdateStatus);
  void api.updateGet().then(onUpdateStatus);
  if (initial.notice) toast(initial.notice);

  installKeyboard();
  publishView();
  // Otro diálogo o menú puede reemplazar una confirmación: quien la esperaba tiene que enterarse.
  let openConfirm: Extract<Modal, { type: 'confirm' }> | null = null;
  view.subscribe(() => {
    const { modal } = view.get();
    if (modal === openConfirm) return;
    openConfirm?.resolve(false);
    openConfirm = modal?.type === 'confirm' ? modal : null;
  });

  const { ui } = initial.state;
  // Tras una caída de la interfaz el aviso promete que quedaron dormidas.
  const startup = initial.afterCrash ? 'asleep' : initial.state.settings.startup;
  if (startup === 'restore') {
    // La que se está mirando primero: es la que se quiere ya.
    const list = [...ui.awake].sort((a, b) => Number(b === ui.activeSessionId) - Number(a === ui.activeSessionId));
    for (const [i, id] of list.entries()) setTimeout(() => void wakeSession(id).then(focusActive), i * 500);
  } else if (startup === 'wakeAll') {
    const all = allSessions(initial.state);
    for (const [i, session] of all.entries()) {
      // Escalonado: 9 arranques a la vez saturan la CPU.
      setTimeout(() => void wakeSession(session.id), i * 500);
    }
  } else if (startup === 'wakeLast' && ui.activeSessionId) {
    void wakeSession(ui.activeSessionId);
  }

  if (initial.info.isTest) {
    (window as unknown as { __hiloTest: unknown }).__hiloTest = { terminals, app, view, runCommand, selectSession, sleepSession, createSession, wakeSession, closeSession };
  }
}

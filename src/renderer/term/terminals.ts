import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { WheelThinner, type WheelLike } from '../../shared/wheel';
import { Terminal, type ITheme } from '@xterm/xterm';
import { cleanCopy, isBlankSelection, joinHardWrapped, sanitizePaste } from '../../shared/paste';
import { eventToKeys } from '../../shared/shortcuts';
import type { SessionKind, Settings, ThemeName } from '../../shared/types';
import { api } from '../api';

const CAMPBELL: ITheme = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#ffffff40',
  selectionInactiveBackground: '#ffffff26',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};

const THEMES: Record<ThemeName, ITheme> = {
  dark: {
    background: '#1b1c20',
    foreground: '#dcdce0',
    cursor: '#dcdce0',
    cursorAccent: '#1b1c20',
    selectionBackground: '#5b7fb066',
    selectionInactiveBackground: '#5b7fb040',
    black: '#2a2b31',
    red: '#ef7470',
    green: '#6cc48f',
    yellow: '#e4c06a',
    blue: '#7fa8d8',
    magenta: '#c58cc4',
    cyan: '#6dbcc2',
    white: '#c9cad0',
    // Con 4,5:1 sobre el fondo para que la salida atenuada de Claude se lea (R5).
    brightBlack: '#8b8d96',
    brightRed: '#f59491',
    brightGreen: '#86d6a6',
    brightYellow: '#efd087',
    brightBlue: '#9abde4',
    brightMagenta: '#d6a4d5',
    brightCyan: '#89cfd4',
    brightWhite: '#f1f1f4',
  },
  light: {
    background: '#fbfbfc',
    foreground: '#26272b',
    cursor: '#26272b',
    cursorAccent: '#fbfbfc',
    selectionBackground: '#5b7fb055',
    selectionInactiveBackground: '#5b7fb033',
    black: '#26272b',
    red: '#c0322e',
    green: '#1f8a53',
    yellow: '#8f6b00',
    blue: '#2b65ad',
    magenta: '#8f4a8e',
    cyan: '#17797f',
    white: '#c9cad0',
    brightBlack: '#6a6c75',
    brightRed: '#d9504b',
    brightGreen: '#2aa367',
    brightYellow: '#a98100',
    brightBlue: '#3d7cc9',
    brightMagenta: '#a95fa8',
    brightCyan: '#1f949b',
    brightWhite: '#ffffff',
  },
};

/** Cuándo reintentar WebGL tras perder el contexto. */
const GL_RETRY_MS = [1000, 5000, 30_000];

function themeFor(s: Settings): ITheme {
  const base = s.terminalColors === 'campbell' ? CAMPBELL : THEMES[s.theme];
  // La barra de desplazamiento se tiene que ver sin buscarla, sobre cualquier fondo.
  return { ...base, scrollbarSliderBackground: 'rgba(140, 140, 140, 0.5)', scrollbarSliderHoverBackground: 'rgba(140, 140, 140, 0.75)', scrollbarSliderActiveBackground: 'rgba(140, 140, 140, 0.95)' };
}

/** El margen alrededor de la terminal tiene que ser del mismo color que su fondo. */
export function terminalBackground(s: Settings): string {
  return themeFor(s).background!;
}

function contrastFor(s: Settings): number {
  // La paleta clara de Hilo tiene tonos pálidos. Oscuro y Campbell se quedan como están.
  return s.theme === 'light' && s.terminalColors === 'hilo' ? 4.5 : 1;
}

function fontStack(s: Settings): string {
  // Segoe UI Emoji antes de la caída del sistema: ✳ sale verde, como en Windows Terminal.
  return `"${s.fontFamily}", "Cascadia Mono", "Hilo Mono", Consolas, "Segoe UI Emoji", "Segoe UI Symbol", monospace`;
}

interface Entry {
  id: string;
  kind: SessionKind;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  el: HTMLDivElement;
  gl: WebglAddon | null;
  host: HTMLElement | null;
  pendingAck: number;
  resizeFrame: number;
  spawned: boolean;
  /** Tamaño que conoce el proceso. Puede diferir de xterm si cambió estando oculta. */
  ptyCols: number;
  ptyRows: number;
  ptyResizeTimer: ReturnType<typeof setTimeout> | null;
  /** Identifica esta instancia: una terminal recreada tiene que volver a montarse. */
  generation: number;
  /** Hay un lanzamiento en curso: la salida de un proceso anterior ya no es de esta terminal. */
  waking: boolean;
  /** Claude acaba de arrancar y aún no atiende: un Enter ahora se perdería. */
  readying: boolean;
  wakeDone: Promise<void> | null;
  /** Al arrancar estaba preguntando algo: lo pedido antes de verlo no se entrega. */
  startQuestion: boolean;
  /** Hasta cuándo lo tecleado es el final de una frase anterior al diálogo, no una respuesta. */
  guardUntil: number;
  lastInputAt: number;
  /** Cerrándose: lo que se teclee o pegue es para la sesión que queda. null en un pegado. */
  closingHold: (string | null)[] | null;
  /** Pegado esperando respuesta al diálogo: otro no abre un segundo diálogo. */
  confirming: boolean;
  /** Un Ctrl+C que copió: su autorrepetición no debe convertirse en interrupciones. */
  copyHeld: boolean;
  /** Pegados en curso: lo que se escriba mientras tanto espera, para no adelantarse. */
  pastePending: number;
  emittingPaste: boolean;
  heldInput: string[];
  lastSearch: string;
  wheel: WheelThinner;
}

export interface TerminalCallbacks {
  toast(message: string): void;
  /** Un clic derecho en un panel lo activa, igual que el izquierdo. */
  activate(id: string): void;
  confirmMultilinePaste(lines: number): Promise<boolean>;
  windowFocused(): boolean;
  /** En qué anda el proceso. "waiting": está preguntando algo, como el diálogo de confianza. */
  statusOf(id: string): string;
}

/** Cada cuánto se confirma la salida procesada, para el control de flujo. */
const ACK_EVERY = 64 * 1024;
/** Lo que espera el último cambio de tamaño antes de avisarle al proceso. */
const PTY_RESIZE_SETTLE_MS = 120;
/** 1 MB de texto en base64. */
const MAX_OSC52 = 1_400_000;

/** Entre dos escrituras de OSC 52: una ráfaga no golpea el portapapeles. Se queda la última. */
const OSC52_MIN_GAP_MS = 200;
/** Lo máximo que se espera a que Claude atienda: el mismo plazo de arranque de la sesión. */
const BRACKET_WAIT_MS = 45_000;
/** Ya dibujó su prompt y aún no activó el modo: normalmente es cuestión de un instante. */
const IDLE_GRACE_MS = 1000;
/** Claude activa el modo unos 18 ms antes de dibujar un diálogo: hay que dejarle verlo antes de contestar. */
const READY_SETTLE_MS = 300;
/** La pausa de tecleo que hace falta para que lo siguiente cuente como respuesta a un diálogo. */
const QUESTION_GUARD_MS = 700;
/** Con esto tecleado y sin que Claude atienda, se avisa: si no, parece que no llega. */
const SLOW_START_NOTICE_MS = 5000;
/** Lo que xterm responde por su cuenta (posición, identificación, foco): no es lo que se teclea. */
// eslint-disable-next-line no-control-regex
const TERMINAL_REPORT = /^(?:\x1b\[(?:[\d;?>]*[Rcn]|[\d;?]*\$y|[IO])|\x1b\][\d;]+;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*\x1b\\)$/;
// eslint-disable-next-line no-control-regex
const MOUSE_REPORT = /^\x1b\[</;

const SEARCH_DECORATIONS = {
  matchBackground: '#4a3f14',
  matchBorder: '#f2c744',
  // La coincidencia actual la pinta la selección: ver searchHighlight.
  activeMatchBackground: '#f2c744',
  matchOverviewRuler: '#7a6420',
  activeMatchColorOverviewRuler: '#f2c744',
};

/**
 * Las instancias de xterm viven fuera del árbol de Preact. Las que no se ven quedan
 * fuera de pantalla: xterm pausa el dibujo y solo mantiene su buffer. WebGL se carga
 * únicamente en las visibles.
 */
export class TerminalManager {
  private readonly entries = new Map<string, Entry>();
  private readonly parking: HTMLDivElement;
  private settings: Settings;
  private windowsBuild = 0;
  private generations = 0;
  private readonly linkTip: HTMLDivElement;
  private searchListener: { id: string; fn(index: number, count: number): void } | null = null;
  private lastOsc52 = 0;
  private pendingOsc52: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    settings: Settings,
    private readonly callbacks: TerminalCallbacks,
  ) {
    this.settings = settings;
    this.parking = document.createElement('div');
    this.parking.className = 'term-parking';
    document.body.appendChild(this.parking);
    this.linkTip = document.createElement('div');
    this.linkTip.className = 'link-tip';
    this.linkTip.hidden = true;
    document.body.appendChild(this.linkTip);
    this.watchDpi();
    document.documentElement.classList.toggle('scrollbar-always', settings.scrollbarAlways);

    api.onPtyData((id, data) => this.onData(id, data));
    api.onPtyReset((id) => this.entries.get(id)?.term.reset());
  }

  setWindowsBuild(build: number): void {
    this.windowsBuild = build;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  generationOf(id: string): number {
    return this.entries.get(id)?.generation ?? 0;
  }

  /** Crea la terminal sin lanzar el proceso. Tiene que existir antes: responde a `CSI c` (R2). */
  ensure(id: string, kind: SessionKind): Entry {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const s = this.settings;
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: fontStack(s),
      fontWeight: 350,
      fontWeightBold: 700,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      scrollback: s.scrollback,
      scrollSensitivity: s.wheelSpeed / 100,
      minimumContrastRatio: contrastFor(s),
      theme: themeFor(s),
      // Como Windows Terminal por defecto.
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorBlink: true,
      cursorInactiveStyle: 'outline',
      // Alt+arrastre selecciona por columnas: Alt+clic no debe mandarle flechas al proceso.
      altClickMovesCursor: false,
      // Los de xterm, más el espacio duro y el prompt de Claude.
      wordSeparator: " ()[]{}',\"`\u00a0❯",
      rescaleOverlappingGlyphs: true,
      smoothScrollDuration: 0,
      fastScrollSensitivity: 5,
      windowsPty: { backend: 'conpty', buildNumber: this.windowsBuild },
      linkHandler: {
        activate: (event, uri) => {
          if (event.ctrlKey) api.openLink(uri);
        },
        // El texto de un enlace puede decir otra cosa: se muestra el destino real.
        hover: (_event, uri) => this.showLinkTip(uri),
        leave: () => this.showLinkTip(null),
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new Unicode11Addon());
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) => {
          if (event.ctrlKey) api.openLink(uri);
        },
        {
          hover: (_event, uri) => this.showLinkTip(uri),
          leave: () => this.showLinkTip(null),
        },
      ),
    );
    term.unicode.activeVersion = '11';

    const el = document.createElement('div');
    el.className = 'term-host';
    this.parking.appendChild(el);
    term.open(el);

    const entry: Entry = { id, kind, term, fit, search, el, gl: null, host: null, pendingAck: 0, resizeFrame: 0, spawned: false, ptyCols: 0, ptyRows: 0, ptyResizeTimer: null, generation: ++this.generations, waking: false, readying: false, wakeDone: null, startQuestion: false, guardUntil: 0, lastInputAt: 0, closingHold: null, confirming: false, copyHeld: false, pastePending: 0, emittingPaste: false, heldInput: [], lastSearch: '', wheel: new WheelThinner() };
    this.entries.set(id, entry);

    term.onData((data) => this.sendInput(entry, data));
    term.onBinary((data) => this.sendInput(entry, data));
    term.parser.registerOscHandler(52, (data) => this.onOsc52(entry, data));
    search.onDidChangeResults((results) => {
      if (this.searchListener?.id === id) this.searchListener.fn(results.resultIndex, results.resultCount);
    });
    term.attachCustomKeyEventHandler((event) => this.onKey(entry, event));

    // Antes que xterm: un evento descartado no llega ni a la barra ni al programa que usa el ratón.
    el.addEventListener(
      'wheel',
      (event) => {
        if (entry.wheel.keep(event as unknown as WheelLike, performance.now(), this.settings.touchpadSpeed)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    );

    // Clic derecho como en Windows Terminal: copia si hay selección, si no pega.
    el.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        // La tecla de menú también dispara esto: esa abre el menú de la sesión, no copia ni pega.
        if (event.button !== 2) return;
        term.focus();
        const text = this.usableSelection(entry);
        if (text !== null) void this.copyText(entry, text);
        else void this.paste(entry);
      },
      true,
    );
    // Sin esto el clic derecho le llegaría a una app con seguimiento de ratón. El
    // preventDefault evita que el navegador le quite el foco a la terminal.
    el.addEventListener(
      'mousedown',
      (event) => {
        if (event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        this.callbacks.activate(id);
      },
      true,
    );
    el.addEventListener(
      'mouseup',
      (event) => {
        if (event.button === 2) event.stopPropagation();
      },
      true,
    );
    // Cualquier pegado o copiado nativo pasa por el mismo camino que el teclado.
    el.addEventListener(
      'paste',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.paste(entry);
      },
      true,
    );
    el.addEventListener(
      'copy',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = this.usableSelection(entry);
        if (text !== null) event.clipboardData?.setData('text/plain', text);
      },
      true,
    );
    this.fitEntry(entry, false);
    return entry;
  }

  /** Lo que se puede copiar, ya limpio. Una selección en blanco se descarta. */
  private usableSelection(entry: Entry): string | null {
    if (!entry.term.hasSelection()) return null;
    const text = cleanCopy(entry.term.getSelection());
    if (isBlankSelection(text)) {
      entry.term.clearSelection();
      return null;
    }
    return text;
  }

  /**
   * OSC 52: una aplicación copia al portapapeles (vim, tmux, ssh), igual que en Windows Terminal.
   * Solo escritura: leer dejaría a cualquier programa ver lo copiado. Y solo con la terminal a
   * la vista y la ventana con foco, para que no cambie el portapapeles sin que se note.
   */
  private onOsc52(entry: Entry, data: string): boolean {
    const semi = data.indexOf(';');
    if (semi < 0) return true;
    const target = data.slice(0, semi);
    const payload = data.slice(semi + 1);
    if (target !== '' && !target.includes('c')) return true;
    if (payload === '?' || payload === '' || payload.length > MAX_OSC52 || !entry.host || !this.callbacks.windowFocused()) return true;
    let text: string;
    try {
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return true; // Base64 o UTF-8 inválido.
    }
    if (!text || text.includes('\0')) return true;
    const wait = this.lastOsc52 + OSC52_MIN_GAP_MS - Date.now();
    if (wait <= 0) {
      this.writeOsc52(text);
    } else if (this.pendingOsc52) {
      this.pendingOsc52.text = text;
    } else {
      this.pendingOsc52 = {
        text,
        timer: setTimeout(() => {
          const pending = this.pendingOsc52;
          this.pendingOsc52 = null;
          if (pending) this.writeOsc52(pending.text);
        }, wait),
      };
    }
    return true;
  }

  private writeOsc52(text: string): void {
    this.lastOsc52 = Date.now();
    void api.clipWrite(text).catch(() => this.callbacks.toast('Un programa intentó copiar al portapapeles y no se pudo.'));
  }

  private onKey(entry: Entry, event: KeyboardEvent): boolean {
    const isDown = event.type === 'keydown';
    if (event.code === 'KeyC' && event.type === 'keyup') entry.copyHeld = false;
    const keys = eventToKeys(event);
    switch (keys) {
      case 'Ctrl+C': {
        if (entry.copyHeld && event.repeat) {
          // Sin cancelar, el navegador copiaría por su cuenta en cada repetición.
          event.preventDefault();
          return false;
        }
        // Sin selección sigue siendo la interrupción de siempre.
        const text = this.usableSelection(entry);
        if (text === null) return true;
        if (isDown) {
          event.preventDefault();
          entry.copyHeld = true;
          void this.copyText(entry, text);
        }
        return false;
      }
      case 'Ctrl+Shift+C':
      case 'Ctrl+Insert':
        if (isDown) {
          event.preventDefault();
          const text = this.usableSelection(entry);
          if (text !== null) void this.copyText(entry, text);
        }
        return false;
      case 'Ctrl+V':
      case 'Ctrl+Shift+V':
      case 'Shift+Insert':
        // Sin preventDefault el navegador dispararía otro paste y se pegaría dos veces.
        if (isDown) {
          event.preventDefault();
          void this.paste(entry);
        }
        return false;
      case 'Ctrl+Shift+-':
      case 'Ctrl+Shift+_':
        // El deshacer de Claude Code: Ctrl+- es el zoom, y xterm no emite nada con esta.
        if (isDown) {
          event.preventDefault();
          this.sendInput(entry, '\x1f');
        }
        return false;
      case 'Shift+Enter':
        // Claude Code en Windows no ve el modificador. ESC CR es lo que inserta un salto de línea.
        if (entry.kind === 'claude') {
          if (isDown) {
            event.preventDefault();
            this.sendInput(entry, '\x1b\r');
          }
          return false;
        }
        return true;
      default:
        // Alt+V y el resto pasan tal cual: Claude lee la imagen del portapapeles por su cuenta.
        return true;
    }
  }

  /** Mientras se está pegando, lo que se teclee espera su turno. */
  private sendInput(entry: Entry, data: string): void {
    // El proceso espera estas respuestas ya: no pueden quedar detrás de un diálogo.
    if (TERMINAL_REPORT.test(data)) {
      api.write(entry.id, data);
      return;
    }
    if (entry.closingHold) {
      if (!MOUSE_REPORT.test(data)) entry.closingHold.push(data);
      return;
    }
    // Flechas, Esc y Ctrl+C sí son para el diálogo: lo que se descarta es texto de una frase.
    if (!entry.emittingPaste && !/^[\x1b\x03]/.test(data)) {
      const now = Date.now();
      entry.lastInputAt = now;
      // Quien venía escribiendo cuando apareció el diálogo no le está contestando: hace falta una pausa.
      if (now < entry.guardUntil) {
        entry.guardUntil = now + QUESTION_GUARD_MS;
        return;
      }
    }
    if ((entry.pastePending > 0 || entry.waking || entry.readying) && !entry.emittingPaste) {
      entry.heldInput.push(data);
      return;
    }
    api.write(entry.id, data);
  }

  /** Lo teclea alguien que aún no llegó a la terminal, por ejemplo mientras se despierta. */
  typeInto(id: string, text: string): void {
    const entry = this.entries.get(id);
    if (entry) this.sendInput(entry, text);
  }

  /** Una sola cola por terminal, para que lo tecleado y lo pegado salgan en el orden en que se pidieron. */
  private releaseHeld(entry: Entry): void {
    if (entry.pastePending > 0 || entry.waking || entry.readying || !entry.heldInput.length) return;
    const held = entry.heldInput.join('');
    entry.heldInput = [];
    api.write(entry.id, held);
  }

  /** Cerrándose, un pegado queda en la cola y la sesión que quede lo pega por su propio camino. */
  private holdPaste(entry: Entry): boolean {
    if (!entry.closingHold) return false;
    entry.closingHold.push(null);
    return true;
  }

  /** La sesión se está cerrando: lo que llegue es para la que quede. */
  holdInput(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.closingHold = [];
  }

  takeHeld(id: string): (string | null)[] {
    const entry = this.entries.get(id);
    if (!entry) return [];
    const held = entry.closingHold ?? [];
    entry.closingHold = null;
    return held;
  }

  /** Entrega en orden lo retenido: texto, o null por cada pegado. */
  async deliverHeld(held: (string | null)[], id: string | null): Promise<void> {
    const entry = id ? this.entries.get(id) : undefined;
    if (!entry) return;
    for (const item of held) {
      if (item === null) await this.paste(entry);
      else this.sendInput(entry, item);
    }
  }

  private async copyText(entry: Entry, text: string): Promise<void> {
    try {
      await api.clipWrite(text);
      entry.term.clearSelection();
    } catch (err) {
      console.error('[copiar]', err);
      this.callbacks.toast('No se pudo copiar. La selección sigue ahí: inténtalo otra vez.');
    }
  }

  async copyJoined(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || this.usableSelection(entry) === null) return;
    const startCol = entry.term.getSelectionPosition()?.start.x ?? 0;
    await this.copyText(entry, joinHardWrapped(entry.term.getSelection(), entry.term.cols, startCol));
  }

  async paste(entry: Entry): Promise<void> {
    if (this.holdPaste(entry)) return;
    if (entry.confirming) return;
    // Lo tecleado antes de pedir este pegado sale antes, aunque el despertar tarde.
    const typedBefore = entry.heldInput.length;
    entry.pastePending++;
    try {
      if (entry.wakeDone) {
        await entry.wakeDone;
        if (entry.startQuestion) return;
      }
      const { text, hasImage } = await api.clipRead();
      if (!this.entries.has(entry.id)) return;
      if (this.holdPaste(entry)) return;
      if (!entry.spawned) {
        if (text || hasImage) this.callbacks.toast('Esta terminal ya no tiene proceso: no se pegó nada.');
        return;
      }
      if (!text) {
        // Solo hay imagen: es lo mismo que Alt+V en Claude.
        if (hasImage && entry.kind === 'claude') {
          entry.emittingPaste = true;
          this.sendInput(entry, '\x1bv');
          entry.emittingPaste = false;
        } else {
          this.callbacks.toast(hasImage ? 'El portapapeles solo tiene una imagen: esta terminal no puede pegarla.' : 'El portapapeles no tiene texto.');
        }
        return;
      }
      const clean = sanitizePaste(text);
      if (!clean) return;
      const multiline = /[\r\n]/.test(clean);
      // Claude activa el bracketed paste al arrancar: se le da tiempo. Pegar antes le llegaría
      // como teclas sueltas, y en el diálogo de confianza un salto sería responder.
      if (entry.kind === 'claude' && multiline) {
        await this.waitForBracketedPaste(entry);
        if (!this.entries.has(entry.id)) return;
        if (this.holdPaste(entry)) return;
        if (!entry.spawned) {
          this.callbacks.toast('Esta terminal ya no tiene proceso: no se pegó nada.');
          return;
        }
      }
      // Sin bracketed paste cada salto es un Enter: en PowerShell, ejecutar.
      if (this.settings.confirmMultilinePaste && !entry.term.modes.bracketedPasteMode && multiline) {
        // Otro pegado que ya había leído el portapapeles antes de abrirse este diálogo.
        if (entry.confirming) return;
        const lines = clean.split(/\r\n|\r|\n/).filter((l) => l !== '').length;
        entry.confirming = true;
        let ok = false;
        try {
          ok = await this.callbacks.confirmMultilinePaste(lines);
        } finally {
          entry.confirming = false;
        }
        if (!ok) return;
        if (!this.entries.has(entry.id) || !entry.spawned) {
          this.callbacks.toast('Esta terminal ya no tiene proceso: no se pegó nada.');
          return;
        }
        if (this.holdPaste(entry)) return;
        entry.term.focus();
      }
      if (typedBefore > 0) api.write(entry.id, entry.heldInput.splice(0, typedBefore).join(''));
      // Siempre por term.paste(): convierte saltos y envuelve con bracketed paste si está activo.
      entry.emittingPaste = true;
      entry.term.paste(clean);
      entry.emittingPaste = false;
    } catch (err) {
      console.error('[pegar]', err);
      this.callbacks.toast('No se pudo leer el portapapeles. Inténtalo otra vez.');
    } finally {
      entry.emittingPaste = false;
      entry.pastePending--;
      this.releaseHeld(entry);
    }
  }

  /**
   * Hasta que Claude atiende: activó el bracketed paste, dibujó su prompt, o salió. Devuelve si en
   * realidad está preguntando algo: entonces lo que se tecleó antes de verlo no es la respuesta.
   */
  private async waitForBracketedPaste(entry: Entry): Promise<boolean> {
    const deadline = Date.now() + BRACKET_WAIT_MS;
    const start = Date.now();
    let noticed = false;
    let idleUntil = 0;
    while (!entry.term.modes.bracketedPasteMode && entry.spawned && this.entries.has(entry.id) && Date.now() < deadline) {
      const status = this.callbacks.statusOf(entry.id);
      // Al agotar el plazo también se marca como esperando, pero eso no es una pregunta: solo tardó.
      if (status === 'waiting') return Date.now() - start < BRACKET_WAIT_MS - 2000;
      if (!noticed && entry.readying && (entry.heldInput.length > 0 || entry.pastePending > 0) && Date.now() - start > SLOW_START_NOTICE_MS) {
        noticed = true;
        this.callbacks.toast('Claude sigue arrancando: lo que escribiste se enviará cuando esté listo.');
      }
      if (status !== 'starting' && status !== 'asleep') {
        idleUntil ||= Date.now() + IDLE_GRACE_MS;
        if (Date.now() >= idleUntil) return false;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  private showLinkTip(uri: string | null): void {
    this.linkTip.hidden = uri === null;
    if (uri !== null) this.linkTip.textContent = `Ctrl+clic abre ${uri}`;
  }

  /** Mover la ventana a una pantalla con otra escala cambia el tamaño de la celda. */
  private watchDpi(): void {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        for (const entry of this.entries.values()) if (entry.host) this.fit(entry.id);
        this.watchDpi();
      },
      { once: true },
    );
  }

  private onData(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      // Sin terminal nadie confirmaría esta salida, y el proceso quedaría pausado para siempre.
      api.ack(id, data.length);
      return;
    }
    entry.term.write(data, () => {
      entry.pendingAck += data.length;
      if (entry.pendingAck >= ACK_EVERY) {
        api.ack(id, entry.pendingAck);
        entry.pendingAck = 0;
      }
    });
  }

  /** Lanza el proceso con el tamaño real. */
  async wake(id: string, kind: SessionKind): Promise<void> {
    const entry = this.ensure(id, kind);
    this.fitEntry(entry, false);
    this.cancelPtyResize(entry);
    entry.spawned = true;
    entry.ptyCols = entry.term.cols;
    entry.ptyRows = entry.term.rows;
    entry.waking = true;
    entry.startQuestion = false;
    entry.readying = kind === 'claude';
    const launched = api
      .wake(id, entry.term.cols, entry.term.rows)
      .then((started) => {
        // No arrancó, por ejemplo porque Claude no se encontró: un pegado en espera lo tiene que saber.
        if (!started) entry.spawned = false;
      })
      .catch((err: unknown) => {
        console.error('[despertar]', err);
        entry.spawned = false;
        this.callbacks.toast('No se pudo despertar la sesión.');
      })
      .finally(() => {
        entry.waking = false;
      });
    // Lo tecleado y lo pegado esperan a que Claude atienda, pero quien despierta no: ya se puede mirar.
    entry.wakeDone = launched
      .then(async () => {
        if (!entry.readying) return;
        let question = await this.waitForBracketedPaste(entry);
        if (!question && entry.spawned) {
          await new Promise((r) => setTimeout(r, READY_SETTLE_MS));
          question = this.callbacks.statusOf(id) === 'waiting';
        }
        if (!question) return;
        // Lo tecleado o pegado le contestaría a un diálogo que todavía no se había visto.
        entry.startQuestion = true;
        entry.guardUntil = entry.lastInputAt + QUESTION_GUARD_MS;
        if (entry.heldInput.length || entry.pastePending > 0) {
          entry.heldInput = [];
          this.callbacks.toast('Claude está preguntando algo: lo que escribiste no se envió.');
        }
      })
      .finally(() => {
        entry.readying = false;
        entry.wakeDone = null;
        this.releaseHeld(entry);
      });
    await launched;
  }

  isWaking(id: string): boolean {
    return this.entries.get(id)?.waking ?? false;
  }

  attach(id: string, host: HTMLElement): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.host === host && entry.el.parentElement === host) return;
    const hadFocus = entry.term.textarea === document.activeElement;
    entry.host = host;
    host.appendChild(entry.el);
    // Mover el elemento le quita el foco, y la tecla siguiente se perdería.
    if (hadFocus) entry.term.focus();
    this.loadGl(entry);
    this.fitEntry(entry, true);
  }

  detach(id: string, host: HTMLElement): void {
    const entry = this.entries.get(id);
    if (!entry || entry.host !== host) return;
    entry.host = null;
    this.parking.appendChild(entry.el);
    this.unloadGl(entry);
  }

  private glRetryAttempt = 0;

  /** Si al reintentar vuelve a fallar, `loadGl` llama aquí con el intento siguiente. */
  private retryGl(entry: Entry): void {
    const attempt = this.glRetryAttempt;
    if (attempt >= GL_RETRY_MS.length) return;
    setTimeout(() => {
      // Oculta o cerrada no necesita GPU: al volver a la vista se carga sola.
      if (this.entries.get(entry.id) !== entry || !entry.host || entry.gl) return;
      this.glRetryAttempt = attempt + 1;
      this.loadGl(entry);
      this.glRetryAttempt = 0;
      if (entry.gl) entry.term.refresh(0, entry.term.rows - 1);
    }, GL_RETRY_MS[attempt]);
  }

  private loadGl(entry: Entry): void {
    if (entry.gl) return;
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => {
        if (this.unloadGl(entry)) entry.term.focus();
        // Un juego o una suspensión pueden reiniciar la GPU. Sin esto la terminal se queda con el
        // dibujo de respaldo, que usa los bloques de la fuente: el logo de Claude sale deforme.
        this.retryGl(entry);
      });
      entry.term.loadAddon(gl);
      entry.gl = gl;
    } catch {
      // Sin WebGL queda el renderer DOM, más lento pero completo, con costuras en los bloques.
      entry.gl = null;
      this.retryGl(entry);
    }
  }

  /**
   * addon-webgl 0.19 nunca destruye su temporizador de parpadeo: solo lo detiene al perder
   * el foco. Si se descarga con el foco puesto, ese temporizador retiene para siempre la
   * terminal, su historial y el contexto de la GPU. Devuelve si tenía el foco.
   */
  private unloadGl(entry: Entry): boolean {
    const focused = entry.term.textarea === document.activeElement;
    if (focused) entry.term.blur();
    entry.gl?.dispose();
    entry.gl = null;
    return focused;
  }

  private fitEntry(entry: Entry, notify: boolean): void {
    const proposed = entry.fit.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
    const cols = Math.max(proposed.cols, 20);
    const rows = Math.max(proposed.rows, 4);
    if (cols !== entry.term.cols || rows !== entry.term.rows) entry.term.resize(cols, rows);
    if (notify && entry.spawned && (entry.ptyResizeTimer || cols !== entry.ptyCols || rows !== entry.ptyRows)) this.schedulePtyResize(entry);
  }

  /** Claude reimprime la conversación en cada aviso: al arrastrar, solo se avisa el tamaño final. */
  private schedulePtyResize(entry: Entry): void {
    this.cancelPtyResize(entry);
    entry.ptyResizeTimer = setTimeout(() => {
      entry.ptyResizeTimer = null;
      const { cols, rows } = entry.term;
      if (!entry.spawned || (cols === entry.ptyCols && rows === entry.ptyRows)) return;
      entry.ptyCols = cols;
      entry.ptyRows = rows;
      api.resize(entry.id, cols, rows);
    }, PTY_RESIZE_SETTLE_MS);
  }

  private cancelPtyResize(entry: Entry): void {
    if (entry.ptyResizeTimer) clearTimeout(entry.ptyResizeTimer);
    entry.ptyResizeTimer = null;
  }

  /** Avisa de un cambio de tamaño de un panel. Se agrupa por frame. */
  fit(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.resizeFrame) return;
    entry.resizeFrame = requestAnimationFrame(() => {
      entry.resizeFrame = 0;
      if (entry.host) this.fitEntry(entry, true);
    });
  }

  /** Las terminales nuevas fuera de pantalla nacen del tamaño del panel activo. */
  setParkingSize(width: number, height: number): void {
    this.parking.style.width = `${width}px`;
    this.parking.style.height = `${height}px`;
  }

  focus(id: string): void {
    this.entries.get(id)?.term.focus();
  }

  hasFocus(id: string): boolean {
    const textarea = this.entries.get(id)?.term.textarea;
    return !!textarea && document.activeElement === textarea;
  }

  dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (entry.resizeFrame) cancelAnimationFrame(entry.resizeFrame);
    this.cancelPtyResize(entry);
    this.unloadGl(entry);
    entry.term.dispose();
    entry.el.remove();
  }

  /** Proceso terminado con error: se deja la salida a la vista y se limpian los modos que pudo dejar. */
  markExited(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.spawned = false;
    entry.term.write('\x1b[?2004l\x1b[?1004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h');
  }

  applySettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    document.documentElement.classList.toggle('scrollbar-always', next.scrollbarAlways);
    for (const entry of this.entries.values()) {
      const opts = entry.term.options;
      if (prev.fontFamily !== next.fontFamily) {
        opts.fontFamily = fontStack(next);
      }
      if (prev.fontSize !== next.fontSize) opts.fontSize = next.fontSize;
      if (prev.lineHeight !== next.lineHeight) opts.lineHeight = next.lineHeight;
      if (prev.scrollback !== next.scrollback) opts.scrollback = next.scrollback;
      if (prev.wheelSpeed !== next.wheelSpeed) opts.scrollSensitivity = next.wheelSpeed / 100;
      if (prev.theme !== next.theme || prev.terminalColors !== next.terminalColors) {
        opts.theme = themeFor(next);
        if (this.searchListener?.id === entry.id) this.searchHighlight(entry.id, true);
        opts.minimumContrastRatio = contrastFor(next);
      }
      // Oculta o no, el proceso tiene que conocer el tamaño nuevo.
      this.fitEntry(entry, true);
    }
  }

  /** El contador de la búsqueda de una terminal. */
  listenSearch(id: string, fn: (index: number, count: number) => void): () => void {
    this.searchListener = { id, fn };
    this.searchHighlight(id, true);
    return () => {
      if (this.searchListener?.id === id) this.searchListener = null;
      this.searchHighlight(id, false);
    };
  }

  /** El complemento selecciona la coincidencia actual, y la selección se pinta sobre su color. */
  private searchHighlight(id: string, on: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const base = themeFor(this.settings);
    entry.term.options.theme = on ? { ...base, selectionBackground: '#f2c744', selectionInactiveBackground: '#f2c744', selectionForeground: '#000000' } : base;
  }

  findNext(id: string, query: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.lastSearch = query;
    return entry.search.findNext(query, { incremental: true, decorations: SEARCH_DECORATIONS });
  }

  findPrevious(id: string, query: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.lastSearch = query;
    return entry.search.findPrevious(query, { decorations: SEARCH_DECORATIONS });
  }

  clearSearch(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.search.clearDecorations();
    // Solo si la selección la puso la búsqueda: la del usuario se respeta.
    if (entry.lastSearch && entry.term.getSelection().toLowerCase() === entry.lastSearch.toLowerCase()) entry.term.clearSelection();
    entry.lastSearch = '';
  }

  /** Pega en una terminal concreta, aunque el foco todavía no haya llegado a ella. */
  async pasteInto(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) await this.paste(entry);
  }

  /** Solo para pruebas automáticas. */
  debugEntry(id: string): { term: Terminal; hasGl: boolean; parked: boolean } | null {
    const entry = this.entries.get(id);
    return entry ? { term: entry.term, hasGl: !!entry.gl, parked: entry.host === null } : null;
  }

  debugPaste(id: string): Promise<void> {
    const entry = this.entries.get(id);
    return entry ? this.paste(entry) : Promise.resolve();
  }

  debugGlCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.gl) n++;
    return n;
  }
}

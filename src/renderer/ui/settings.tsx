/**
 * Ajustes por módulos (#15): un módulo a la vez, un buscador que filtra opciones de todos, y cada opción con
 * una explicación corta. Cada fila se esconde sola si no coincide con la búsqueda.
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { CHANGELOG } from "../../shared/changelog";
import { claudePathProblem } from "../../shared/claudePath";
import { DEFAULT_SETTINGS } from "../../shared/defaults";
import {
  eventToKeys,
  isModifierOnly,
  prettyKeys,
  shortcutProblem,
  SHORTCUTS,
} from "../../shared/shortcuts";
import {
  CUSTOM_SOUND,
  SOUND_DURATIONS,
  SOUND_REPEATS,
  SOUNDS,
  type SoundChoice,
} from "../../shared/sounds";
import type {
  Settings,
  StartupMode,
  TerminalColors,
  ThemeName,
} from "../../shared/types";
import { RELEASES_URL, type UpdateStatus } from "../../shared/updates";
import { USAGE_THRESHOLDS } from "../../shared/usageAlerts";
import { api } from "../api";
import {
  app,
  clearCustomSound,
  dispatch,
  pickCustomSound,
  previewSound,
  useStore,
  view,
  type Modal,
} from "../controller";
import { Backdrop, closeModal } from "./dialogs";
import { CloseIcon } from "./icons";

type ModuleId =
  | "look"
  | "terminal"
  | "sessions"
  | "alerts"
  | "claude"
  | "changes"
  | "shortcuts"
  | "updates"
  | "news";

/** `keys`: lo que vuelve a su valor por defecto con "Restablecer". */
const MODULES: {
  id: ModuleId;
  label: string;
  hint: string;
  keys: (keyof Settings)[];
}[] = [
  {
    id: "look",
    label: "Apariencia",
    hint: "Tema, colores y tamaño de la letra y de la ventana.",
    keys: [
      "theme",
      "terminalColors",
      "fontFamily",
      "fontSize",
      "lineHeight",
      "appZoom",
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "Cómo se desplaza, cuánto historial guarda y qué pasa al pegar.",
    keys: [
      "scrollbarAlways",
      "wheelSpeed",
      "touchpadSpeed",
      "scrollback",
      "confirmMultilinePaste",
    ],
  },
  {
    id: "sessions",
    label: "Sesiones",
    hint: "Qué pasa al abrir Hilo, al elegir una sesión y cuando nadie la usa.",
    keys: [
      "startup",
      "wakeOnSelect",
      "autoSleepMinutes",
      "staleMarks",
      "showBranch",
      "showStateTime",
    ],
  },
  {
    id: "alerts",
    label: "Avisos",
    hint: "Notificaciones, sonidos y avisos de uso del plan.",
    keys: [
      "notifications",
      "soundDone",
      "soundWaiting",
      "soundError",
      "soundVolume",
      "soundDuration",
      "soundRepeat",
      "soundAlways",
      "usageAlerts",
      "usageAlertSession",
      "usageAlertWeek",
      "usageAlertNotify",
      "usageAlertSound",
    ],
  },
  {
    id: "claude",
    label: "Claude Code",
    hint: "Dónde está claude y cómo lo abre Hilo.",
    keys: [
      "claudePath",
      "useHooks",
      "usageMeter",
      "classicRenderer",
      "skipPermissions",
    ],
  },
  {
    id: "changes",
    label: "Cambios",
    hint: "El panel con los archivos que cambiaron.",
    keys: ["changesShowSigns", "changesFullFile"],
  },
  {
    id: "shortcuts",
    label: "Atajos",
    hint: "Las combinaciones de teclas de Hilo. Las de Claude Code no se tocan.",
    keys: ["shortcuts"],
  },
  {
    id: "updates",
    label: "Actualizaciones",
    hint: "Buscar e instalar versiones nuevas.",
    keys: ["checkUpdatesOnStart"],
  },
  { id: "news", label: "Novedades", hint: "Qué trajo cada versión.", keys: [] },
];

/** Los nombres viejos de sección siguen abriendo el módulo correcto. */
function moduleFor(section: string | undefined): ModuleId {
  return MODULES.some((m) => m.id === section) ? (section as ModuleId) : "look";
}

const norm = (t: string) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const Query = createContext<string[]>([]);

/** ¿Esta opción coincide con la búsqueda? Todas las palabras tienen que aparecer. */
function useVisible(text: string): boolean {
  const words = useContext(Query);
  if (!words.length) return true;
  const hay = norm(text);
  return words.every((w) => hay.includes(w));
}

function Row({
  title,
  desc,
  children,
  stack = false,
  keywords = "",
}: {
  title: string;
  desc?: ComponentChildren;
  children?: ComponentChildren;
  stack?: boolean;
  keywords?: string;
}) {
  if (
    !useVisible(`${title} ${typeof desc === "string" ? desc : ""} ${keywords}`)
  )
    return null;
  return (
    <div class={`set-row${stack ? " stack" : ""}`}>
      <div class="set-text">
        <span class="set-title">{title}</span>
        {desc && <span class="set-desc">{desc}</span>}
      </div>
      <div class="set-control">{children}</div>
    </div>
  );
}

function ToggleRow({
  field,
  title,
  desc,
  checked,
  disabled = false,
  keywords = "",
  onChange,
}: {
  field?: string;
  title: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  keywords?: string;
  onChange(on: boolean): void;
}) {
  if (!useVisible(`${title} ${desc ?? ""} ${keywords}`)) return null;
  return (
    <label class={`set-row toggle${disabled ? " disabled" : ""}`}>
      <div class="set-text">
        <span class="set-title">{title}</span>
        {desc && <span class="set-desc">{desc}</span>}
      </div>
      <input
        type="checkbox"
        class="switch"
        role="switch"
        data-field={field}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="set-group">
      <h4>{title}</h4>
      <div class="set-card">{children}</div>
    </section>
  );
}

function DraftInput(props: {
  value: string | number;
  type?: "number";
  min?: number;
  max?: number;
  step?: number;
  field?: string;
  placeholder?: string;
  "aria-labelledby"?: string;
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
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

function ShortcutRow({
  id,
  label,
  keys,
  note: outerNote,
  onSet,
}: {
  id: string;
  label: string;
  keys: string;
  note: string | undefined;
  onSet(id: string, keys: string | null): void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [note, setNote] = useState("");
  const def = SHORTCUTS.find((s) => s.id === id)!;
  if (!useVisible(`${label} ${prettyKeys(keys)} atajo tecla`)) return null;
  return (
    <div class="shortcut set-row">
      <span class="shortcut-label">{label}</span>
      {(note || outerNote) && (
        <span class="shortcut-note">{note || outerNote}</span>
      )}
      <button
        type="button"
        class={`keycap${capturing ? " capturing" : ""}`}
        onClick={() => {
          setCapturing(true);
          setNote("");
        }}
        onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          if (e.key !== "Tab") {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === "Escape" || e.key === "Tab") {
            setCapturing(false);
            setNote("");
            return;
          }
          if (isModifierOnly(e)) return;
          const combo = eventToKeys(e);
          const problem = shortcutProblem(combo);
          if (problem) {
            setNote(problem);
            return;
          }
          setNote("");
          setCapturing(false);
          onSet(id, combo);
        }}
      >
        {capturing ? "Pulsa la combinación" : prettyKeys(keys)}
      </button>
      {keys !== def.defaultKeys && (
        <button type="button" class="link" onClick={() => onSet(id, null)}>
          Restaurar
        </button>
      )}
    </div>
  );
}

/** "9 de noviembre de 2026", sin depender del idioma del sistema. */
function formatDate(iso: string): string {
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const [y, mo, d] = iso.split("-").map(Number);
  return `${d} de ${months[(mo ?? 1) - 1]} de ${y}`;
}

function updateMessage(status: UpdateStatus): string {
  switch (status.state) {
    case "off":
      return "Esta copia es de desarrollo o de pruebas: no se conecta a nada.";
    case "idle":
      return "Todavía no se buscó desde que abriste Hilo.";
    case "checking":
      return "Buscando…";
    case "current":
      return "Estás al día: tienes la última versión.";
    case "available":
      return `Hay una versión nueva: ${status.version}. No se baja ni se instala nada hasta que lo pidas.`;
    case "downloading":
      return `Bajando la versión ${status.version}: ${status.percent} %.`;
    case "ready":
      return `La versión ${status.version} está lista. Al instalarla, Hilo se cierra, se actualiza sin mostrar pantallas y vuelve a abrirse solo. Tus sesiones vuelven con su conversación.`;
    case "installing":
      return `Cerrando las sesiones para instalar la versión ${status.version}…`;
    case "error":
      return status.message;
  }
}

function UpdatesBlock({
  version,
  checkOnStart,
  onCheckOnStart,
}: {
  version: string;
  checkOnStart: boolean;
  onCheckOnStart(on: boolean): void;
}) {
  const status = useStore(view).update;
  const [confirming, setConfirming] = useState(false);
  const install = (force: boolean) =>
    void api.updateInstall(force).then((r) => setConfirming(r.needsConfirm));
  const busy =
    status.state === "off" ||
    status.state === "checking" ||
    status.state === "downloading" ||
    status.state === "ready" ||
    status.state === "installing";
  return (
    <>
      <Group title="Tu versión">
        <Row title="Versión instalada" keywords="actualizar version">
          <strong data-field="current-version">{version}</strong>
        </Row>
        <ToggleRow
          field="check-updates"
          title="Buscar al abrir Hilo"
          desc="Una vez cada vez que lo abres. Nunca instala sin preguntarte."
          checked={checkOnStart}
          onChange={onCheckOnStart}
          keywords="actualizar"
        />
      </Group>
      <Group title="Buscar e instalar">
        <Row title="Estado" stack keywords="actualizar buscar bajar instalar">
          <p
            class={`update-status${status.state === "error" ? " warn" : ""}`}
            data-field="update-status"
            data-state={status.state}
            role="status"
          >
            {updateMessage(status)}
          </p>
          {status.state === "downloading" && (
            <progress
              class="update-bar"
              max={100}
              value={status.percent}
              aria-label="Progreso de la descarga"
            />
          )}
          {confirming && status.state === "ready" ? (
            <>
              <p class="update-status warn" data-field="update-working">
                Hay sesiones trabajando. Si actualizas ahora se interrumpen;
                después vuelven con su conversación.
              </p>
              <div class="set-buttons">
                <button
                  type="button"
                  class="danger"
                  data-field="update-force"
                  onClick={() => install(true)}
                >
                  Reiniciar de todos modos
                </button>
                <button
                  type="button"
                  data-field="update-wait"
                  onClick={() => setConfirming(false)}
                >
                  Esperar
                </button>
              </div>
            </>
          ) : (
            <div class="set-buttons">
              {status.state === "available" && (
                <button
                  type="button"
                  class="primary"
                  data-field="update-download"
                  onClick={() => void api.updateDownload()}
                >
                  Bajar la versión {status.version}
                </button>
              )}
              {status.state === "ready" && (
                <button
                  type="button"
                  class="primary"
                  data-field="update-install"
                  onClick={() => install(false)}
                >
                  Reiniciar e instalar
                </button>
              )}
              {status.state === "error" && status.phase === "download" && (
                <button
                  type="button"
                  class="primary"
                  data-field="update-retry"
                  onClick={() => void api.updateDownload()}
                >
                  Reintentar la descarga
                </button>
              )}
              <button
                type="button"
                data-field="update-check"
                disabled={busy}
                onClick={() => void api.updateCheck()}
              >
                Buscar actualizaciones
              </button>
              {status.state === "error" && (
                <button
                  type="button"
                  class="link"
                  data-field="update-releases"
                  onClick={() => api.openLink(RELEASES_URL)}
                >
                  Abrir la página de versiones
                </button>
              )}
            </div>
          )}
        </Row>
      </Group>
      <p class="set-note">
        Es la única conexión de Hilo. Solo habla con GitHub para buscar y bajar
        versiones, no envía datos tuyos y nunca instala sin preguntarte.
      </p>
    </>
  );
}

/** Probar un sonido, y con un segundo clic detenerlo. */
function usePreview() {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const current = useRef<{ key: string; stop(): void } | null>(null);
  useEffect(() => () => current.current?.stop(), []);
  const toggle = (key: string, sound: SoundChoice) => {
    // Se mira antes de detener: al detenerse, el aviso de fin ya vacía current.
    const wasPlaying = current.current?.key === key;
    current.current?.stop();
    current.current = null;
    setPreviewing(null);
    if (wasPlaying) return;
    const entry = { key, stop: () => undefined as void };
    current.current = entry;
    setPreviewing(key);
    entry.stop = previewSound(sound, () => {
      if (current.current === entry) {
        current.current = null;
        setPreviewing(null);
      }
    });
  };
  return { previewing, toggle };
}

function SoundPicker({
  field,
  value,
  customName,
  onChange,
  preview,
}: {
  field: string;
  value: SoundChoice;
  customName: string;
  onChange(v: SoundChoice): void;
  preview: ReturnType<typeof usePreview>;
}) {
  return (
    <div class="set-inline">
      <select
        data-field={field}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as SoundChoice)}
      >
        <option value="none">Sin sonido</option>
        {SOUNDS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {customName && (
          <option value={CUSTOM_SOUND}>Tu sonido: {customName}</option>
        )}
      </select>
      <button
        type="button"
        data-action={`preview-${field}`}
        disabled={value === "none"}
        onClick={() => preview.toggle(field, value)}
      >
        {preview.previewing === field ? "Detener" : "Probar"}
      </button>
    </div>
  );
}

function ThresholdChips({
  field,
  value,
  onChange,
}: {
  field: string;
  value: number[];
  onChange(v: number[]): void;
}) {
  return (
    <div class="chips" role="group" data-field={field}>
      {USAGE_THRESHOLDS.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            class={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() =>
              onChange(
                on
                  ? value.filter((x) => x !== t)
                  : [...value, t].sort((a, b) => a - b),
              )
            }
          >
            {t} %
          </button>
        );
      })}
    </div>
  );
}

export function SettingsDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "settings" }>;
}) {
  const { state, info } = useStore(app);
  const s = state.settings;
  const set = (patch: Partial<Settings>) =>
    void dispatch({ type: "settings/set", patch });
  const num = (value: string, min: number, max: number, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const [module, setModule] = useState<ModuleId>(() =>
    moduleFor(modal.section),
  );
  useEffect(() => setModule(moduleFor(modal.section)), [modal]);
  const [query, setQuery] = useState("");
  const words = norm(query).split(/\s+/).filter(Boolean);
  const [resetting, setResetting] = useState(false);
  useEffect(() => setResetting(false), [module]);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [claudeMissing, setClaudeMissing] = useState(false);
  const [fontMissing, setFontMissing] = useState(false);
  const [soundProblem, setSoundProblem] = useState("");
  const preview = usePreview();
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  useEffect(() => bodyRef.current?.scrollTo({ top: 0 }), [module]);
  useEffect(() => {
    let live = true;
    if (s.claudePath)
      void api
        .pathExists(s.claudePath)
        .then((ok) => live && setClaudeMissing(!ok));
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
          next[def.id] = "";
          notes[id] = `Se quitó de «${def.label}»`;
        }
      }
      next[id] = keys;
    }
    setConflicts(notes);
    set({ shortcuts: next });
  };

  const resetModule = (id: ModuleId) => {
    const def = MODULES.find((m) => m.id === id)!;
    const patch: Partial<Settings> = {};
    for (const key of def.keys)
      (patch as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key];
    set(patch);
    setResetting(false);
  };

  const content: Record<ModuleId, () => ComponentChildren> = {
    look: () => (
      <>
        <Group title="Letra de las terminales">
          <Row
            title="Tamaño de la letra"
            desc="También con Ctrl y la rueda, o Ctrl + y Ctrl −."
            keywords="fuente zoom"
          >
            <div class="stepper">
              <button
                type="button"
                aria-label="Letra más chica"
                onClick={() => set({ fontSize: Math.max(9, s.fontSize - 1) })}
              >
                −
              </button>
              <DraftInput
                field="font-size"
                type="number"
                min={9}
                max={32}
                value={s.fontSize}
                onCommit={(v) => set({ fontSize: num(v, 9, 32, s.fontSize) })}
              />
              <button
                type="button"
                aria-label="Letra más grande"
                onClick={() => set({ fontSize: Math.min(32, s.fontSize + 1) })}
              >
                +
              </button>
            </div>
          </Row>
          <Row
            title="Fuente"
            desc={
              fontMissing
                ? "No está instalada: se usa Cascadia Mono."
                : "Una fuente monoespaciada instalada en Windows."
            }
            keywords="letra tipografia"
          >
            <DraftInput
              field="font"
              value={s.fontFamily}
              onCommit={(v) => set({ fontFamily: v.trim() || "Cascadia Mono" })}
            />
          </Row>
          <Row
            title="Interlineado"
            desc="Espacio entre líneas, de 1 a 2."
            keywords="letra lineas"
          >
            <DraftInput
              type="number"
              min={1}
              max={2}
              step={0.05}
              value={s.lineHeight}
              onCommit={(v) => set({ lineHeight: num(v, 1, 2, s.lineHeight) })}
            />
          </Row>
          <Row title="Vista previa" stack keywords="letra fuente">
            <div
              class="font-preview"
              style={{
                fontFamily: `"${s.fontFamily}", "Cascadia Mono", "Hilo Mono", monospace`,
                fontSize: `${s.fontSize}px`,
                lineHeight: s.lineHeight,
              }}
            >
              Así se ve el texto. 0123456789
            </div>
          </Row>
        </Group>
        <Group title="Ventana y colores">
          <Row
            title="Tamaño de toda la ventana"
            desc="Agranda también la lista de sesiones, las pestañas y estos ajustes."
            keywords="zoom escala"
          >
            <select
              data-field="app-zoom"
              value={s.appZoom}
              onChange={(e) => set({ appZoom: Number(e.currentTarget.value) })}
            >
              {[80, 90, 100, 110, 125, 150].map((z) => (
                <option key={z} value={z}>
                  {z} %{z === 100 ? " (normal)" : ""}
                </option>
              ))}
            </select>
          </Row>
          <Row title="Tema" keywords="oscuro claro modo">
            <select
              data-field="theme"
              value={s.theme}
              onChange={(e) =>
                set({ theme: e.currentTarget.value as ThemeName })
              }
            >
              <option value="dark">Oscuro</option>
              <option value="light">Claro</option>
            </select>
          </Row>
          <Row title="Colores de la terminal" keywords="paleta campbell">
            <select
              data-field="colors"
              value={s.terminalColors}
              onChange={(e) =>
                set({ terminalColors: e.currentTarget.value as TerminalColors })
              }
            >
              <option value="hilo">Los de Hilo, con mejor contraste</option>
              <option value="campbell">
                Los de Windows Terminal (Campbell)
              </option>
            </select>
          </Row>
        </Group>
      </>
    ),
    terminal: () => (
      <>
        <Group title="Desplazamiento">
          <ToggleRow
            field="scrollbar-always"
            title="Barra de desplazamiento siempre visible"
            desc="Si hay historial. Si no, aparece al acercar el ratón."
            checked={s.scrollbarAlways}
            onChange={(on) => set({ scrollbarAlways: on })}
            keywords="scroll"
          />
          <Row title="Velocidad con la rueda del ratón" keywords="scroll mouse">
            <div class="range-row">
              <input
                type="range"
                data-field="wheel-speed"
                min={25}
                max={300}
                step={25}
                value={s.wheelSpeed}
                onChange={(e) =>
                  set({ wheelSpeed: Number(e.currentTarget.value) })
                }
              />
              <output>{s.wheelSpeed} %</output>
            </div>
          </Row>
          <Row
            title="Velocidad con dos dedos en el touchpad"
            desc="Si baja muy rápido, reduce este valor. Vale al momento."
            keywords="scroll panel tactil"
          >
            <div class="range-row">
              <input
                type="range"
                data-field="touchpad-speed"
                min={10}
                max={100}
                step={5}
                value={s.touchpadSpeed}
                onChange={(e) =>
                  set({ touchpadSpeed: Number(e.currentTarget.value) })
                }
              />
              <output>{s.touchpadSpeed} %</output>
            </div>
          </Row>
        </Group>
        <Group title="Historial">
          <Row
            title="Líneas de historial por terminal"
            desc={`Cada 3000 líneas usan unos 8 MB si la terminal está llena.${s.scrollback >= 20000 ? ` Con ${s.scrollback}, unos ${Math.round((s.scrollback / 3000) * 8)} MB por terminal.` : ""}`}
            keywords="scrollback memoria"
          >
            <DraftInput
              field="scrollback"
              type="number"
              min={500}
              max={100000}
              step={500}
              value={s.scrollback}
              onCommit={(v) =>
                set({ scrollback: num(v, 500, 100000, s.scrollback) })
              }
            />
          </Row>
        </Group>
        <Group title="Pegar">
          <ToggleRow
            field="confirm-multiline"
            title="Avisar antes de pegar varias líneas"
            desc="Solo donde cada salto ejecutaría algo, como PowerShell."
            checked={s.confirmMultilinePaste}
            onChange={(on) => set({ confirmMultilinePaste: on })}
            keywords="portapapeles"
          />
        </Group>
      </>
    ),
    sessions: () => (
      <>
        <Group title="Al abrir y al elegir una sesión">
          <Row title="Al abrir Hilo" keywords="inicio arranque restaurar">
            <select
              data-field="startup"
              value={s.startup}
              onChange={(e) =>
                set({ startup: e.currentTarget.value as StartupMode })
              }
            >
              <option value="restore">Encender las que dejé encendidas</option>
              <option value="asleep">Todas las sesiones dormidas</option>
              <option value="wakeLast">Despertar la última que usé</option>
              <option value="wakeAll">Despertar todas</option>
            </select>
          </Row>
          <ToggleRow
            field="wake-on-select"
            title="Despertar una sesión al elegirla"
            desc="Si no, se despierta con su botón."
            checked={s.wakeOnSelect}
            onChange={(on) => set({ wakeOnSelect: on })}
            keywords="dormida"
          />
        </Group>
        <Group title="Sesiones que nadie usa">
          <Row
            title="Dormir tras estos minutos sin actividad"
            desc="0 = nunca. Nunca duerme una sesión que trabaja, te espera, está sin leer o tiene procesos en segundo plano."
            keywords="memoria automatico"
          >
            <DraftInput
              field="autosleep"
              type="number"
              min={0}
              max={1440}
              value={s.autoSleepMinutes}
              onCommit={(v) => set({ autoSleepMinutes: num(v, 0, 1440, 0) })}
            />
          </Row>
          <ToggleRow
            field="stale-marks"
            title="Colorear las sesiones abiertas sin mensajes"
            desc="Amarillo a la hora, naranja a las 5 horas y rojo al día."
            checked={s.staleMarks}
            onChange={(on) => set({ staleMarks: on })}
            keywords="quietas olvidadas color"
          />
          <ToggleRow
            field="show-branch"
            title="Mostrar la rama de git junto al nombre"
            desc="En la lista de sesiones. Al dejar el cursor encima de una sesión se ve siempre."
            checked={s.showBranch}
            onChange={(on) => set({ showBranch: on })}
            keywords="git rama branch lista"
          />
          <ToggleRow
            field="show-state-time"
            title="Mostrar cuánto lleva cada sesión en su estado"
            desc="Junto al nombre, en la lista de sesiones. Al dejar el cursor encima se ve siempre."
            checked={s.showStateTime}
            onChange={(on) => set({ showStateTime: on })}
            keywords="tiempo minutos lista"
          />
        </Group>
      </>
    ),
    alerts: () => (
      <>
        <Group title="Notificaciones de Windows">
          <ToggleRow
            field="notifications"
            title="Avisar cuando una sesión termina o te espera"
            desc="Solo si no la estás mirando."
            checked={s.notifications}
            onChange={(on) => set({ notifications: on })}
            keywords="notificacion"
          />
        </Group>
        <Group title="Sonidos">
          <Row title="Cuando termina" keywords="sonido aviso">
            <SoundPicker
              field="soundDone"
              value={s.soundDone}
              customName={s.customSoundName}
              onChange={(v) => set({ soundDone: v })}
              preview={preview}
            />
          </Row>
          <Row
            title="Cuando te espera"
            desc="Un permiso o una pregunta."
            keywords="sonido aviso"
          >
            <SoundPicker
              field="soundWaiting"
              value={s.soundWaiting}
              customName={s.customSoundName}
              onChange={(v) => set({ soundWaiting: v })}
              preview={preview}
            />
          </Row>
          <Row title="Cuando falla" keywords="sonido aviso error">
            <SoundPicker
              field="soundError"
              value={s.soundError}
              customName={s.customSoundName}
              onChange={(v) => set({ soundError: v })}
              preview={preview}
            />
          </Row>
          <Row title="Volumen" keywords="sonido">
            <div class="range-row">
              <input
                type="range"
                data-field="sound-volume"
                min={0}
                max={100}
                step={5}
                value={s.soundVolume}
                onChange={(e) => {
                  set({ soundVolume: Number(e.currentTarget.value) });
                  const first = [
                    s.soundDone,
                    s.soundWaiting,
                    s.soundError,
                  ].find((x) => x !== "none");
                  if (first) setTimeout(() => previewSound(first), 50);
                }}
              />
              <output>{s.soundVolume} %</output>
            </div>
          </Row>
          <Row
            title="Duración de cada aviso"
            desc="Se corta apenas abres la sesión o le respondes."
            keywords="sonido largo repetir seguido"
          >
            <select
              data-field="sound-duration"
              value={String(s.soundDuration)}
              onChange={(e) =>
                set({ soundDuration: Number(e.currentTarget.value) })
              }
            >
              {SOUND_DURATIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {d === 0 ? "Una vez" : `Seguido durante ${d} segundos`}
                </option>
              ))}
            </select>
          </Row>
          <Row
            title="Repetir el aviso"
            desc="Mientras nadie la atienda."
            keywords="sonido"
          >
            <select
              data-field="sound-repeat"
              value={String(s.soundRepeat)}
              onChange={(e) =>
                set({ soundRepeat: Number(e.currentTarget.value) })
              }
            >
              {SOUND_REPEATS.map((m) => (
                <option key={m} value={String(m)}>
                  {m === 0
                    ? "No repetir"
                    : m === 1
                      ? "Cada 1 minuto"
                      : `Cada ${m} minutos`}
                </option>
              ))}
            </select>
          </Row>
          <ToggleRow
            field="sound-always"
            title="Sonar también si estoy mirando esa sesión"
            checked={s.soundAlways}
            onChange={(on) => set({ soundAlways: on })}
            keywords="sonido"
          />
        </Group>
        <Group title="Tu sonido">
          <Row
            title={
              s.customSoundName
                ? `Tu sonido: ${s.customSoundName}`
                : "Un audio tuyo"
            }
            desc={
              soundProblem ||
              'Un mp3, wav u ogg de hasta 2 MB. Hilo guarda una copia, y aparece como "Tu sonido" en las listas.'
            }
            keywords="sonido propio mp3 audio personalizado"
          >
            <div class="set-inline" data-field="custom-sound">
              <button
                type="button"
                data-action="pick-sound"
                onClick={() =>
                  void pickCustomSound().then((problem) => {
                    setSoundProblem(problem);
                  })
                }
              >
                {s.customSoundName ? "Cambiar" : "Elegir archivo…"}
              </button>
              {s.customSoundName && (
                <>
                  <button
                    type="button"
                    data-action="preview-custom"
                    onClick={() => preview.toggle("custom", CUSTOM_SOUND)}
                  >
                    {preview.previewing === "custom" ? "Detener" : "Probar"}
                  </button>
                  <button
                    type="button"
                    class="link"
                    data-action="clear-sound"
                    onClick={() =>
                      void clearCustomSound().then(() => setSoundProblem(""))
                    }
                  >
                    Quitar
                  </button>
                </>
              )}
            </div>
          </Row>
        </Group>
        <Group title="Avisos de uso del plan">
          <ToggleRow
            field="usage-alerts"
            title="Avisar cuando el uso cruza un umbral"
            desc={
              s.usageMeter && s.useHooks
                ? "Una vez por umbral en cada ventana. Usa el mismo dato del medidor de la barra lateral."
                : 'Necesita "Mostrar el uso del plan", en Claude Code.'
            }
            checked={s.usageAlerts}
            onChange={(on) => set({ usageAlerts: on })}
            keywords="cupo limite porcentaje"
          />
          <Row
            title="Sesión de 5 horas"
            desc="Avisar al llegar a:"
            keywords="uso umbral cupo"
          >
            <ThresholdChips
              field="usage-session"
              value={s.usageAlertSession}
              onChange={(v) => set({ usageAlertSession: v })}
            />
          </Row>
          <Row
            title="Semana"
            desc="Avisar al llegar a:"
            keywords="uso umbral cupo semanal"
          >
            <ThresholdChips
              field="usage-week"
              value={s.usageAlertWeek}
              onChange={(v) => set({ usageAlertWeek: v })}
            />
          </Row>
          <ToggleRow
            field="usage-alert-notify"
            title="Con una notificación de Windows"
            checked={s.usageAlertNotify}
            onChange={(on) => set({ usageAlertNotify: on })}
            keywords="uso aviso"
          />
          <Row title="Sonido del aviso de uso" keywords="uso aviso">
            <SoundPicker
              field="usageAlertSound"
              value={s.usageAlertSound}
              customName={s.customSoundName}
              onChange={(v) => set({ usageAlertSound: v })}
              preview={preview}
            />
          </Row>
        </Group>
      </>
    ),
    claude: () => (
      <>
        <Group title="Programa">
          <Row
            title="Ruta de claude"
            desc="Déjala vacía para que Hilo la busque sola."
            stack
            keywords="claude.exe path instalacion"
          >
            <div class="set-inline">
              <DraftInput
                field="claude"
                value={s.claudePath}
                placeholder={info.claudePath ?? "No se encontró en el PATH"}
                onCommit={(v) => set({ claudePath: v.trim() })}
              />
              <button
                type="button"
                onClick={() =>
                  void api.pickFile().then((p) => p && set({ claudePath: p }))
                }
              >
                Elegir
              </button>
            </div>
            {claudePathProblem(s.claudePath) ? (
              <small class="warn block" data-warn="claude-path">
                {claudePathProblem(s.claudePath)} Mientras tanto, Hilo la ignora
                y busca claude por su cuenta.{" "}
                <button
                  type="button"
                  class="link"
                  onClick={() => set({ claudePath: "" })}
                >
                  Dejarla vacía
                </button>
              </small>
            ) : (
              claudeMissing && (
                <small class="warn block">No existe ese archivo.</small>
              )
            )}
          </Row>
          <Row
            title="Requisitos"
            desc="Comprueba si están Claude Code y Git, y cómo instalarlos."
            keywords="git instalar"
          >
            <button
              type="button"
              onClick={() =>
                void api
                  .toolsCheck()
                  .then((tools) =>
                    view.set({ modal: { type: "setup", tools } }),
                  )
              }
            >
              Ver requisitos
            </button>
          </Row>
        </Group>
        <Group title="Cómo abre Hilo a Claude">
          <ToggleRow
            field="use-hooks"
            title="Detectar el estado con hooks"
            desc="Solo en las sesiones de Hilo. Sin esto, el amarillo llega hasta 2 segundos tarde."
            checked={s.useHooks}
            onChange={(on) => set({ useHooks: on })}
            keywords="estado"
          />
          <ToggleRow
            field="usage-meter"
            title="Mostrar el uso del plan"
            desc="En la barra lateral y abajo en cada sesión. Reemplaza tu línea de estado, solo en las sesiones de Hilo. Necesita los hooks; vale desde el próximo despertar."
            checked={s.usageMeter}
            disabled={!s.useHooks}
            onChange={(on) => set({ usageMeter: on })}
            keywords="cupo limite sesion semana"
          />
          <ToggleRow
            field="classic-renderer"
            title="Pantalla clásica de Claude"
            desc="Como /tui default: el historial se desplaza con la rueda y la barra de Hilo. Vale desde el próximo despertar."
            checked={s.classicRenderer}
            onChange={(on) => set({ classicRenderer: on })}
            keywords="tui pantalla completa scroll"
          />
        </Group>
        <Group title="Permisos">
          <ToggleRow
            field="skip-permissions"
            title="Abrir Claude sin pedir permisos"
            desc="--dangerously-skip-permissions: Claude ejecutaría todo sin preguntar. Déjalo apagado si no sabes lo que hace. Vale desde el próximo despertar."
            checked={s.skipPermissions}
            onChange={(on) => set({ skipPermissions: on })}
            keywords="peligroso dangerously"
          />
        </Group>
      </>
    ),
    changes: () => (
      <Group title="Panel de cambios">
        <ToggleRow
          field="changes-signs"
          title="Mostrar + y − en los cambios"
          desc="Además del color de fondo."
          checked={s.changesShowSigns}
          onChange={(on) => set({ changesShowSigns: on })}
          keywords="diff git"
        />
        <ToggleRow
          field="changes-full-file"
          title="Mostrar el archivo completo"
          desc="Si no, solo las zonas que cambiaron."
          checked={s.changesFullFile}
          onChange={(on) => set({ changesFullFile: on })}
          keywords="diff git"
        />
      </Group>
    ),
    shortcuts: () => (
      <Group title="Atajos de Hilo">
        <div class="shortcuts">
          {SHORTCUTS.filter((d) => !/^go[2-9]$/.test(d.id)).map((d) => (
            <ShortcutRow
              key={d.id}
              id={d.id}
              label={
                d.id === "go1"
                  ? "Ir a la sesión 1 (de la 2 a la 9, con Ctrl y su número)"
                  : d.label
              }
              keys={s.shortcuts[d.id] ?? d.defaultKeys}
              note={conflicts[d.id]}
              onSet={setShortcut}
            />
          ))}
        </div>
      </Group>
    ),
    updates: () => (
      <UpdatesBlock
        version={info.version}
        checkOnStart={s.checkUpdatesOnStart}
        onCheckOnStart={(on) => set({ checkUpdatesOnStart: on })}
      />
    ),
    news: () => (
      <>
        {CHANGELOG.map((entry) => (
          <NewsEntry
            key={entry.version}
            version={entry.version}
            date={entry.date}
            items={entry.items}
            current={entry.version === info.version}
          />
        ))}
      </>
    ),
  };

  const searching = words.length > 0;
  const shown = searching ? MODULES : MODULES.filter((m) => m.id === module);
  return (
    <Backdrop onClose={closeModal} labelledBy="settings-title">
      <div class="settings">
        <header class="settings-head">
          <h2 id="settings-title" ref={titleRef} tabIndex={-1}>
            Ajustes
          </h2>
          <input
            class="set-search"
            type="search"
            data-field="settings-search"
            placeholder="Buscar en los ajustes"
            aria-label="Buscar en los ajustes"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button
            class="icon-btn"
            aria-label="Cerrar ajustes"
            onClick={closeModal}
          >
            <CloseIcon />
          </button>
        </header>
        <div class="settings-main">
          <nav class="settings-nav" aria-label="Módulos de ajustes">
            {MODULES.map((m) => (
              <button
                key={m.id}
                type="button"
                class={!searching && module === m.id ? "on" : ""}
                aria-current={
                  !searching && module === m.id ? "true" : undefined
                }
                onClick={() => {
                  setQuery("");
                  setModule(m.id);
                }}
              >
                {m.label}
              </button>
            ))}
            <p class="about">Hilo {info.version}. Sin telemetría.</p>
          </nav>
          <div
            ref={bodyRef}
            class={`settings-body${searching ? " searching" : ""}`}
          >
            <Query.Provider value={words}>
              {shown.map((m) => (
                <section key={m.id} class="set-module" data-section={m.id}>
                  <header class="set-module-head">
                    <div>
                      <h3>{m.label}</h3>
                      {!searching && <p class="set-hint">{m.hint}</p>}
                    </div>
                    {!searching && m.keys.length > 0 && (
                      <div class="set-reset">
                        {resetting ? (
                          <>
                            <span>¿Volver a los valores de fábrica?</span>
                            <button
                              type="button"
                              class="danger"
                              data-action="reset-confirm"
                              onClick={() => resetModule(m.id)}
                            >
                              Restablecer
                            </button>
                            <button
                              type="button"
                              onClick={() => setResetting(false)}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            class="link"
                            data-action="reset-module"
                            onClick={() => setResetting(true)}
                          >
                            Restablecer este módulo
                          </button>
                        )}
                      </div>
                    )}
                  </header>
                  {content[m.id]()}
                </section>
              ))}
              {searching && (
                <p class="set-empty">
                  No hay ajustes que coincidan con «{query.trim()}».
                </p>
              )}
            </Query.Provider>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

function NewsEntry({
  version,
  date,
  items,
  current,
}: {
  version: string;
  date: string;
  items: string[];
  current: boolean;
}) {
  if (!useVisible(`${version} novedades ${items.join(" ")}`)) return null;
  return (
    <div
      class={`news-entry set-row stack${current ? " current" : ""}`}
      data-version={version}
    >
      <h4>
        {version}
        {current && <span class="news-badge">la que tienes</span>}
        <span class="news-date">{formatDate(date)}</span>
      </h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

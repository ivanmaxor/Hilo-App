import type { ComponentChildren } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { EFFORTS, MODELS, PALETTE } from "../../shared/defaults";
import { fuzzyMatch } from "../../shared/fuzzy";
import { STATUS_LABEL, STATUS_PRIORITY } from "../../shared/statusMachine";
import { allSessions, findSession } from "../../shared/reducer";
import type { Modal } from "../controller";
import { moveToast } from "./sidebar";
import type { SessionKind, ToolCheck } from "../../shared/types";
import { changesPaneId } from "../../shared/paneContent";
import type { DetectedIde } from "../../shared/ide";
import { api } from "../api";
import {
  addProjectFromFolder,
  app,
  applyProjectFolder,
  changeProjectFolder,
  changeSessionFolder,
  confirmCloseSession,
  openSessionFolder,
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
  applyColor,
  isUnread,
  markRead,
  markUnread,
  openProjectFolder,
  rememberColor,
} from "../controller";
import { StatusIcon } from "./icons";
import { SettingsDialog } from "./settings";
import {
  ColorDialog,
  ColorPicker,
  MarkDialog,
  NoteDialog,
  QUICK_MARKS,
} from "./extras";

const EFFORT_LABEL: Record<string, string> = {
  low: "Bajo (low)",
  medium: "Medio (medium)",
  high: "Alto (high)",
  xhigh: "Muy alto (xhigh)",
  max: "Máximo (max)",
};

export function closeModal(): void {
  view.set({ modal: null });
  focusActive();
}

export function Backdrop({
  children,
  onClose,
  labelledBy,
}: {
  children: ComponentChildren;
  onClose(): void;
  labelledBy: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // En la ventana: Esc tiene que funcionar aunque el foco no esté dentro del diálogo.
    const onKey = (e: KeyboardEvent) => {
      const root = dialog.current;
      if (!root) return;
      if (e.key === "Escape") {
        if (
          (document.activeElement as HTMLElement | null)?.classList.contains(
            "capturing",
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      // El foco no se escapa: detrás hay una terminal que recibiría lo que se escriba.
      const items = [
        ...root.querySelectorAll<HTMLElement>(
          'button, input, select, [tabindex="0"]',
        ),
      ].filter((el) => !el.hasAttribute("disabled"));
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
      <div
        ref={dialog}
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * La paleta, los últimos colores elegidos fuera de ella y "Más colores". Con `onMore`, "Más colores" lo
 * resuelve quien llama (un menú abre un diálogo); sin él, el selector se abre aquí mismo.
 */
export function Swatches({
  value,
  onPick,
  onMore,
}: {
  value: string | null;
  onPick(color: string | null): void;
  onMore?(): void;
}) {
  const { state } = useStore(app);
  const [open, setOpen] = useState(false);
  const current = value?.toLowerCase() ?? null;
  const inPalette = PALETTE.some((p) => p.hex.toLowerCase() === current);
  const recent = state.settings.recentColors;
  // El color que tiene ahora, aunque ya no esté entre los recientes.
  const extra =
    current && !inPalette && !recent.includes(current)
      ? [current, ...recent].slice(0, recent.length + 1)
      : recent;
  const pick = (color: string | null) => {
    if (color) rememberColor(color);
    onPick(color);
  };
  const swatch = (hex: string, label: string, key: string) => (
    <button
      type="button"
      key={key}
      class={`swatch${current === hex.toLowerCase() ? " on" : ""}`}
      role="radio"
      aria-checked={current === hex.toLowerCase()}
      title={label}
      aria-label={label}
      style={{ background: hex }}
      onClick={() => pick(hex)}
    />
  );
  return (
    <div class="swatch-picker">
      <div class="swatches" role="radiogroup" aria-label="Color">
        <button
          type="button"
          class={`swatch none${value === null ? " on" : ""}`}
          role="radio"
          aria-checked={value === null}
          title="Sin color"
          onClick={() => onPick(null)}
        />
        {PALETTE.map((p) => swatch(p.hex, p.label, p.id))}
      </div>
      <div
        class="swatches recent"
        role="radiogroup"
        aria-label="Colores recientes"
      >
        {extra.map((hex) => swatch(hex, `Reciente: ${hex}`, hex))}
        <button
          type="button"
          class={`swatch more${open ? " on" : ""}`}
          data-action="more-colors"
          title="Más colores: cualquiera, o pegar un código"
          aria-label="Más colores"
          onClick={() => (onMore ? onMore() : setOpen(!open))}
        />
      </div>
      {open && !onMore && (
        <ColorPicker
          initial={value}
          onUse={(color) => {
            setOpen(false);
            pick(color);
          }}
        />
      )}
    </div>
  );
}

function NewSessionDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "newSession" }>;
}) {
  const { state } = useStore(app);
  const [kind, setKind] = useState<SessionKind>(modal.kind);
  const [projectId, setProjectId] = useState<string>(
    modal.projectId ?? state.projects[0]?.id ?? "",
  );
  const project = state.projects.find((p) => p.id === projectId) ?? null;
  const [name, setName] = useState(() =>
    defaultSessionName(project, modal.kind),
  );
  // En una ref: el efecto de abajo corre después del repintado y no debe pisar lo ya escrito.
  const touched = useRef(false);
  const [color, setColor] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  /** null: la del proyecto. */
  const [cwd, setCwd] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  useEffect(() => {
    if (!touched.current) setName(defaultSessionName(project, kind));
  }, [projectId, kind]);
  useEffect(() => setCwd(null), [projectId]);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!project) return;
    const input: Parameters<typeof createSession>[0] = {
      projectId: project.id,
      kind,
      name: name.trim() || defaultSessionName(project, kind),
      color,
    };
    if (kind === "claude" && model.trim()) input.model = model.trim();
    if (kind === "claude" && effort) input.effort = effort;
    if (cwd) input.cwd = cwd;
    view.set({ modal: null });
    void createSession(input);
  };

  return (
    <Backdrop onClose={closeModal} labelledBy="new-title">
      <form onSubmit={submit}>
        <h2 id="new-title">Nueva sesión</h2>
        <div class="seg" role="radiogroup" aria-label="Tipo de sesión">
          <button
            type="button"
            role="radio"
            aria-checked={kind === "claude"}
            class={kind === "claude" ? "on" : ""}
            onClick={() => setKind("claude")}
          >
            Claude Code
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === "shell"}
            class={kind === "shell" ? "on" : ""}
            onClick={() => setKind("shell")}
          >
            PowerShell
          </button>
        </div>
        <label class="field">
          <span>Proyecto</span>
          <div class="field-row">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
            >
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
              Nuevo proyecto…
            </button>
          </div>
        </label>
        <div class="field">
          <span>Carpeta</span>
          <div class="field-row">
            <small
              class="path session-cwd"
              data-field="cwd"
              title={cwd ?? project?.path}
            >
              {cwd ?? project?.path ?? ""}
            </small>
            <button
              type="button"
              data-action="pick-cwd"
              onClick={() => void api.pickFolder().then((p) => p && setCwd(p))}
            >
              Elegir otra…
            </button>
            {cwd && (
              <button type="button" onClick={() => setCwd(null)}>
                La del proyecto
              </button>
            )}
          </div>
          <small>
            Puede ser otra carpeta y seguir en este proyecto. Claude guarda la
            conversación por carpeta, así que no se cambia después.
          </small>
        </div>
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
        {kind === "claude" && (
          <div class="field-pair">
            <label class="field">
              <span>Modelo</span>
              <input
                data-field="model"
                list="models"
                value={model}
                placeholder="El de mi configuración"
                onInput={(e) => setModel(e.currentTarget.value)}
              />
              <datalist id="models">
                {MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label class="field">
              <span>Esfuerzo</span>
              <select
                data-field="effort"
                value={effort}
                onChange={(e) => setEffort(e.currentTarget.value)}
              >
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

function ConfirmDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "confirm" }>;
}) {
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
        <button
          class={modal.danger ? "danger" : "primary"}
          data-confirm="ok"
          onClick={() => done(true)}
        >
          {modal.ok}
        </button>
      </div>
    </Backdrop>
  );
}

/** Qué IDE abre este proyecto. Se recuerda por proyecto, y la ruta del programa la decide el proceso principal. */
function IdeDialog({ modal }: { modal: Extract<Modal, { type: "ide" }> }) {
  const { state } = useStore(app);
  const project = state.projects.find((p) => p.id === modal.projectId);
  const [found, setFound] = useState<DetectedIde[] | null>(null);
  const [problem, setProblem] = useState("");
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
    if (modal.file !== null || !project.ide)
      void openInIde(project.id, modal.file, modal.line);
  };
  const choose = (ide: DetectedIde) => {
    void api.ideChoose(project.id, ide.id).then((ok) => {
      if (ok) done();
      else setProblem("No se pudo guardar esa elección. Prueba otra vez.");
    });
  };
  const browse = () => {
    setProblem("");
    void api.idePick(project.id).then((r) => {
      if (r.ok) done();
      else if (r.message) setProblem(r.message);
    });
  };
  return (
    <Backdrop onClose={closeModal} labelledBy="ide-title">
      <h2 id="ide-title">¿Con qué abrir «{project.name}»?</h2>
      <p class="dialog-body">
        Hilo lo recordará para este proyecto. Se abre en su propia ventana.
      </p>
      {found === null && (
        <p class="dialog-body">Buscando programas instalados…</p>
      )}
      {found && found.length === 0 && (
        <p class="dialog-body">
          No se encontró ninguno en las carpetas habituales. Puedes buscar el
          .exe a mano.
        </p>
      )}
      {found && found.length > 0 && (
        <div class="ide-list">
          {found.map((ide, i) => (
            <button
              key={ide.id}
              ref={i === 0 ? first : undefined}
              class={`ide-item${project.ide?.path === ide.path ? " on" : ""}`}
              data-ide={ide.name}
              title={ide.path}
              onClick={() => choose(ide)}
            >
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
    <>{chars.map((c, i) => (marks.has(i) ? <mark key={i}>{c}</mark> : c))}</>
  );
}

function QuickOpen() {
  const { state } = useStore(app);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const items = allSessions(state)
      .filter((s) => !view.get().closing.includes(s.id))
      .map((s) => {
        const found = findSession(state, s.id)!;
        const match = fuzzyMatch(query, s.name);
        const projectMatch = match
          ? null
          : fuzzyMatch(query, found.project.name);
        return {
          s,
          project: found.project.name,
          match,
          score: match?.score ?? (projectMatch ? projectMatch.score - 2 : null),
        };
      });
    return items
      .filter((i) => i.score !== null)
      .sort((a, b) => {
        if (!query)
          return (
            STATUS_PRIORITY[statusOf(a.s.id)] -
            STATUS_PRIORITY[statusOf(b.s.id)]
          );
        return b.score! - a.score!;
      });
  }, [query, state]);

  const pick = (id: string) => {
    view.set({ modal: null });
    void selectSession(id);
  };
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector(".quick-item.on")
      ?.scrollIntoView({ block: "nearest" });
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
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((v) => Math.min(v + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((v) => Math.max(v - 1, 0));
            } else if (e.key === "Enter" && results[at]) {
              e.preventDefault();
              pick(results[at]!.s.id);
            }
          }}
        />
        <div ref={list} class="quick-list" role="listbox">
          {results.map((r, i) => (
            <button
              key={r.s.id}
              role="option"
              aria-selected={i === at}
              class={`quick-item${i === at ? " on" : ""}`}
              onMouseEnter={() => setAt(i)}
              onClick={() => pick(r.s.id)}
            >
              <StatusIcon status={statusOf(r.s.id)} />
              <span class="name">
                <Highlight
                  text={r.s.name}
                  positions={r.match?.positions ?? []}
                />
              </span>
              <span class="sub">{r.project}</span>
              <span class="quick-status">{STATUS_LABEL[statusOf(r.s.id)]}</span>
            </button>
          ))}
          {results.length === 0 && (
            <p class="quick-empty">
              {allSessions(state).length
                ? "Ninguna sesión se llama así."
                : "Aún no hay sesiones."}
            </p>
          )}
        </div>
      </div>
    </Backdrop>
  );
}

/** Campo de ajustes: confirma al salir o con Enter. Un repintado no pisa lo que se está escribiendo. */
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
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function SetupGuide({ initial }: { initial: ToolCheck }) {
  const [tools, setTools] = useState(initial);
  const [checked, setChecked] = useState(false);
  const close = () => {
    void dispatch({ type: "settings/set", patch: { setupSeen: true } });
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
      <h2 id="setup-title">
        {ready
          ? "Todo listo para usar Hilo"
          : "Lo que Hilo necesita en este PC"}
      </h2>
      <div class="setup-scroll">
        <section class="setup-tool" data-tool="claude">
          <h3>
            Claude Code:{" "}
            <span class={tools.claude ? "st-done" : "warn"}>
              {tools.claude ? "instalado" : "falta instalarlo"}
            </span>
          </h3>
          {tools.claude ? (
            <p>
              Si todavía no entras a tu cuenta, abre una sesión de Claude en
              Hilo y sigue lo que aparece en el navegador. Hilo no puede
              comprobarlo, porque no lee tus credenciales.
            </p>
          ) : (
            <>
              <p>
                Hilo abre tus sesiones con este programa. Sin él solo funcionan
                las terminales de PowerShell. Necesitas una cuenta de Claude de
                pago: el plan gratis no incluye Claude Code.
              </p>
              <ol>
                <li>
                  Abre PowerShell desde el menú Inicio, pega esto y presiona
                  Enter:
                  <CopyCommand command="irm https://claude.ai/install.ps1 | iex" />
                </li>
                <li>
                  Cuando termine, abre otra ventana de PowerShell, escribe{" "}
                  <code>claude</code> y sigue lo que aparece en el navegador
                  para entrar a tu cuenta.
                </li>
                <li>Vuelve aquí y presiona "Comprobar de nuevo".</li>
              </ol>
            </>
          )}
        </section>
        <section class="setup-tool" data-tool="git">
          <h3>
            Git:{" "}
            <span class={tools.git ? "st-done" : "warn"}>
              {tools.git ? "instalado" : "falta instalarlo"}
            </span>
          </h3>
          {!tools.git && (
            <>
              <p>
                Es opcional, pero conviene tenerlo: con él, Claude Code puede
                usar Git Bash, y el panel Cambios lo necesita para mostrar lo
                que cambió. Descárgalo desde su página o pega este comando en
                PowerShell:
              </p>
              <div class="setup-links">
                <button
                  type="button"
                  onClick={() =>
                    api.openLink("https://git-scm.com/downloads/win")
                  }
                >
                  Abrir la página de descarga
                </button>
              </div>
              <CopyCommand command="winget install Git.Git" />
            </>
          )}
        </section>
        {checked && !ready && (
          <p class="warn setup-note">
            Sigue faltando algo. Si ya lo instalaste, cierra y vuelve a abrir
            Hilo.
          </p>
        )}
      </div>
      <div class="actions">
        {!ready && <button onClick={recheck}>Comprobar de nuevo</button>}
        <button class="primary" data-confirm="ok" onClick={close}>
          {ready ? "Empezar" : "Seguir sin esto por ahora"}
        </button>
      </div>
    </Backdrop>
  );
}

/**
 * Cambiar la carpeta de un proyecto (#7). La carpeta nueva ya está elegida y guardada en el proceso principal: aquí
 * solo se ve, y lo único que sale de este diálogo es el código de un solo uso y qué sesiones se mueven.
 */
function RelocateDialog({ modal }: { modal: Extract<Modal, { type: "relocate" }> }) {
  const { state } = useStore(app);
  const project = state.projects.find((p) => p.id === modal.projectId);
  const { pick } = modal;
  // Con «mover también» marcado por defecto, como decidió el dueño.
  const [chosen, setChosen] = useState(() => new Set(pick.sessions.map((s) => s.id)));
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  if (!project) return null;
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  const apply = () => {
    closeModal();
    void applyProjectFolder(project.id, pick.token, [...chosen]);
  };
  return (
    <Backdrop onClose={closeModal} labelledBy="relocate-title">
      <h2 id="relocate-title">Cambiar la carpeta de «{project.name}»</h2>
      <div class="relocate-paths" data-relocate="paths">
        <span class="relocate-label">Antes</span>
        <code title={pick.from}>{pick.from}</code>
        <span class="relocate-label">Ahora</span>
        <code title={pick.to}>{pick.to}</code>
      </div>
      {pick.sessions.length > 0 ? (
        <>
          <p class="dialog-body">
            Estas sesiones estaban en la carpeta de antes o dentro de ella.
            Marca las que se mueven también: seguirán su conversación desde la
            carpeta nueva.
          </p>
          <div class="relocate-list" role="group" aria-label="Sesiones a mover">
            {pick.sessions.map((s) => (
              <label key={s.id} class="check relocate-item" data-relocate-session={s.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span class="relocate-name">
                  {s.name}
                  {s.sub && <small title="Su subcarpeta"> · {s.sub}</small>}
                </span>
                {!s.exists && (
                  <span class="relocate-gone" data-relocate-gone>
                    su carpeta ya no existe
                  </span>
                )}
              </label>
            ))}
          </div>
        </>
      ) : (
        <p class="dialog-body">
          Ninguna sesión de este proyecto trabaja en la carpeta de antes, así que
          solo cambia la carpeta del proyecto.
        </p>
      )}
      {pick.outside > 0 && (
        <p class="dialog-body" data-relocate="outside">
          {pick.outside === 1
            ? "Otra sesión trabaja en una carpeta distinta y no se toca."
            : `Otras ${pick.outside} sesiones trabajan en carpetas distintas y no se tocan.`}
          {pick.outsideMissing > 0 &&
            ` ${pick.outsideMissing === 1 ? "A una" : `A ${pick.outsideMissing}`} no se le encuentra la carpeta: se arregla con «Cambiar carpeta…» en su menú.`}
        </p>
      )}
      <div class="actions">
        <button onClick={closeModal}>Cancelar</button>
        <button ref={ok} class="primary" data-confirm="ok" onClick={apply}>
          Cambiar carpeta
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
    case "newSession":
      return <NewSessionDialog modal={m} />;
    case "confirm":
      // Con clave propia: otro diálogo no hereda el foco en el botón de confirmar del anterior.
      return <ConfirmDialog key={m.title} modal={m} />;
    case "quick":
      return <QuickOpen />;
    case "setup":
      return <SetupGuide initial={m.tools} />;
    case "ide":
      return <IdeDialog modal={m} />;
    case "relocate":
      return <RelocateDialog modal={m} />;
    case "settings":
      return <SettingsDialog modal={m} />;
    case "color":
      return <ColorDialog modal={m} />;
    case "note":
      return <NoteDialog modal={m} />;
    case "mark":
      return <MarkDialog modal={m} />;
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
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        close();
        focusActive();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      e.stopPropagation();
      const items = [
        ...(ref.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? []),
      ];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
      items[next]!.focus();
    };
    // En captura: la terminal corta el evento, y un clic en ella también tiene que cerrar el menú.
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    ref.current?.querySelector("button")?.focus();
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
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

  if (m.target.type === "session") {
    const found = findSession(state, m.target.id);
    if (!found) return null;
    const { session, project } = found;
    const status = statusOf(session.id);
    return (
      <div
        ref={ref}
        class="menu"
        role="menu"
        style={{ left: `${left}px`, top: `${Math.max(4, top)}px` }}
        onMouseDown={stop}
      >
        <button
          role="menuitem"
          onClick={() => {
            view.set({ menu: null });
            startRename(session.id);
          }}
        >
          Renombrar <kbd>{keysOf("rename")}</kbd>
        </button>
        {session.kind === "claude" && (
          <button
            role="menuitem"
            onClick={() => {
              close();
              void copyLastMessage(session.id);
            }}
          >
            Copiar respuesta <kbd>{keysOf("copyLastMessage")}</kbd>
          </button>
        )}
        {isUnread(session) ? (
          <button
            role="menuitem"
            data-action="mark-read"
            onClick={() => {
              close();
              void markRead(session.id);
            }}
          >
            Marcar como leída
          </button>
        ) : (
          <button
            role="menuitem"
            data-action="mark-unread"
            onClick={() => {
              close();
              void markUnread(session.id);
            }}
          >
            Marcar como no leída
          </button>
        )}
        <button
          role="menuitem"
          data-action="note"
          onClick={() =>
            view.set({ menu: null, modal: { type: "note", id: session.id } })
          }
        >
          {session.note ? "Editar la nota…" : "Dejar una nota…"}
        </button>
        <button
          role="menuitem"
          data-action="open-session-folder"
          title={session.cwd}
          onClick={() => {
            close();
            void openSessionFolder(session.id);
          }}
        >
          Abrir su carpeta
        </button>
        <button
          role="menuitem"
          data-action="change-session-folder"
          title={`Ahora: ${session.cwd}`}
          onClick={() => {
            close();
            void changeSessionFolder(session.id);
          }}
        >
          Cambiar carpeta…
        </button>
        {status === "asleep" ? (
          <button
            role="menuitem"
            onClick={() => {
              close();
              void wakeSession(session.id);
            }}
          >
            Despertar <kbd>{keysOf("toggleSleep")}</kbd>
          </button>
        ) : (
          <button
            role="menuitem"
            disabled={status === "working"}
            title={
              status === "working"
                ? "Está trabajando: podrás dormirla cuando termine"
                : undefined
            }
            onClick={() => {
              close();
              void sleepSession(session.id);
            }}
          >
            Dormir <kbd>{keysOf("toggleSleep")}</kbd>
          </button>
        )}
        {status !== "asleep" && (
          <button
            role="menuitem"
            onClick={() => {
              view.set({ menu: null });
              void selectSession(session.id).then(() => runCommand("search"));
            }}
          >
            Buscar <kbd>{keysOf("search")}</kbd>
          </button>
        )}
        {state.ui.activeSessionId !== session.id && (
          <button
            role="menuitem"
            onClick={() => {
              close();
              void (async () => {
                const { ui } = app.get().state;
                if (ui.layout === 1)
                  await dispatch({ type: "ui/layout", layout: 2 });
                const panes = app.get().state.ui.panes;
                const other = panes.findIndex(
                  (_, i) => i !== app.get().state.ui.activePane,
                );
                await dispatch({
                  type: "ui/pane",
                  pane: other,
                  sessionId: session.id,
                });
                await selectSession(session.id);
              })();
            }}
          >
            Ver junto a la actual
          </button>
        )}
        <div class="menu-sep" />
        <div class="menu-label">Marca</div>
        <div class="menu-marks" role="group" aria-label="Marca">
          {QUICK_MARKS.map((mark) => (
            <button
              key={mark}
              class={`mark-pick${session.mark === mark ? " on" : ""}`}
              title={session.mark === mark ? "Quitar la marca" : undefined}
              onClick={() => {
                close();
                void dispatch({
                  type: "session/mark",
                  id: session.id,
                  mark: session.mark === mark ? null : mark,
                });
              }}
            >
              {mark}
            </button>
          ))}
          <button
            class="mark-pick more"
            title="Más marcas, o una propia"
            aria-label="Más marcas"
            onClick={() =>
              view.set({ menu: null, modal: { type: "mark", id: session.id } })
            }
          >
            …
          </button>
        </div>
        <div class="menu-label">Color</div>
        <div class="menu-swatches">
          <Swatches
            value={session.color}
            onPick={(color) => {
              close();
              void applyColor({ type: "session", id: session.id }, color);
            }}
            onMore={() =>
              view.set({
                menu: null,
                modal: {
                  type: "color",
                  target: { type: "session", id: session.id },
                },
              })
            }
          />
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
                    void dispatch({
                      type: "session/move",
                      id: session.id,
                      toProjectId: p.id,
                      toIndex: p.sessions.length,
                    });
                    moveToast(session, p, false);
                  }}
                >
                  {p.name}
                </button>
              ))}
          </>
        )}
        <div class="menu-sep" />
        <button
          role="menuitem"
          class="danger-item"
          onClick={() => {
            close();
            void confirmCloseSession(session.id);
          }}
        >
          Cerrar esta sesión <kbd>{keysOf("closeSession")}</kbd>
        </button>
      </div>
    );
  }

  const project = state.projects.find(
    (p) => p.id === (m.target as { id: string }).id,
  );
  if (!project) return null;
  return (
    <div
      ref={ref}
      class="menu"
      role="menu"
      style={{ left: `${left}px`, top: `${Math.max(4, top)}px` }}
      onMouseDown={stop}
    >
      <button
        role="menuitem"
        onClick={() => {
          view.set({
            menu: null,
            modal: {
              type: "newSession",
              kind: "claude",
              projectId: project.id,
            },
          });
        }}
      >
        Nueva sesión
      </button>
      <button
        role="menuitem"
        onClick={() => {
          view.set({ menu: null, renaming: project.id });
        }}
      >
        Renombrar
      </button>
      <div class="menu-sep" />
      <button
        role="menuitem"
        data-action="menu-changes"
        onClick={() => {
          close();
          void toggleChanges(project.id);
        }}
      >
        {state.ui.panes.includes(changesPaneId(project.id))
          ? "Quitar los cambios"
          : "Ver los cambios"}{" "}
        <kbd>{keysOf("toggleChanges")}</kbd>
      </button>
      <button
        role="menuitem"
        data-action="menu-folder"
        onClick={() => {
          close();
          void openProjectFolder(project.id);
        }}
      >
        Abrir la carpeta
      </button>
      <button
        role="menuitem"
        data-action="menu-change-folder"
        onClick={() => {
          close();
          void changeProjectFolder(project.id);
        }}
      >
        Cambiar carpeta…
      </button>
      <button
        role="menuitem"
        data-action="menu-ide"
        onClick={() => {
          view.set({ menu: null });
          void openInIde(project.id);
        }}
      >
        {project.ide ? `Abrir en ${project.ide.name}` : "Abrir en un IDE…"}
      </button>
      {project.ide && (
        <button
          role="menuitem"
          data-action="menu-ide-change"
          onClick={() =>
            view.set({
              menu: null,
              modal: {
                type: "ide",
                projectId: project.id,
                file: null,
                line: null,
              },
            })
          }
        >
          Cambiar de IDE…
        </button>
      )}
      <div class="menu-sep" />
      <div class="menu-label">Color</div>
      <div class="menu-swatches">
        <Swatches
          value={project.color}
          onPick={(color) => {
            close();
            void applyColor({ type: "project", id: project.id }, color);
          }}
          onMore={() =>
            view.set({
              menu: null,
              modal: {
                type: "color",
                target: { type: "project", id: project.id },
              },
            })
          }
        />
      </div>
      <div class="menu-sep" />
      <button
        role="menuitem"
        class="danger-item"
        onClick={() => {
          view.set({ menu: null });
          const count = project.sessions.length;
          void (async () => {
            const { confirmDialog } = await import("../controller");
            const ok = await confirmDialog({
              title: `Quitar «${project.name}» de Hilo`,
              body: count
                ? `${count === 1 ? "Se cierra su sesión" : `Se cierran sus ${count} sesiones`}. Los archivos de la carpeta y las conversaciones de Claude no se tocan.`
                : "Los archivos de la carpeta no se tocan.",
              ok: "Quitar proyecto",
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

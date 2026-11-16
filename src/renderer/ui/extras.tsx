import { useEffect, useRef, useState } from "preact/hooks";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../../shared/color";
import { findSession } from "../../shared/reducer";
import { isMark, MAX_NOTE } from "../../shared/validate";
import { api } from "../api";
import {
  app,
  applyColor,
  dispatch,
  toast,
  useStore,
  type Modal,
} from "../controller";
import { Backdrop, closeModal } from "./dialogs";

/** Las que salen a la vista en el menú; el resto, en "Más…". */
export const QUICK_MARKS = ["⭐", "🔥", "❗", "📌", "👀", "🐛", "✅", "⏳"];
const MORE_MARKS = [
  ...QUICK_MARKS,
  "❓",
  "🚧",
  "💡",
  "🎯",
  "🧪",
  "📝",
  "🔒",
  "🚀",
  "💬",
  "🧹",
  "🎨",
  "📦",
  "🔧",
  "⚠️",
  "❤️",
  "💤",
  "🔴",
  "🟠",
  "🟡",
  "🟢",
  "🔵",
  "🟣",
  "⚫",
  "⚪",
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Arrastrar dentro de una zona: da la posición de 0 a 1 en cada eje. */
function dragHandlers(onPos: (x: number, y: number) => void) {
  const update = (el: HTMLElement, e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    onPos(
      clamp01((e.clientX - r.left) / r.width),
      clamp01((e.clientY - r.top) / r.height),
    );
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      update(el, e);
    },
    onPointerMove: (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) update(el, e);
    },
  };
}

/** Cualquier color: tono, saturación y brillo, o el código pegado. */
export function ColorPicker({
  initial,
  onUse,
}: {
  initial: string | null;
  onUse(color: string): void;
}) {
  const [hsv, setHsvState] = useState<Hsv>(() =>
    hexToHsv(initial ?? "#6f9bd1"),
  );
  const hex = hsvToHex(hsv);
  const [text, setText] = useState(hex);
  const setHsv = (next: Hsv) => {
    setHsvState(next);
    setText(hsvToHex(next));
  };
  const copy = () => {
    void api.clipWrite(hex).then(
      () => toast(`Se copió ${hex}.`),
      () =>
        toast("No se pudo copiar: otro programa está usando el portapapeles."),
    );
  };
  return (
    <div class="color-picker">
      <div
        class="cp-area"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        {...dragHandlers((x, y) => setHsv({ ...hsv, s: x, v: 1 - y }))}
      >
        <span
          class="cp-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: hex,
          }}
        />
      </div>
      <div
        class="cp-hue"
        {...dragHandlers((x) =>
          setHsv({ ...hsv, h: Math.min(359.9, x * 360) }),
        )}
      >
        <span
          class="cp-thumb"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            top: "50%",
            background: `hsl(${hsv.h} 100% 50%)`,
          }}
        />
      </div>
      <div class="cp-row">
        <span class="cp-preview" style={{ background: hex }} />
        <input
          class="cp-hex"
          aria-label="Código del color"
          spellcheck={false}
          maxLength={7}
          value={text}
          onInput={(e) => {
            const value = e.currentTarget.value;
            setText(value);
            const parsed = normalizeHex(value);
            if (parsed) setHsvState(hexToHsv(parsed));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onUse(normalizeHex(text) ?? hex);
            }
          }}
        />
        <button
          type="button"
          class="secondary"
          title="Copiar el código del color"
          onClick={copy}
        >
          Copiar
        </button>
        <button
          type="button"
          class="primary"
          data-action="use-color"
          onClick={() => onUse(normalizeHex(text) ?? hex)}
        >
          Usar
        </button>
      </div>
    </div>
  );
}

export function ColorDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "color" }>;
}) {
  const { state } = useStore(app);
  const t = modal.target;
  const item =
    t.type === "session"
      ? findSession(state, t.id)?.session
      : state.projects.find((p) => p.id === t.id);
  if (!item) return null;
  return (
    <Backdrop onClose={closeModal} labelledBy="color-title">
      <h2 id="color-title">Color de «{item.name}»</h2>
      <ColorPicker
        initial={item.color}
        onUse={(color) => {
          closeModal();
          void applyColor(t, color);
        }}
      />
      <p class="dialog-body cp-hint">
        Los que elijas aquí quedan entre los recientes, para usarlos en otras
        sesiones.
      </p>
    </Backdrop>
  );
}

export function NoteDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "note" }>;
}) {
  const { state } = useStore(app);
  const session = findSession(state, modal.id)?.session;
  const [text, setText] = useState(session?.note ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  if (!session) return null;
  const save = (note: string) => {
    closeModal();
    void dispatch({ type: "session/note", id: session.id, note });
  };
  return (
    <Backdrop onClose={closeModal} labelledBy="note-title">
      <h2 id="note-title">Nota de «{session.name}»</h2>
      <p class="dialog-body">
        Se ve al pasar el ratón por la sesión, y en su panel mientras está
        dormida.
      </p>
      <textarea
        ref={ref}
        class="note-input"
        data-field="note"
        rows={7}
        maxLength={MAX_NOTE}
        value={text}
        placeholder="Qué quedó pendiente, qué revisar al volver…"
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            save(text);
          }
        }}
      />
      <div class="actions">
        {session.note && (
          <button class="note-delete" onClick={() => save("")}>
            Borrar la nota
          </button>
        )}
        <button onClick={closeModal}>Cancelar</button>
        <button
          class="primary"
          data-action="save-note"
          title="Ctrl+Enter"
          onClick={() => save(text)}
        >
          Guardar
        </button>
      </div>
    </Backdrop>
  );
}

export function MarkDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "mark" }>;
}) {
  const { state } = useStore(app);
  const session = findSession(state, modal.id)?.session;
  const [text, setText] = useState("");
  if (!session) return null;
  const choose = (mark: string | null) => {
    closeModal();
    void dispatch({ type: "session/mark", id: session.id, mark });
  };
  const typed = text.trim();
  return (
    <Backdrop onClose={closeModal} labelledBy="mark-title">
      <h2 id="mark-title">Marca de «{session.name}»</h2>
      <div class="mark-grid" role="group" aria-label="Marcas">
        {MORE_MARKS.map((m) => (
          <button
            key={m}
            class={`mark-pick${session.mark === m ? " on" : ""}`}
            onClick={() => choose(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <label class="field">
        <span>
          U otra: escríbela o pégala. Con Win + . se abren los emojis de
          Windows.
        </span>
        <input
          value={text}
          maxLength={16}
          data-field="mark"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isMark(typed)) choose(typed);
          }}
        />
      </label>
      <div class="actions">
        {session.mark && (
          <button onClick={() => choose(null)}>Quitar la marca</button>
        )}
        <button onClick={closeModal}>Cancelar</button>
        <button
          class="primary"
          disabled={!isMark(typed)}
          onClick={() => choose(typed)}
        >
          Usar esa
        </button>
      </div>
    </Backdrop>
  );
}

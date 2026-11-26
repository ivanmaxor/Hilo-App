import { useEffect, useRef, useState } from "preact/hooks";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../../shared/color";
import { findSession } from "../../shared/reducer";
import type { SessionNote } from "../../shared/types";
import { noteTime } from "../../shared/sessionNotes";
import {
  isMark,
  MAX_DESCRIPTION,
  MAX_NAME,
  MAX_NOTE,
} from "../../shared/validate";
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

/** Un id para una nota nueva: solo letras, números y guiones, como pide `isSafeId`. */
function newNoteId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function copyToClipboard(text: string, what: string): Promise<void> {
  try {
    await api.clipWrite(text);
    toast(`Se copió ${what}.`);
  } catch {
    toast("No se pudo copiar: otro programa está usando el portapapeles.");
  }
}

/**
 * El perfil de una sesión: su nombre, para qué es, con qué id se retoma su conversación y una bitácora de
 * notas con fecha. Las notas se agregan, se editan y se borran una por una; el nombre y la descripción se
 * guardan con Guardar.
 */
export function ProfileDialog({
  modal,
}: {
  modal: Extract<Modal, { type: "profile" }>;
}) {
  const { state } = useStore(app);
  const session = findSession(state, modal.id)?.session;
  const [name, setName] = useState(session?.name ?? "");
  const [description, setDescription] = useState(session?.description ?? "");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  if (!session) return null;
  const notes = [...(session.notes ?? [])].reverse();

  const addNote = () => {
    if (!draft.trim()) return;
    void dispatch({
      type: "session/noteAdd",
      id: session.id,
      note: { id: newNoteId(), at: Date.now(), text: draft },
    });
    setDraft("");
  };
  const removeNote = (note: SessionNote) => {
    void dispatch({ type: "session/noteRemove", id: session.id, noteId: note.id });
    toast("Se borró la nota.", {
      label: "Deshacer",
      run: () => void dispatch({ type: "session/noteAdd", id: session.id, note }),
    });
  };
  const save = () => {
    addNote();
    const nextName = name.trim();
    if (nextName && nextName !== session.name)
      void dispatch({ type: "session/rename", id: session.id, name: nextName });
    if (description !== (session.description ?? ""))
      void dispatch({ type: "session/describe", id: session.id, description });
    closeModal();
  };

  return (
    <Backdrop onClose={closeModal} labelledBy="profile-title">
      <h2 id="profile-title">
        {session.mark ? `${session.mark} ` : ""}Perfil de «{session.name}»
      </h2>
      <div class="profile">
        <label class="profile-field">
          <span>Nombre</span>
          <input
            data-field="profile-name"
            value={name}
            maxLength={MAX_NAME}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label class="profile-field">
          <span>Descripción</span>
          <textarea
            class="note-input profile-description"
            data-field="description"
            rows={2}
            maxLength={MAX_DESCRIPTION}
            value={description}
            placeholder="Para qué es esta sesión"
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </label>
        <dl class="profile-facts">
          {session.kind === "claude" && (
            <>
              <dt>ID de la conversación</dt>
              <dd>
                <code data-field="claude-id">{session.claudeId}</code>
                <button
                  class="link"
                  data-action="copy-claude-id"
                  title="Con este id, claude --resume retoma la conversación desde cualquier carpeta"
                  onClick={() => void copyToClipboard(session.claudeId, "el id de la conversación")}
                >
                  Copiar
                </button>
              </dd>
            </>
          )}
          <dt>Carpeta</dt>
          <dd>
            <code>{session.cwd}</code>
            <button class="link" onClick={() => void copyToClipboard(session.cwd, "la carpeta")}>
              Copiar
            </button>
          </dd>
          <dt>Creada</dt>
          <dd>{noteTime(session.createdAt)}</dd>
        </dl>

        <h3 class="profile-heading">Bitácora</h3>
        <textarea
          ref={ref}
          class="note-input profile-draft"
          data-field="note"
          rows={3}
          maxLength={MAX_NOTE}
          value={draft}
          placeholder="Qué hiciste, qué quedó pendiente, qué revisar al volver…"
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) {
              e.preventDefault();
              addNote();
            }
          }}
        />
        <div class="profile-row-actions">
          <button
            data-action="add-note"
            title="Ctrl+Enter"
            disabled={!draft.trim()}
            onClick={addNote}
          >
            Agregar nota
          </button>
        </div>
        {notes.length === 0 ? (
          <p class="dialog-body">Todavía no hay notas.</p>
        ) : (
          <ol class="profile-log" data-count={notes.length}>
            {notes.map((note) => (
              <li key={note.id} data-note-id={note.id}>
                <div class="profile-log-head">
                  <time>{noteTime(note.at)}</time>
                  {editing?.id !== note.id && (
                    <>
                      <button
                        class="link"
                        data-action="edit-note"
                        onClick={() => setEditing({ id: note.id, text: note.text })}
                      >
                        Editar
                      </button>
                      <button
                        class="link"
                        data-action="delete-note"
                        onClick={() => removeNote(note)}
                      >
                        Borrar
                      </button>
                    </>
                  )}
                </div>
                {editing?.id === note.id ? (
                  <>
                    <textarea
                      class="note-input"
                      data-field="note-edit"
                      rows={3}
                      maxLength={MAX_NOTE}
                      value={editing.text}
                      onInput={(e) =>
                        setEditing({ id: note.id, text: e.currentTarget.value })
                      }
                    />
                    <div class="profile-row-actions">
                      <button onClick={() => setEditing(null)}>Cancelar</button>
                      <button
                        class="primary"
                        data-action="save-note-edit"
                        onClick={() => {
                          void dispatch({
                            type: "session/noteEdit",
                            id: session.id,
                            noteId: note.id,
                            text: editing.text,
                          });
                          setEditing(null);
                        }}
                      >
                        Guardar la nota
                      </button>
                    </div>
                  </>
                ) : (
                  <p>{note.text}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div class="actions">
        <button onClick={closeModal}>Cancelar</button>
        <button
          class="primary"
          data-action="save-note"
          title="Guarda el nombre, la descripción y la nota que estés escribiendo"
          onClick={save}
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

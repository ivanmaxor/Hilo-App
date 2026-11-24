import { sanitizePaste } from "./paste";
import type { SessionKind, SessionStatus } from "./types";

/**
 * El último mensaje de Claude en una conversación guardada (`<sesión>.jsonl`), para copiarlo (D26).
 * Claude guarda cada bloque de un mismo mensaje en su propia línea: se juntan los de texto del
 * último mensaje que tenga texto. Lo de los subagentes (`isSidechain`) no cuenta.
 */
export function lastAssistantText(jsonl: string): string | null {
  const lines = jsonl.split("\n");
  let id: string | null = null;
  let parts: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{") || !line.includes('"assistant"')) continue;
    let entry: {
      type?: unknown;
      isSidechain?: unknown;
      message?: { id?: unknown; role?: unknown; content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      // La primera línea del final leído puede venir cortada.
      continue;
    }
    if (
      entry.type !== "assistant" ||
      entry.isSidechain === true ||
      entry.message?.role !== "assistant"
    )
      continue;
    const messageId =
      typeof entry.message.id === "string" ? entry.message.id : `línea ${i}`;
    const content = entry.message.content;
    const texts = Array.isArray(content)
      ? content
          .filter(
            (b): b is { type: "text"; text: string } =>
              !!b && b.type === "text" && typeof b.text === "string",
          )
          .map((b) => b.text)
      : typeof content === "string"
        ? [content]
        : [];
    if (id === null) {
      if (!texts.some((t) => t.trim())) continue;
      id = messageId;
      parts = texts;
    } else if (messageId === id) {
      parts = [...texts, ...parts];
    } else {
      break;
    }
  }
  const text = parts.join("\n\n").trim();
  return text ? text : null;
}

/** Lo que se copia: el nombre de la sesión, dos puntos, una línea en blanco y el mensaje. */
export function formatCopiedMessage(sessionName: string, text: string): string {
  return `${sessionName}:\n\n${text}`;
}

/**
 * Lo que se pega en otra sesión (idea «Enviar su última respuesta a…»): lo mismo que «Copiar respuesta», con
 * `De «Nombre»:` de encabezado, una línea en blanco y el mensaje. Se limpia aquí y otra vez al pegar: el nombre lo escribe la persona y el mensaje viene
 * de un archivo que Claude Code guarda, y ninguno puede llevar controles que se salgan del pegado.
 */
export function formatSentMessage(sessionName: string, text: string): string {
  // eslint-disable-next-line no-control-regex
  const name = sessionName.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  const body = sanitizePaste(text).replace(/\r\n?/g, "\n").trim();
  // El mismo formato que «Copiar respuesta»: encabezado, dos puntos, línea en blanco y el mensaje.
  return formatCopiedMessage(`De «${name}»`, body);
}

/**
 * Por qué no se le puede pegar a una sesión, o null si se puede. Una dormida sí: se despierta antes de pegar.
 * Una PowerShell nunca es destino: es una respuesta de Claude para otro Claude.
 */
export function replyTargetProblem(
  kind: SessionKind,
  status: SessionStatus,
  name: string,
): string | null {
  if (kind !== "claude")
    return `«${name}» es una PowerShell: la respuesta solo se envía a sesiones de Claude.`;
  if (status === "error" || status === "exited")
    return `«${name}» ya no tiene proceso.`;
  if (status === "waiting")
    return `«${name}» está esperando una respuesta tuya: lo que se pegue podría contestarle.`;
  return null;
}

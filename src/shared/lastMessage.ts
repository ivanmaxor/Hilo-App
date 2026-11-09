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

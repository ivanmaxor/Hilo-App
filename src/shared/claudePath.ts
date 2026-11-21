/**
 * ¿La ruta configurada parece Claude Code? Solo mira el nombre y la carpeta: ejecutar un .exe cualquiera
 * para preguntarle su versión podría abrir un instalador o la app de escritorio. null si parece bien.
 */
export function claudePathProblem(path: string): string | null {
  const p = path.trim();
  if (!p) return null;
  // Claude Desktop también se llama Claude.exe: se reconoce por su carpeta.
  if (
    /[\\/](AnthropicClaude|WindowsApps[\\/][^\\/]*Claude[^\\/]*)[\\/]/i.test(p)
  ) {
    return "Esa ruta es Claude Desktop, la app de chat, no Claude Code.";
  }
  const name = p.split(/[\\/]/).pop() ?? "";
  if (!/^claude\.(exe|cmd|bat)$/i.test(name)) {
    return `Ese archivo no parece Claude Code: se llama «${name}», y Claude Code es claude.exe (o claude.cmd si se instaló con npm).`;
  }
  return null;
}

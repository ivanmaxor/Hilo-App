/**
 * Cómo se le pide a cada IDE que abra un archivo en una línea. Las fuentes de cada sintaxis están en
 * docs/DECISIONES.md, D21. Lo que un IDE no permite no se inventa: abre el archivo y ya.
 */
export type IdeKind = 'netbeans' | 'vscode' | 'jetbrains' | 'devenv' | 'eclipse' | 'sublime' | 'notepadpp' | 'generic';

export interface DetectedIde {
  /** Opaco: el renderer elige por este id, nunca por la ruta. */
  id: string;
  name: string;
  path: string;
}

export type IdeOpenResult =
  | { ok: true; jumped: boolean }
  | { ok: false; reason: 'none' | 'missing' | 'file' | 'spawn'; message: string };

const JETBRAINS: Record<string, string> = {
  idea64: 'IntelliJ IDEA',
  webstorm64: 'WebStorm',
  pycharm64: 'PyCharm',
  phpstorm64: 'PhpStorm',
  goland64: 'GoLand',
  clion64: 'CLion',
  rider64: 'Rider',
  rubymine64: 'RubyMine',
  rustrover64: 'RustRover',
  datagrip64: 'DataGrip',
};

const VSCODE_LIKE: Record<string, string> = {
  code: 'Visual Studio Code',
  'code - insiders': 'VS Code Insiders',
  vscodium: 'VSCodium',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
};

function baseName(exePath: string): string {
  return (exePath.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase();
}

export function ideKind(exePath: string): IdeKind {
  const base = baseName(exePath);
  if (/^netbeans(64)?$/.test(base)) return 'netbeans';
  if (base in VSCODE_LIKE) return 'vscode';
  if (base in JETBRAINS) return 'jetbrains';
  if (base === 'devenv') return 'devenv';
  if (base === 'eclipse') return 'eclipse';
  if (base === 'subl' || base === 'sublime_text') return 'sublime';
  if (base === 'notepad++') return 'notepadpp';
  return 'generic';
}

/** El nombre que se muestra cuando el programa se eligió a mano. */
export function ideName(exePath: string): string {
  const base = baseName(exePath);
  if (/^netbeans(64)?$/.test(base)) return 'NetBeans';
  if (base === 'devenv') return 'Visual Studio';
  if (base === 'eclipse') return 'Eclipse';
  if (base === 'subl' || base === 'sublime_text') return 'Sublime Text';
  if (base === 'notepad++') return 'Notepad++';
  const known = VSCODE_LIKE[base] ?? JETBRAINS[base];
  if (known) return known;
  const raw = exePath.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? '';
  return raw || 'el IDE';
}

/** Si ese IDE puede saltar a una línea desde la línea de comandos. */
export function ideJumpsToLine(kind: IdeKind): boolean {
  return kind !== 'devenv' && kind !== 'eclipse' && kind !== 'generic';
}

/** Argumentos para abrir el proyecto, o un archivo si se indica. Las rutas son absolutas: nunca parecen un flag. */
export function ideArgs(kind: IdeKind, target: { project: string; file?: string; line?: number }): string[] {
  const { project, file, line } = target;
  if (!file) {
    switch (kind) {
      case 'netbeans':
        return ['--open', project];
      case 'eclipse':
        // Eclipse trabaja por espacios de trabajo: una carpeta suelta no se abre como proyecto.
        return [];
      case 'notepadpp':
        // Sin esto abriría cada archivo de la carpeta.
        return ['-openFoldersAsWorkspace', project];
      default:
        return [project];
    }
  }
  const at = line && line > 0 ? line : null;
  switch (kind) {
    case 'netbeans':
      return ['--open', at ? `${file}:${at}` : file];
    case 'vscode':
      return [project, '--goto', `${file}:${at ?? 1}`];
    case 'jetbrains':
      return at ? ['--line', String(at), file] : [file];
    case 'devenv':
      return ['/Edit', file];
    case 'eclipse':
      return ['--launcher.openFile', file];
    case 'sublime':
      return [at ? `${file}:${at}` : file];
    case 'notepadpp':
      return at ? [`-n${at}`, file] : [file];
    default:
      return [file];
  }
}

/** Un .exe local con ruta absoluta. Una ruta de red colgaría al lanzar, y un .cmd exigiría shell. */
export function isValidIdePath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1024) return false;
  if (/[\x00-\x1f"<>|?*]/.test(v)) return false;
  if (!/^[A-Za-z]:[\\/]/.test(v) || !/\.exe$/i.test(v)) return false;
  return !v.split(/[\\/]/).includes('..');
}

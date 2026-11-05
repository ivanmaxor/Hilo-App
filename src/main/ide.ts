import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ideArgs, ideJumpsToLine, ideKind, ideName, isValidIdePath, type DetectedIde, type IdeOpenResult } from '../shared/ide';

/** Dónde buscar. En pruebas son carpetas temporales: nunca se detecta ni se abre un IDE de verdad. */
export interface IdeRoots {
  programFiles: string[];
  localAppData: string[];
  userProfile: string[];
}

export function ideRootsFromEnv(env: NodeJS.ProcessEnv = process.env): IdeRoots {
  if (env.HILO_E2E === '1') {
    const test = env.HILO_TEST_IDE_ROOT;
    return test ? { programFiles: [join(test, 'pf')], localAppData: [join(test, 'local')], userProfile: [join(test, 'home')] } : { programFiles: [], localAppData: [], userProfile: [] };
  }
  const unique = (list: (string | undefined)[]) => [...new Set(list.filter((v): v is string => !!v))];
  return {
    programFiles: unique([env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]),
    localAppData: unique([env.LOCALAPPDATA]),
    userProfile: unique([env.USERPROFILE]),
  };
}

function dirsIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const VERSION = /(\d+(?:\.\d+)*)/;

const JETBRAINS_EXES = ['idea64', 'webstorm64', 'pycharm64', 'phpstorm64', 'goland64', 'clion64', 'rider64', 'rubymine64', 'rustrover64', 'datagrip64'];

/** Mira solo rutas conocidas y a poca profundidad: se llama al abrir el selector y tiene que ser inmediato. */
export function detectIdes(roots: IdeRoots): DetectedIde[] {
  const found: { name: string; path: string }[] = [];
  const add = (name: string, path: string) => {
    if (isFile(path) && !found.some((f) => f.path.toLowerCase() === path.toLowerCase())) found.push({ name, path });
  };
  const programs = [...roots.programFiles, ...roots.localAppData.map((d) => join(d, 'Programs'))];

  for (const root of programs) {
    // NetBeans se instala en carpetas con la versión: `NetBeans-23\netbeans\bin` o `NetBeans 8.2\bin`.
    for (const dir of dirsIn(root).filter((d) => /netbeans/i.test(d))) {
      const version = VERSION.exec(dir)?.[1];
      const name = version ? `NetBeans ${version}` : 'NetBeans';
      add(name, join(root, dir, 'netbeans', 'bin', 'netbeans64.exe'));
      add(name, join(root, dir, 'bin', 'netbeans64.exe'));
    }
    add('Visual Studio Code', join(root, 'Microsoft VS Code', 'Code.exe'));
    add('VS Code Insiders', join(root, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'));
    add('VSCodium', join(root, 'VSCodium', 'VSCodium.exe'));
    add('Cursor', join(root, 'cursor', 'Cursor.exe'));
    add('Windsurf', join(root, 'Windsurf', 'Windsurf.exe'));
    // JetBrains: en una carpeta por versión. La Toolbox nueva instala en `Programs`.
    const jetbrainsDirs = [
      ...dirsIn(join(root, 'JetBrains')).map((d) => join(root, 'JetBrains', d)),
      ...dirsIn(root)
        .filter((d) => /intellij|pycharm|webstorm|phpstorm|goland|clion|rider|rubymine|rustrover|datagrip/i.test(d))
        .map((d) => join(root, d)),
    ];
    for (const dir of jetbrainsDirs) {
      for (const exe of JETBRAINS_EXES) {
        const path = join(dir, 'bin', `${exe}.exe`);
        const label = dir.split(/[\\/]/).pop() ?? '';
        add(/\d/.test(label) ? label : ideName(path), path);
      }
    }
    for (const year of dirsIn(join(root, 'Microsoft Visual Studio'))) {
      for (const edition of dirsIn(join(root, 'Microsoft Visual Studio', year))) {
        add(`Visual Studio ${year} ${edition}`, join(root, 'Microsoft Visual Studio', year, edition, 'Common7', 'IDE', 'devenv.exe'));
      }
    }
    add('Eclipse', join(root, 'eclipse', 'eclipse.exe'));
    add('Sublime Text', join(root, 'Sublime Text', 'subl.exe'));
    add('Sublime Text', join(root, 'Sublime Text 3', 'subl.exe'));
    add('Notepad++', join(root, 'Notepad++', 'notepad++.exe'));
  }
  // La Toolbox de JetBrains anterior: apps\<ide>\ch-0\<versión>\bin.
  for (const local of roots.localAppData) {
    const apps = join(local, 'JetBrains', 'Toolbox', 'apps');
    for (const app of dirsIn(apps)) {
      for (const channel of dirsIn(join(apps, app))) {
        for (const build of dirsIn(join(apps, app, channel)).reverse()) {
          for (const exe of JETBRAINS_EXES) {
            const path = join(apps, app, channel, build, 'bin', `${exe}.exe`);
            add(ideName(path), path);
          }
        }
      }
    }
  }
  // El instalador de Eclipse deja cada paquete en %USERPROFILE%\eclipse\<paquete>\eclipse.
  for (const home of roots.userProfile) {
    for (const pack of dirsIn(join(home, 'eclipse'))) {
      add(`Eclipse (${pack})`, join(home, 'eclipse', pack, 'eclipse', 'eclipse.exe'));
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return found.filter((f) => isValidIdePath(f.path)).map((f, i) => ({ id: `ide-${i}`, name: f.name, path: f.path }));
}

/** Sin lo que Hilo o Electron tengan definido: ELECTRON_RUN_AS_NODE haría que VS Code arrancara como Node. */
function ideEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(ELECTRON_|HILO_|CLAUDE_CODE_)/i.test(key) && key.toUpperCase() !== 'NODE_OPTIONS') env[key] = value;
  }
  return env;
}

/** Se lanza sin shell y desacoplado: es una ventana propia, y sigue abierta aunque Hilo se cierre. */
export function launchIde(exe: string, target: { project: string; file?: string; line?: number }): Promise<IdeOpenResult> {
  const kind = ideKind(exe);
  const name = ideName(exe);
  if (!isValidIdePath(exe) || !existsSync(exe)) {
    return Promise.resolve({ ok: false, reason: 'missing', message: `No se encontró ${name} en ${exe}. Elige dónde está.` });
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, ideArgs(kind, target), { cwd: dirname(exe), env: ideEnv(), shell: false, detached: true, stdio: 'ignore' });
    } catch (err) {
      resolve({ ok: false, reason: 'spawn', message: `No se pudo abrir ${name}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    child.once('error', (err) => resolve({ ok: false, reason: 'spawn', message: `No se pudo abrir ${name}: ${err.message}` }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, jumped: !!target.line && ideJumpsToLine(kind) });
    });
  });
}

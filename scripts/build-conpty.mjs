// Recompila conpty.node de node-pty con un arreglo de concurrencia y lo deja en vendor/.
// No hace falta para compilar Hilo: el binario ya está en el repositorio. Solo se usa al
// actualizar node-pty. Requiere Visual Studio Build Tools con las herramientas de C++.
//
// El fallo original (node-pty 1.1.0): cada proceso tiene un hilo que espera su salida y lo
// borra de una lista global sin protección. Si salen dos a la vez, la app muere con
// 0xC0000005 en conpty.node. Ver docs/DECISIONES.md, D7.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'node-pty');
// Dentro de node_modules para que gyp encuentre node-addon-api.
const work = join(root, 'node_modules', '.cache', 'conpty-build');

function replaceOnce(text, from, to) {
  const first = text.indexOf(from);
  if (first < 0 || text.indexOf(from, first + 1) >= 0) throw new Error(`Se esperaba una sola vez en conpty.cc: ${from}`);
  return text.replace(from, () => to);
}

function patch(text) {
  let t = text.replace(/\r\n/g, '\n');
  t = replaceOnce(t, '#include <iostream>\n', '#include <iostream>\n#include <memory>\n#include <mutex>\n');
  t = replaceOnce(
    t,
    `static std::vector<std::unique_ptr<pty_baton>> ptyHandles;
static volatile LONG ptyCounter;

static pty_baton* get_pty_baton(int id) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    return it->get();
  }
  return nullptr;
}

static bool remove_pty_baton(int id) {
  auto it = std::remove_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    ptyHandles.erase(it);
    return true;
  }
  return false;
}
`,
    `// Hilo: los hilos de salida y el principal comparten esta lista. Sin este cerrojo, dos procesos
// que salen a la vez la corrompen. shared_ptr: una entrada no se libera mientras alguien la usa.
static std::mutex ptyHandlesMutex;
static std::vector<std::shared_ptr<pty_baton>> ptyHandles;
static volatile LONG ptyCounter;

static std::shared_ptr<pty_baton> find_pty_baton(int id) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  return it != ptyHandles.end() ? *it : nullptr;
}

static std::shared_ptr<pty_baton> get_pty_baton(int id) {
  std::lock_guard<std::mutex> lock(ptyHandlesMutex);
  return find_pty_baton(id);
}

static void remove_pty_baton(int id) {
  auto it = std::remove_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  ptyHandles.erase(it, ptyHandles.end());
}
`,
  );
  t = replaceOnce(
    t,
    `    // Clean up handles
    CloseHandle(baton->hShell);
    assert(remove_pty_baton(baton->id));
`,
    `    // Clean up handles
    {
      std::lock_guard<std::mutex> lock(ptyHandlesMutex);
      CloseHandle(baton->hShell);
      remove_pty_baton(baton->id);
    }
`,
  );
  t = replaceOnce(
    t,
    `    ptyHandles.emplace_back(
        std::make_unique<pty_baton>(ptyId, hIn, hOut, hpc));`,
    `    std::lock_guard<std::mutex> lock(ptyHandlesMutex);
    ptyHandles.emplace_back(
        std::make_shared<pty_baton>(ptyId, hIn, hOut, hpc));`,
  );
  // El hilo de salida conserva la entrada mientras la usa, aunque ya no esté en la lista.
  t = replaceOnce(t, 'void SetupExitCallback(Napi::Env env, Napi::Function cb, pty_baton* baton) {', 'void SetupExitCallback(Napi::Env env, Napi::Function cb, std::shared_ptr<pty_baton> baton) {');
  t = replaceOnce(t, '  pty_baton* handle = get_pty_baton(id);\n', '  std::shared_ptr<pty_baton> handle = get_pty_baton(id);\n');
  t = t.replaceAll('  const pty_baton* handle = get_pty_baton(id);\n', '  std::shared_ptr<const pty_baton> handle = get_pty_baton(id);\n');
  // Nunca TerminateProcess con un handle ya cerrado: Windows pudo haberlo reutilizado.
  t = replaceOnce(
    t,
    `    if (useConptyDll) {
      TerminateProcess(handle->hShell, 1);
    }`,
    `    if (useConptyDll) {
      std::lock_guard<std::mutex> lock(ptyHandlesMutex);
      if (find_pty_baton(id) != nullptr) {
        TerminateProcess(handle->hShell, 1);
      }
    }`,
  );
  // Si CreateProcess falla, el OpenConsole ya lanzado se quedaba vivo hasta cerrar la app.
  t = replaceOnce(
    t,
    `  if (!fSuccess) {
    throw errorWithCode(info, "Cannot create process");
  }`,
    `  DeleteProcThreadAttributeList(siEx.lpAttributeList);
  delete[] attrList;
  if (!fSuccess) {
    const DWORD createError = GetLastError();
    HANDLE hConpty = LoadConptyDll(info, useConptyDll);
    if (hConpty != nullptr) {
      PFNCLOSEPSEUDOCONSOLE const pfnClose = (PFNCLOSEPSEUDOCONSOLE)GetProcAddress(
        (HMODULE)hConpty, useConptyDll ? "ConptyClosePseudoConsole" : "ClosePseudoConsole");
      if (pfnClose) {
        pfnClose(handle->hpc);
      }
    }
    CloseHandle(handle->hIn);
    CloseHandle(handle->hOut);
    {
      std::lock_guard<std::mutex> lock(ptyHandlesMutex);
      remove_pty_baton(id);
    }
    SetLastError(createError);
    throw errorWithCode(info, "Cannot create process");
  }`,
  );
  return t;
}

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, 'src', 'win'), { recursive: true });
cpSync(join(source, 'src', 'win'), join(work, 'src', 'win'), { recursive: true });
const cc = join(work, 'src', 'win', 'conpty.cc');
writeFileSync(cc, patch(readFileSync(cc, 'utf8')));

// Mismas opciones que node-pty, salvo SpectreMitigation: pide unas bibliotecas aparte de MSVC.
writeFileSync(
  join(work, 'binding.gyp'),
  JSON.stringify({
    target_defaults: {
      dependencies: ["<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except"],
      msvs_settings: {
        VCCLCompilerTool: { AdditionalOptions: ['/guard:cf', '/sdl', '/W3', '/w34244', '/w34267', '/ZH:SHA_256'] },
        // PDBALTPATH: sin la ruta de esta máquina dentro del binario.
        VCLinkerTool: { AdditionalOptions: ['/DYNAMICBASE', '/guard:cf', '/PDBALTPATH:conpty.pdb'] },
      },
    },
    targets: [{ target_name: 'conpty', sources: ['src/win/conpty.cc', 'src/win/path_util.cc'], libraries: ['-lshlwapi'] }],
  }),
);

const gyp = join(dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
if (!existsSync(gyp)) throw new Error(`No se encontró node-gyp en ${gyp}`);
execFileSync(process.execPath, [gyp, 'rebuild', '--release', '--arch=x64', `--devdir=${join(root, 'node_modules', '.cache', 'node-gyp')}`], { cwd: work, stdio: 'inherit' });

const out = join(root, 'vendor', 'node-pty');
mkdirSync(out, { recursive: true });
cpSync(join(work, 'build', 'Release', 'conpty.node'), join(out, 'conpty.node'));
writeFileSync(join(out, 'conpty.cc'), readFileSync(cc));
rmSync(work, { recursive: true, force: true });
const hash = createHash('sha256').update(readFileSync(join(out, 'conpty.node'))).digest('hex');
console.log(`Listo: vendor/node-pty/conpty.node\nActualiza CONPTY_SHA256 en scripts/build.mjs con ${hash}`);

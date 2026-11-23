import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { CUSTOM_SOUND_MAX_BYTES } from "../shared/sounds";

/**
 * El sonido propio (#12): un audio que elige la persona, copiado a la carpeta de datos de Hilo. Hilo no lo
 * vuelve a leer del lugar original, y el renderer nunca recibe una ruta: pide los bytes por IPC.
 */
const EXTENSIONS = [".mp3", ".wav", ".ogg"];

export type CustomSoundResult =
  { ok: true; name: string } | { ok: false; message: string };

export class CustomSound {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "sonidos");
  }

  /** Copia el archivo elegido. Reemplaza el anterior. */
  adopt(source: string): CustomSoundResult {
    const ext = extname(source).toLowerCase();
    if (!EXTENSIONS.includes(ext))
      return { ok: false, message: "Elige un archivo mp3, wav u ogg." };
    let size: number;
    try {
      size = statSync(source).size;
    } catch {
      return { ok: false, message: "No se pudo leer ese archivo." };
    }
    if (size === 0) return { ok: false, message: "Ese archivo está vacío." };
    if (size > CUSTOM_SOUND_MAX_BYTES)
      return {
        ok: false,
        message: `Pesa ${(size / 1024 / 1024).toFixed(1)} MB y el máximo es 2 MB. Prueba con un audio más corto.`,
      };
    try {
      mkdirSync(this.dir, { recursive: true });
      this.clear();
      copyFileSync(source, join(this.dir, `propio${ext}`));
    } catch {
      return { ok: false, message: "No se pudo guardar una copia del audio." };
    }
    return { ok: true, name: basename(source).slice(0, 200) };
  }

  /** Los bytes del audio guardado, o null si no hay. */
  read(): Uint8Array | null {
    const file = this.file();
    if (!file) return null;
    try {
      const buf = readFileSync(file);
      return buf.length <= CUSTOM_SOUND_MAX_BYTES ? new Uint8Array(buf) : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    for (const ext of EXTENSIONS)
      rmSync(join(this.dir, `propio${ext}`), { force: true });
  }

  private file(): string | null {
    try {
      const name = readdirSync(this.dir).find((f) =>
        /^propio\.(mp3|wav|ogg)$/i.test(f),
      );
      return name ? join(this.dir, name) : null;
    } catch {
      return null;
    }
  }
}

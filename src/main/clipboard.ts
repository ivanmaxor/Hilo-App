import { clipboard } from 'electron';

export interface ClipboardPort {
  readText(): Promise<string>;
  hasImage(): Promise<boolean>;
  writeText(text: string): Promise<void>;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/webp'];

const real: ClipboardPort = {
  readText: () => clipboard.readText(),
  async hasImage() {
    const results = await Promise.all(IMAGE_TYPES.map((t) => clipboard.has(t).catch(() => false)));
    return results.some(Boolean);
  },
  writeText: (text) => clipboard.writeText(text),
};

/** Portapapeles en memoria: las pruebas no pisan el del usuario (decisión D6). */
export class MemoryClipboard implements ClipboardPort {
  text = '';
  image = false;
  async readText(): Promise<string> {
    return this.text;
  }
  async hasImage(): Promise<boolean> {
    return this.image;
  }
  async writeText(text: string): Promise<void> {
    this.text = text;
  }
}

export function createClipboard(): ClipboardPort {
  return process.env.HILO_E2E === '1' && process.env.HILO_TEST_CLIPBOARD === 'memory' ? new MemoryClipboard() : real;
}

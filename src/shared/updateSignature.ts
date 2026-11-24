import { createPublicKey, verify } from 'node:crypto';

/**
 * Firma de las actualizaciones (#4, D36). Quien publica firma con Ed25519 este texto, y Hilo lo verifica antes
 * de ofrecer instalar, con las claves públicas de aquí. Va firmado el sha512 del instalador junto con su versión
 * y su nombre: un `latest.yml` cambiado que apunte a otro instalador, o uno viejo con otro número, no calza.
 * Los scripts firman con `scripts/update-signature.mjs`, que arma el mismo texto.
 */
export const SIGNATURE_FORMAT = 'hilo-update-v1';

/**
 * La de uso y una de reserva, guardada aparte: perder una no deja a nadie sin actualizaciones.
 * SPKI DER en base64. Las privadas están en la carpeta privada del dueño, nunca en el repo.
 */
export const UPDATE_PUBLIC_KEYS: readonly string[] = [
  // principal
  'MCowBQYDK2VwAyEArPCV2nTibZrzQop81wHEnHkFYEijGpkIwgQ/VwB1Uqo=',
  // reserva
  'MCowBQYDK2VwAyEA/oIxnXzMmvohqOe27YJco6u2pNpsY/yAWMNSLy5eof4=',
];

/** Una firma Ed25519 en base64 mide 88; más que esto es otra cosa. */
export const MAX_SIGNATURE_CHARS = 200;

export function signedMessage(version: string, fileName: string, sha512: string): string {
  return `${SIGNATURE_FORMAT}\n${version}\n${fileName}\n${sha512}\n`;
}

/** El nombre de un instalador que se acepta verificar: sin rutas ni nada raro. */
export function isInstallerName(name: unknown): name is string {
  return typeof name === 'string' && /^Hilo-Setup-[0-9A-Za-z.+-]{1,40}\.exe$/.test(name);
}

/** La firma del instalador `fileName` de la versión `version`, junto a él en la Release. */
export function signatureFileName(fileName: string): string {
  return `${fileName}.sig`;
}

/** true si `signature` (base64) firma `message` con alguna de `keys`. Nunca lanza. */
export function verifyUpdateSignature(message: string, signature: string, keys: readonly string[]): boolean {
  const text = signature.trim();
  if (!text || text.length > MAX_SIGNATURE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length !== 64) return false;
  const data = Buffer.from(message, 'utf8');
  for (const key of keys) {
    try {
      const publicKey = createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
      if (publicKey.asymmetricKeyType === 'ed25519' && verify(null, data, publicKey, bytes)) return true;
    } catch {
      // Una clave mal escrita no impide probar con las otras.
    }
  }
  return false;
}

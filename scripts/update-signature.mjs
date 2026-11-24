/**
 * Firma de las actualizaciones (#4, D36), para los scripts. Lo mismo que `src/shared/updateSignature.ts`,
 * que es lo que verifica Hilo: `tests/unit/update-signature.test.ts` comprueba que los dos digan lo mismo.
 *
 * Generar una clave (una vez; la privada nunca entra al repo):
 *   node scripts/update-signature.mjs nueva <carpeta privada> <nombre>
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIGNATURE_FORMAT = 'hilo-update-v1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Una clave pública Ed25519 en SPKI DER base64 siempre empieza así y mide 60 caracteres. */
const PUBLIC_KEY = /['"](MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=)['"]/g;

export function signedMessage(version, fileName, sha512) {
  return `${SIGNATURE_FORMAT}\n${version}\n${fileName}\n${sha512}\n`;
}

/** Las claves públicas que acepta Hilo, leídas de `src/shared/updateSignature.ts`. */
export function trustedPublicKeys(root = ROOT) {
  const source = readFileSync(join(root, 'src', 'shared', 'updateSignature.ts'), 'utf8');
  return [...source.matchAll(PUBLIC_KEY)].map((m) => m[1]);
}

const insideRepo = (file, root) => {
  const rel = relative(resolve(root), resolve(file));
  return !rel.startsWith('..') && !/^[A-Za-z]:/.test(rel);
};

/**
 * Firma con la clave privada de `keyFile`. Falla si la clave está dentro del repo o si su pública no es una
 * de las que acepta Hilo: una firma con otra clave dejaría a todos sin poder actualizar.
 */
export function signRelease({ keyFile, version, fileName, sha512, root = ROOT }) {
  if (insideRepo(keyFile, root)) throw new Error('la clave privada no puede estar dentro del repo');
  const privateKey = createPrivateKey(readFileSync(keyFile));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('la clave no es Ed25519');
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  if (!trustedPublicKeys(root).includes(spki)) throw new Error('la clave no es una de las que acepta Hilo (src/shared/updateSignature.ts)');
  const message = Buffer.from(signedMessage(version, fileName, sha512), 'utf8');
  const signature = sign(null, message, privateKey);
  if (!verify(null, message, publicKey, signature)) throw new Error('la firma no se pudo comprobar');
  return signature.toString('base64');
}

/** Una clave nueva: la privada a `dir` (fuera del repo, sin pisar nada) y la pública por pantalla. */
export function newKey(dir, name, root = ROOT) {
  if (!/^[a-z0-9-]{1,30}$/.test(name ?? '')) throw new Error('el nombre va en minúsculas, sin espacios: principal, reserva');
  if (insideRepo(dir, root)) throw new Error('la carpeta no puede estar dentro del repo');
  const file = join(dir, `hilo-actualizaciones-${name}.pem`);
  if (existsSync(file)) throw new Error(`ya existe ${file}: no se pisa una clave`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  return { file, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, dir, name] = process.argv.slice(2);
  if (command !== 'nueva' || !dir) {
    console.error('Uso: node scripts/update-signature.mjs nueva <carpeta privada> <nombre>');
    process.exit(1);
  }
  try {
    const { file, publicKey } = newKey(dir, name);
    console.log(`Clave privada guardada en ${file}. Respáldala: sin ella no se puede publicar.`);
    console.log(`Clave pública, para src/shared/updateSignature.ts:\n${publicKey}`);
  } catch (error) {
    console.error(`No se creó la clave: ${error.message}`);
    process.exit(1);
  }
}

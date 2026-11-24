import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isInstallerName,
  SIGNATURE_FORMAT,
  signatureFileName,
  signedMessage,
  UPDATE_PUBLIC_KEYS,
  verifyUpdateSignature,
} from '../../src/shared/updateSignature';
// @ts-expect-error: script de Node sin tipos.
import * as script from '../../scripts/update-signature.mjs';

const spki = (key: KeyObject) => key.export({ type: 'spki', format: 'der' }).toString('base64');
const keys = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const SHA = 'a'.repeat(86) + '==';
const message = signedMessage('1.4.0', 'Hilo-Setup-1.4.0.exe', SHA);
const good = sign(null, Buffer.from(message), keys.privateKey).toString('base64');

describe('firma de las actualizaciones (#4)', () => {
  it('acepta la firma de una de las claves, y nada que cambie versión, nombre o sha512', () => {
    expect(verifyUpdateSignature(message, good, [spki(keys.publicKey)])).toBe(true);
    // Con dos claves, cualquiera de las dos sirve: la de reserva no necesita la principal.
    expect(verifyUpdateSignature(message, good, [spki(other.publicKey), spki(keys.publicKey)])).toBe(true);
    expect(verifyUpdateSignature(message, good, [spki(other.publicKey)])).toBe(false);
    expect(verifyUpdateSignature(signedMessage('1.4.1', 'Hilo-Setup-1.4.0.exe', SHA), good, [spki(keys.publicKey)])).toBe(false);
    expect(verifyUpdateSignature(signedMessage('1.4.0', 'Hilo-Setup-1.4.1.exe', SHA), good, [spki(keys.publicKey)])).toBe(false);
    expect(verifyUpdateSignature(signedMessage('1.4.0', 'Hilo-Setup-1.4.0.exe', 'b' + SHA.slice(1)), good, [spki(keys.publicKey)])).toBe(false);
  });

  it('no lanza con firmas o claves rotas', () => {
    for (const bad of ['', '   ', 'no es base64!', 'QUJD', good + good, 'x'.repeat(500)]) {
      expect(verifyUpdateSignature(message, bad, [spki(keys.publicKey)]), bad.slice(0, 20)).toBe(false);
    }
    expect(verifyUpdateSignature(message, good, ['basura', spki(keys.publicKey)])).toBe(true);
    // Una clave RSA no es Ed25519.
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(verifyUpdateSignature(message, good, [rsa])).toBe(false);
    expect(verifyUpdateSignature(message, good, [])).toBe(false);
  });

  it('el nombre del instalador no puede traer rutas', () => {
    expect(isInstallerName('Hilo-Setup-1.4.0.exe')).toBe(true);
    expect(isInstallerName('Hilo-Setup-1.4.0-rc.1.exe')).toBe(true);
    for (const bad of ['../Hilo-Setup-1.4.0.exe', 'Hilo-Setup-1.4.0.exe/x', 'https://a.cl/Hilo-Setup-1.exe', 'Otro.exe', 'Hilo-Setup-1.4.0.msi', 5]) {
      expect(isInstallerName(bad), String(bad)).toBe(false);
    }
    expect(signatureFileName('Hilo-Setup-1.4.0.exe')).toBe('Hilo-Setup-1.4.0.exe.sig');
  });

  it('Hilo trae dos claves Ed25519 distintas, y el script de publicar lee las mismas', () => {
    expect(UPDATE_PUBLIC_KEYS).toHaveLength(2);
    expect(new Set(UPDATE_PUBLIC_KEYS).size).toBe(2);
    for (const key of UPDATE_PUBLIC_KEYS) {
      expect(createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType).toBe('ed25519');
    }
    expect(script.trustedPublicKeys()).toEqual([...UPDATE_PUBLIC_KEYS]);
    expect(script.SIGNATURE_FORMAT).toBe(SIGNATURE_FORMAT);
    expect(script.signedMessage('1.4.0', 'Hilo-Setup-1.4.0.exe', SHA)).toBe(message);
  });
});

describe('el script que firma al publicar (#4)', () => {
  const root = mkdtempSync(join(tmpdir(), 'hilo-firma-'));
  const repo = join(root, 'repo');
  const outside = join(root, 'privado');
  mkdirSync(join(repo, 'src', 'shared'), { recursive: true });
  mkdirSync(outside);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('crea claves fuera del repo sin pisar ninguna, y firma solo con una que Hilo acepte', () => {
    const made = script.newKey(outside, 'principal', repo);
    expect(existsSync(made.file)).toBe(true);
    expect(() => script.newKey(outside, 'principal', repo)).toThrow(/no se pisa/);
    expect(() => script.newKey(join(repo, 'claves'), 'otra', repo)).toThrow(/dentro del repo/);
    expect(() => script.newKey(outside, 'Con Espacios', repo)).toThrow(/minúsculas/);

    const release = { keyFile: made.file, version: '1.4.0', fileName: 'Hilo-Setup-1.4.0.exe', sha512: SHA, root: repo };
    // Sin la pública en la lista de Hilo no se firma: los usuarios rechazarían esa versión.
    writeFileSync(join(repo, 'src', 'shared', 'updateSignature.ts'), `export const UPDATE_PUBLIC_KEYS = ['${spki(other.publicKey)}'];\n`);
    expect(() => script.signRelease(release)).toThrow(/no es una de las que acepta Hilo/);

    writeFileSync(join(repo, 'src', 'shared', 'updateSignature.ts'), `export const UPDATE_PUBLIC_KEYS = ['${made.publicKey}'];\n`);
    const signature = script.signRelease(release);
    expect(verifyUpdateSignature(message, signature, [made.publicKey])).toBe(true);

    // Una clave privada dentro del repo no se usa nunca.
    const inRepo = join(repo, 'clave.pem');
    writeFileSync(inRepo, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() => script.signRelease({ ...release, keyFile: inRepo })).toThrow(/dentro del repo/);
  });
});

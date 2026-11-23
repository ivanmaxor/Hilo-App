import { describe, expect, it } from 'vitest';
import { scanSecrets, SECRET_LABELS } from '../../src/shared/secretScan';

// Claves falsas armadas por partes para que npm run privacy y el CI no las marquen.
const ANTHROPIC = ['sk-', 'ant-', 'x'.repeat(30)].join('');
const GITHUB = 'gh' + 'p_' + 'a'.repeat(36);
const GITHUB_PAT = 'github_' + 'pat_' + 'A1'.repeat(20);
const AWS = 'AK' + 'IA' + 'A'.repeat(16);
const PEM = '-----BEGIN ' + 'OPENSSH PRIVATE ' + 'KEY-----';

describe('scanSecrets', () => {
  it('texto normal: nada', () => {
    expect(scanSecrets('')).toEqual([]);
    expect(scanSecrets('hola, esto es una frase normal\ncon dos líneas')).toEqual([]);
  });

  it('Anthropic: sí; corto o pegado a letras: no', () => {
    expect(scanSecrets(`mi clave es ${ANTHROPIC} gracias`)).toEqual(['anthropic']);
    expect(scanSecrets('sk-' + 'ant-corta')).toEqual([]);
    expect(scanSecrets('task-' + 'ant-' + 'x'.repeat(30))).toEqual([]);
  });

  it('GitHub: ghp_ y github_pat_', () => {
    expect(scanSecrets(GITHUB)).toEqual(['github']);
    expect(scanSecrets(`Authorization: ${GITHUB_PAT}`)).toEqual(['github']);
    expect(scanSecrets('gh' + 'p_' + 'a'.repeat(10))).toEqual([]);
  });

  it('AWS: sí; rodeada de letras o más corta: no', () => {
    expect(scanSecrets(`aws_access_key_id ${AWS}`)).toEqual(['aws']);
    expect(scanSecrets('ASIA' + 'B'.repeat(16))).toEqual(['aws']);
    expect(scanSecrets('xx' + AWS + 'yy')).toEqual([]);
    expect(scanSecrets('AK' + 'IA' + 'A'.repeat(15))).toEqual([]);
  });

  it('clave privada: PEM sí, certificado no', () => {
    expect(scanSecrets(`${PEM}\nabc\n`)).toEqual(['privateKey']);
    expect(scanSecrets('-----BEGIN ' + 'RSA PRIVATE ' + 'KEY-----')).toEqual(['privateKey']);
    expect(scanSecrets('-----BEGIN ' + 'CERTIFICATE-----\nabc')).toEqual([]);
  });

  it('.env: nombre con KEY/TOKEN/SECRET/PASSWORD y valor largo', () => {
    expect(scanSecrets('API_KEY=abcdef123456')).toEqual(['envVar']);
    expect(scanSecrets('HOST=localhost\nDB_PASSWORD=hunter2hunter2\n')).toEqual(['envVar']);
    expect(scanSecrets('export GITHUB_TOKEN="un valor largo"')).toEqual(['envVar']);
    expect(scanSecrets("  SECRET_KEY = 'abcdefghij'\r\nOTRA=1")).toEqual(['envVar']);
  });

  it('.env: parecidos que no son clave', () => {
    expect(scanSecrets('KEYBOARD=us-intl')).toEqual([]);
    expect(scanSecrets('API_KEY=changeme')).toEqual([]);
    expect(scanSecrets('API_KEY=corto')).toEqual([]);
    expect(scanSecrets('API_KEY=${OTRA_VARIABLE_LARGA}')).toEqual([]);
    expect(scanSecrets('API_KEY=$OTRA_VARIABLE')).toEqual([]);
    expect(scanSecrets('API_KEY=<tu-clave-aqui>')).toEqual([]);
    expect(scanSecrets('API_KEY=xxxxxxxxxxxx')).toEqual([]);
    expect(scanSecrets('API_KEY=************')).toEqual([]);
    expect(scanSecrets('apiKey=abcdef123456')).toEqual([]);
    expect(scanSecrets('API_KEY=' + 'a'.repeat(500))).toEqual([]);
  });

  it('varios tipos juntos, sin repetir', () => {
    expect(scanSecrets(`${ANTHROPIC}\n${ANTHROPIC}\n${AWS}`)).toEqual(['anthropic', 'aws']);
  });

  it('nunca devuelve el valor: solo tipos conocidos', () => {
    for (const k of scanSecrets(`${ANTHROPIC} ${GITHUB} ${AWS} ${PEM}\nTOKEN=abcdefghijk`)) expect(SECRET_LABELS[k]).toBeTruthy();
  });

  it('5 MB sin claves, y con la clave al final, en menos de 150 ms', () => {
    const line = 'const resultado = calcular(entrada, opciones); // texto normal de código\n';
    let big = '';
    while (big.length < 5 * 1024 * 1024) big += line;
    const t0 = performance.now();
    expect(scanSecrets(big)).toEqual([]);
    expect(scanSecrets(big + ANTHROPIC)).toEqual(['anthropic']);
    expect((performance.now() - t0) / 2).toBeLessThan(150);
  });
});

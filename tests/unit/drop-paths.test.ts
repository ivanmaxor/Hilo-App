import { describe, expect, it } from 'vitest';
import { buildDropText, dropReference, MAX_DROPPED, relativeInside } from '../../src/shared/dropPaths';

const CWD = 'C:\\Datos\\persona\\proyecto';

describe('archivos soltados: ruta de cada uno', () => {
  it('dentro de la carpeta de la sesión, @ruta relativa con /', () => {
    expect(dropReference('C:\\Datos\\persona\\proyecto\\src\\app.ts', CWD)).toBe('@src/app.ts');
    expect(dropReference('C:\\Datos\\persona\\proyecto\\README.md', CWD)).toBe('@README.md');
  });

  it('la comparación no distingue mayúsculas, como Windows, y admite / o \\ y barra final', () => {
    expect(dropReference('c:\\DATOS\\Persona\\Proyecto\\a.txt', CWD)).toBe('@a.txt');
    expect(dropReference('C:/Datos/persona/proyecto/a.txt', 'C:\\Datos\\persona\\proyecto\\')).toBe('@a.txt');
  });

  it('fuera de la carpeta, la ruta completa entre comillas', () => {
    expect(dropReference('C:\\Datos\\persona\\otro\\a.txt', CWD)).toBe('"C:\\Datos\\persona\\otro\\a.txt"');
    expect(dropReference('D:\\datos\\a.txt', CWD)).toBe('"D:\\datos\\a.txt"');
  });

  it('una carpeta hermana con el mismo prefijo no cuenta como dentro', () => {
    expect(relativeInside('C:\\Datos\\persona\\proyecto-viejo\\a.txt', CWD)).toBeNull();
    expect(dropReference('C:\\Datos\\persona\\proyecto-viejo\\a.txt', CWD)).toBe('"C:\\Datos\\persona\\proyecto-viejo\\a.txt"');
  });

  it('la propia carpeta de la sesión no es relativa a sí misma: va completa', () => {
    expect(dropReference(CWD, CWD)).toBe(`"${CWD}"`);
  });

  it('sin carpeta de sesión, siempre completa', () => {
    expect(dropReference('C:\\a\\b.txt', null)).toBe('"C:\\a\\b.txt"');
  });

  it('con espacios: dentro va @"ruta", fuera entre comillas', () => {
    expect(dropReference('C:\\Datos\\persona\\proyecto\\mis docs\\informe final.pdf', CWD)).toBe('@"mis docs/informe final.pdf"');
    expect(dropReference('C:\\Datos\\persona\\mis docs\\informe.pdf', CWD)).toBe('"C:\\Datos\\persona\\mis docs\\informe.pdf"');
  });

  it('lo que safePath rechaza dentro de la carpeta (.git, nombres de dispositivo) va completo', () => {
    expect(dropReference('C:\\Datos\\persona\\proyecto\\.git\\config', CWD)).toBe('"C:\\Datos\\persona\\proyecto\\.git\\config"');
    expect(dropReference('C:\\Datos\\persona\\proyecto\\.gitignore', CWD)).toBe('@.gitignore');
    expect(dropReference('C:\\Datos\\persona\\proyecto\\nul', CWD)).toBe('"C:\\Datos\\persona\\proyecto\\nul"');
  });

  it('un tramo con ".." no puede salir de la carpeta', () => {
    expect(relativeInside('C:\\Datos\\persona\\proyecto\\..\\..\\secreto.txt', CWD)).toBeNull();
  });
});

describe('archivos soltados: texto a pegar', () => {
  it('varios archivos separados por un espacio, sin Enter', () => {
    const r = buildDropText(['C:\\Datos\\persona\\proyecto\\a.ts', 'D:\\x\\y z.png', 'C:\\Datos\\persona\\proyecto\\sub\\b.ts'], CWD);
    expect(r.text).toBe('@a.ts "D:\\x\\y z.png" @sub/b.ts');
    expect(r.used).toBe(3);
    expect(r.text).not.toMatch(/[\r\n]/);
  });

  it('tope de 20: las demás se cuentan, no se pegan', () => {
    const paths = Array.from({ length: 25 }, (_, i) => `C:\\Datos\\persona\\proyecto\\f${i}.txt`);
    const r = buildDropText(paths, CWD);
    expect(MAX_DROPPED).toBe(20);
    expect(r.used).toBe(20);
    expect(r.overLimit).toBe(5);
    expect(r.text.split(' ')).toHaveLength(20);
    expect(r.text.endsWith('@f19.txt')).toBe(true);
  });

  it('justo 20 no es pasarse', () => {
    const paths = Array.from({ length: 20 }, (_, i) => `D:\\f${i}.txt`);
    expect(buildDropText(paths, CWD).overLimit).toBe(0);
  });

  it('un nombre con ESC o caracteres de control se descarta, no se pega "arreglado"', () => {
    const r = buildDropText(['C:\\Datos\\persona\\proyecto\\mal\x1b[201~nombre.txt', 'C:\\Datos\\persona\\proyecto\\bien.txt', 'D:\\x\x07y.txt', 'D:\\x\ny.txt', 'D:\\x\x85y.txt'], CWD);
    expect(r.text).toBe('@bien.txt');
    expect(r.used).toBe(1);
    expect(r.rejected).toBe(4);
    expect(r.text).not.toContain('\x1b');
  });

  it('las descartadas no gastan el cupo de 20', () => {
    const paths = ['D:\\x\x1b.txt', ...Array.from({ length: 20 }, (_, i) => `D:\\f${i}.txt`)];
    const r = buildDropText(paths, CWD);
    expect(r.used).toBe(20);
    expect(r.overLimit).toBe(0);
    expect(r.rejected).toBe(1);
  });

  it('vacías o que no son texto no dejan nada', () => {
    const r = buildDropText(['', 5 as unknown as string], CWD);
    expect(r.text).toBe('');
    expect(r.used).toBe(0);
    expect(r.rejected).toBe(2);
    expect(buildDropText([], CWD).text).toBe('');
  });

  it('acentos, ñ, emojis y paréntesis llegan intactos', () => {
    expect(buildDropText(['C:\\Datos\\persona\\proyecto\\ñandú (1) 😀.txt'], CWD).text).toBe('@"ñandú (1) 😀.txt"');
  });
});

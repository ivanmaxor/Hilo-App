import { describe, expect, it } from 'vitest';
import { buildCommentsPaste, commentKey, commentLines, inlineCode, MAX_COMMENT_CHARS, MAX_CONTEXT_CHARS, sortComments, type DiffComment } from '../../src/shared/diffComments';

let seq = 0;
const c = (path: string, line: number, text: string, code = 'x', side: 'new' | 'old' = 'new'): DiffComment => ({ id: ++seq, path, line, side, code, text });

describe('buildCommentsPaste', () => {
  it('una línea archivo:línea: comentario y el código como contexto, sin salto al final', () => {
    const out = buildCommentsPaste([c('src/a.ts', 12, 'Falla con null', 'const a = x.y;')]);
    expect(out.text).toBe('src/a.ts:12: Falla con null\n    `const a = x.y;`');
    expect(out.text.endsWith('\n')).toBe(false);
    expect(out.omitted).toBe(0);
  });

  it('varios archivos: ordenados por ruta y por línea, no por el orden en que se escribieron', () => {
    const list = [c('src/b.ts', 3, 'tres'), c('src/a.ts', 20, 'veinte'), c('src/a.ts', 5, 'cinco'), c('README.md', 1, 'uno')];
    const lines = buildCommentsPaste(list).text.split('\n').filter((l) => !l.startsWith(' '));
    expect(lines).toEqual(['README.md:1: uno', 'src/a.ts:5: cinco', 'src/a.ts:20: veinte', 'src/b.ts:3: tres']);
  });

  it('en la misma línea, la actual va antes que la quitada, y una quitada lleva (antes)', () => {
    const list = [c('a.ts', 4, 'vieja', 'old', 'old'), c('a.ts', 4, 'nueva', 'new', 'new')];
    expect(buildCommentsPaste(list).text.split('\n').filter((l) => !l.startsWith(' '))).toEqual(['a.ts:4: nueva', 'a.ts:4 (antes): vieja']);
  });

  it('un comentario de varias líneas sigue con sangría y sin líneas vacías', () => {
    const out = buildCommentsPaste([c('a.ts', 1, 'primera\r\n\r\n  segunda\n\ttercera', '')]);
    expect(out.text).toBe('a.ts:1: primera\n    segunda\n    tercera');
  });

  it('sin código no hay línea de contexto', () => {
    expect(buildCommentsPaste([c('a.ts', 1, 'hola', '   ')]).text).toBe('a.ts:1: hola');
  });

  it('el código con comillas invertidas usa un delimitador más largo', () => {
    expect(inlineCode('echo `date`')).toBe('`` echo `date` ``');
    expect(inlineCode('a ``` b')).toBe('```` a ``` b ````');
    expect(inlineCode('plano')).toBe('`plano`');
    expect(inlineCode('   ')).toBe('');
  });

  it('el contexto se aplana y se corta', () => {
    const long = 'x'.repeat(MAX_CONTEXT_CHARS + 50);
    const ctx = inlineCode(`\tuno\r\ndos ${long}`);
    expect(ctx).not.toMatch(/[\r\n\t]/);
    expect(ctx.startsWith('`uno dos')).toBe(true);
    expect(ctx.endsWith('…`')).toBe(true);
    expect([...ctx].length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + 2);
  });

  it('quita los caracteres de control del comentario, del código y de la ruta, también ESC[201~', () => {
    const out = buildCommentsPaste([c('src/\x1b[31ma\n.ts', 2, 'mal\x1b[201~hecho\x07 \x9b', 'let\x00 a\x1b = 1')]).text;
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    expect(out.split('\n')).toEqual(['src/[31ma .ts:2: mal[201~hecho', '    `let a = 1`']);
  });

  it('los saltos Unicode de línea tampoco parten una entrada', () => {
    expect(commentLines('uno\u2028dos\u2029tres')).toEqual(['uno', 'dos', 'tres']);
  });

  it('un comentario vacío o solo de espacios no entra', () => {
    const out = buildCommentsPaste([c('a.ts', 1, '  \n\t '), c('a.ts', 2, 'sí')]);
    expect(out.text).toBe('a.ts:2: sí\n    `x`');
    expect(out.included).toHaveLength(1);
  });

  it('un comentario largo se corta en el tope', () => {
    const out = buildCommentsPaste([c('a.ts', 1, 'z'.repeat(MAX_COMMENT_CHARS + 500), '')]).text;
    expect(out.length).toBeLessThan(MAX_COMMENT_CHARS + 30);
    expect(out.endsWith('…')).toBe(true);
  });

  it('con un tope de tamaño, los últimos quedan fuera y se cuentan; el primero siempre entra', () => {
    const list = [c('a.ts', 1, 'a'.repeat(60), ''), c('a.ts', 2, 'b'.repeat(60), ''), c('a.ts', 3, 'c'.repeat(60), '')];
    const out = buildCommentsPaste(list, 150);
    expect(out.included).toEqual([list[0]!.id, list[1]!.id]);
    expect(out.omitted).toBe(1);
    expect(out.text.length).toBeLessThanOrEqual(150);
    const tiny = buildCommentsPaste([list[0]!], 5);
    expect(tiny.included).toHaveLength(1);
    expect(tiny.omitted).toBe(0);
  });

  it('sin comentarios no hay nada que pegar', () => {
    expect(buildCommentsPaste([])).toEqual({ text: '', included: [], omitted: 0 });
  });

  it('la línea se normaliza a un entero de 1 en adelante', () => {
    expect(buildCommentsPaste([c('a.ts', 0, 'x', '')]).text).toBe('a.ts:1: x');
    expect(buildCommentsPaste([c('a.ts', 7.9, 'x', '')]).text).toBe('a.ts:7: x');
  });
});

describe('sortComments y commentKey', () => {
  it('no cambia la lista de entrada y desempata por antigüedad', () => {
    const a = c('a.ts', 1, 'primero');
    const b = c('a.ts', 1, 'segundo');
    const input = [b, a];
    expect(sortComments(input).map((x) => x.text)).toEqual(['primero', 'segundo']);
    expect(input[0]).toBe(b);
  });
  it('la clave distingue archivo, lado y línea', () => {
    expect(new Set([commentKey('a', 'new', 1), commentKey('a', 'old', 1), commentKey('b', 'new', 1), commentKey('a', 'new', 2)]).size).toBe(4);
  });
});

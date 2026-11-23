import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  fileUriToPath,
  findPathCandidates,
  pickLinks,
} from "../../src/shared/pathLinks";
import {
  relativeToProject,
  resolveTerminalPath,
  toAbsolute,
} from "../../src/main/pathOpen";

const paths = (text: string) =>
  findPathCandidates(text).map((c) => [
    text.slice(c.start, c.end),
    c.path,
    c.line,
  ]);

describe("rutas en la terminal (#10)", () => {
  it("encuentra rutas relativas, absolutas y nombres sueltos, con su línea", () => {
    expect(paths("Edité src/app.ts:12 y package.json.")).toEqual([
      ["src/app.ts:12", "src/app.ts", 12],
      ["package.json", "package.json", null],
    ]);
    expect(
      paths("mira @src/main/index.ts, y C:\\Proyectos\\hilo\\README.md"),
    ).toEqual([
      ["@src/main/index.ts", "src/main/index.ts", null],
      [
        "C:\\Proyectos\\hilo\\README.md",
        "C:\\Proyectos\\hilo\\README.md",
        null,
      ],
    ]);
    expect(
      paths("en `docs/DECISIONES.md#L40` y (tests/a.spec.ts:3:9)"),
    ).toEqual([
      ["docs/DECISIONES.md#L40", "docs/DECISIONES.md", 40],
      ["tests/a.spec.ts:3:9", "tests/a.spec.ts", 3],
    ]);
    expect(paths("⎿  Read src/x.ts")).toEqual([["src/x.ts", "src/x.ts", null]]);
    expect(paths("/c/Proyectos/demo/a.txt")).toEqual([
      ["/c/Proyectos/demo/a.txt", "/c/Proyectos/demo/a.txt", null],
    ]);
  });

  it("no toma enlaces web, rutas de red, opciones, versiones ni horas", () => {
    expect(paths("https://github.com/a/b.ts")).toEqual([]);
    expect(paths("\\\\servidor\\carpeta\\a.txt //servidor/b.txt")).toEqual([]);
    expect(paths("--settings=x.json -v 1.3.9 a las 12:30 y/o 50/50")).toEqual([
      ["y/o", "y/o", null],
    ]);
    expect(paths("a.txt:oculto mailto:a@b.cl /tmp/x.log")).toEqual([]);
  });

  it("una ruta absoluta con espacios se prueba con las palabras siguientes, y gana la más larga que existe", () => {
    const text = "Guardé C:\\Mis cosas\\informe final.pdf listo";
    const all = findPathCandidates(text);
    expect(all.map((c) => c.path)).toEqual([
      "C:\\Mis",
      "C:\\Mis cosas\\informe",
      "C:\\Mis cosas\\informe final.pdf",
      "C:\\Mis cosas\\informe final.pdf listo",
      "cosas\\informe",
      "final.pdf",
    ]);
    const exists = all.map(
      (c) =>
        c.path === "C:\\Mis cosas\\informe final.pdf" || c.path === "final.pdf",
    );
    expect(pickLinks(all, exists).map((c) => c.path)).toEqual([
      "C:\\Mis cosas\\informe final.pdf",
    ]);
  });

  it("un enlace file:// da su ruta; uno a un servidor, no", () => {
    expect(fileUriToPath("file:///C:/Mis%20cosas/a.txt")).toBe(
      "C:/Mis cosas/a.txt",
    );
    expect(fileUriToPath("file://servidor/carpeta/a.txt")).toBeNull();
    expect(fileUriToPath("https://a.cl")).toBeNull();
  });
});

describe("qué ruta abre el proceso principal (#10)", () => {
  const root = mkdtempSync(join(tmpdir(), "hilo-rutas-"));
  const project = join(root, "proyecto");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "app.ts"), "");
  writeFileSync(join(root, "fuera.txt"), "");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("resuelve desde la carpeta de la sesión y rechaza red, dispositivos y flujos", () => {
    expect(toAbsolute("src/app.ts", project)).toBe(
      join(project, "src", "app.ts"),
    );
    expect(toAbsolute("/c/Windows/x.txt", project)).toBe("C:\\Windows\\x.txt");
    for (const bad of [
      "\\\\servidor\\a.txt",
      "//servidor/a",
      "\\\\?\\C:\\a",
      "a.txt:oculto",
      "C:a.txt",
      "https://a.cl",
      "/tmp/a",
      "CON",
      "src/nul.txt",
      "a\u0007b",
      42,
      "",
    ]) {
      expect(toAbsolute(bad, project), String(bad)).toBeNull();
    }
    // Una sesión en una carpeta de red no resuelve rutas relativas: mirarlas sería ir a la red.
    expect(toAbsolute("a.txt", "\\\\servidor\\carpeta")).toBeNull();
  });

  it("dice si existe, si es carpeta y su ruta dentro del proyecto", async () => {
    expect(await resolveTerminalPath("src/app.ts", project, project)).toEqual({
      abs: join(project, "src", "app.ts"),
      dir: false,
      rel: "src/app.ts",
    });
    expect(await resolveTerminalPath("src", project, project)).toEqual({
      abs: join(project, "src"),
      dir: true,
      rel: "src",
    });
    expect(await resolveTerminalPath("../fuera.txt", project, project)).toEqual(
      { abs: join(root, "fuera.txt"), dir: false, rel: null },
    );
    expect(
      await resolveTerminalPath("src/no-existe.ts", project, project),
    ).toBeNull();
    expect(
      relativeToProject(join(project, ".git", "config"), project),
    ).toBeNull();
  });
});

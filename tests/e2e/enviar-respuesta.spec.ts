import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanup,
  launch,
  makeState,
  readSink,
  ROOT,
  settle,
  status,
  waitForSink,
  waitForText,
  type Launched,
} from "./helpers";

// «Enviar su última respuesta a…», sin Claude real. Cada sesión de Claude es un claude.cmd falso que arranca
// la shell de prueba (sink.cjs) con bracketed paste y anota lo que recibe. La conversación de origen es un
// .jsonl escrito a mano en una carpeta de configuración propia (CLAUDE_CONFIG_DIR), no la de nadie.

const A = randomUUID(); // origen, con conversación
const B = randomUUID(); // destino despierto
const C = randomUUID(); // destino dormido
const D = randomUUID(); // despierta, sin conversación
const SHELL = "consola";

function jsonl(...messages: string[]): string {
  return (
    messages
      .map((text, i) =>
        JSON.stringify({
          type: "assistant",
          message: {
            id: `m${i}`,
            role: "assistant",
            content: [{ type: "text", text }],
          },
        }),
      )
      .join("\n") + "\n"
  );
}

interface Rig {
  ctx: Launched;
  tmp: string;
  sink(id: string): string;
}

async function start(
  conversations: Record<string, string>,
  awake: string[],
  wakeOnSelect = true,
): Promise<Rig> {
  const tmp = mkdtempSync(join(tmpdir(), "hilo-enviar-"));
  const config = join(tmp, "claude-config");
  const slug = ROOT.replace(/[^a-zA-Z0-9]/g, "-");
  mkdirSync(join(config, "projects", slug), { recursive: true });
  for (const [id, text] of Object.entries(conversations)) {
    writeFileSync(join(config, "projects", slug, `${id}.jsonl`), text);
  }
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  // El segundo argumento que Hilo le pasa a claude (tras --resume o --session-id) es el id de la sesión.
  writeFileSync(
    join(bin, "claude.cmd"),
    `@echo off\r\n"${process.execPath}" "${join(ROOT, "tests", "fixtures", "sink.cjs")}" "${join(tmp, "sink-")}%~2.bin" --bracket\r\n`,
  );
  const state = makeState(
    [
      { id: A, kind: "claude", name: "Origen" },
      { id: B, kind: "claude", name: "Destino" },
      { id: C, kind: "claude", name: "Dormida" },
      { id: D, kind: "claude", name: "Sin respuesta" },
      { id: SHELL, kind: "shell", name: "Consola" },
    ],
    ROOT,
  );
  state.settings.claudePath = join(bin, "claude.cmd");
  state.settings.wakeOnSelect = wakeOnSelect;
  const ctx = await launch({
    state,
    env: { CLAUDE_CONFIG_DIR: config },
    width: 1400,
    height: 800,
  });
  for (const id of awake) {
    await ctx.page.evaluate(
      (sid) => (window as any).__hiloTest.wakeSession(sid),
      id,
    );
    await waitForText(ctx.page, id, "LISTO");
  }
  return { ctx, tmp, sink: (id) => join(tmp, `sink-${id}.bin`) };
}

async function stop(rig: Rig): Promise<void> {
  await rig.ctx.close();
  cleanup(rig.ctx.dataDir);
  rmSync(rig.tmp, { recursive: true, force: true, maxRetries: 3 });
}

const activeId = (page: Page): Promise<string | null> =>
  page.evaluate(
    () => (window as any).__hiloTest.app.get().state.ui.activeSessionId,
  );

const select = (page: Page, id: string) =>
  page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);

const send = (page: Page, from: string, to: string) =>
  page.evaluate(
    ([f, t]) => (window as any).__hiloTest.sendLastReply(f, t),
    [from, to] as const,
  );

const pasted = (bytes: Buffer): string => {
  const text = bytes.toString("utf8");
  const at = text.indexOf("\x1b[200~");
  return at < 0 ? "" : text.slice(at);
};

test("pega la respuesta en la sesión elegida, con el encabezado y sin Enter, y la deja a la vista", async () => {
  const rig = await start(
    { [A]: jsonl("Una respuesta vieja", "Primero\n\nSegundo con ñ y «comillas»") },
    [A, B],
  );
  try {
    const { page } = rig.ctx;
    await select(page, A);

    await page.locator(`.row[data-session="${A}"]`).click({ button: "right" });
    await page.locator('[data-action="send-last-reply"]').click();
    const picker = page.locator('[data-picker="send-reply"]');
    // Solo sesiones de Claude, y no la de origen: las dormidas entran (se despiertan al enviar), la PowerShell no.
    await expect(picker.getByRole("option")).toHaveCount(3);
    await expect(picker).toContainText("Destino");
    await expect(picker).toContainText("Dormida");
    await expect(picker.getByRole("option", { name: /Origen/ })).toHaveCount(0);
    await expect(picker.getByRole("option", { name: /Consola/ })).toHaveCount(0);
    await page.screenshot({ path: "test-results/enviar-respuesta-selector.png" });
    await picker.getByRole("option", { name: /Destino/ }).click();

    const got = await waitForSink(rig.sink(B), (b) =>
      b.toString("utf8").includes("\x1b[201~"),
    );
    // Bracketed paste, los saltos como \r (los pone term.paste) y NADA después: ningún Enter.
    expect(pasted(got)).toBe(
      "\x1b[200~De «Origen»:\r\rPrimero\r\rSegundo con ñ y «comillas»\x1b[201~",
    );
    await expect(page.locator(".toast").last()).toContainText(
      "Se pegó la respuesta de «Origen» en «Destino»",
    );
    await settle(400);
    expect(pasted(readSink(rig.sink(B)))).toBe(pasted(got));
    // La persona queda en la sesión que revisa.
    expect(await activeId(page)).toBe(B);
    // Lo que no es el destino no recibió nada.
    expect(readSink(rig.sink(A)).length).toBe(0);
    await page.screenshot({ path: "test-results/enviar-respuesta-pegado.png" });
  } finally {
    await stop(rig);
  }
});

for (const wakeOnSelect of [true, false]) {
  test(`una sesión dormida se despierta y recibe la respuesta (Despertar al seleccionar: ${wakeOnSelect ? "sí" : "no"})`, async () => {
    const rig = await start({ [A]: jsonl("Hola\n\ndesde A") }, [A], wakeOnSelect);
    try {
      const { page } = rig.ctx;
      await select(page, A);
      expect(await status(page, C)).toBe("asleep");

      await send(page, A, C);

      const got = await waitForSink(rig.sink(C), (b) =>
        b.toString("utf8").includes("\x1b[201~"),
      );
      // Después del despertar: un solo pegado, con el encabezado, la línea en blanco y sin Enter.
      expect(pasted(got)).toBe("\x1b[200~De «Origen»:\r\rHola\r\rdesde A\x1b[201~");
      expect(await status(page, C)).not.toBe("asleep");
      expect(await activeId(page)).toBe(C);
      await expect(page.locator(".toast").last()).toContainText(
        "Se pegó la respuesta de «Origen» en «Dormida»",
      );
      await settle(400);
      expect(pasted(readSink(rig.sink(C)))).toBe(pasted(got));
    } finally {
      await stop(rig);
    }
  });
}

test("sin respuesta, la misma sesión y una PowerShell solo avisan: la PowerShell no es destino ni tiene la opción", async () => {
  const rig = await start({ [A]: jsonl("Hola") }, [A, B, D]);
  try {
    const { page } = rig.ctx;
    await select(page, A);
    const toast = page.locator(".toast").last();

    await send(page, D, B);
    await expect(toast).toContainText("«Sin respuesta» todavía no tiene un mensaje");
    expect(await activeId(page)).toBe(A);

    await send(page, A, SHELL);
    await expect(toast).toContainText("es una PowerShell");
    expect(await activeId(page)).toBe(A);

    await send(page, A, A);
    await expect(toast).toContainText("Elige otra sesión");

    await send(page, SHELL, B);
    await expect(toast).toContainText("solo las sesiones de Claude");

    await settle(400);
    expect(pasted(readSink(rig.sink(B)))).toBe("");
    // Una dormida que no se eligió sigue dormida.
    expect(await status(page, C)).toBe("asleep");
    expect(readSink(rig.sink(C)).length).toBe(0);

    await page.locator(`.row[data-session="${SHELL}"]`).click({ button: "right" });
    await expect(page.locator('[data-action="mark-unread"], [data-action="mark-read"]')).toHaveCount(1);
    await expect(page.locator('[data-action="send-last-reply"]')).toHaveCount(0);
  } finally {
    await stop(rig);
  }
});

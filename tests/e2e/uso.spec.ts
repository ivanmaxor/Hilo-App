import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  acceptTrustIfNeeded,
  CLAUDE_ARGS,
  send,
  TRUSTED,
  uuid,
} from "./claude-helpers";
import {
  cleanup,
  launch,
  makeState,
  setWindowSize,
  settle,
  waitStatus,
} from "./helpers";

test("el uso del plan llega desde la línea de estado y se ve en la barra lateral", async () => {
  test.skip(
    process.env.HILO_E2E_CLAUDE !== "1",
    "Definir HILO_E2E_CLAUDE=1 para usar Claude real",
  );
  test.setTimeout(150_000);
  const id = uuid();
  const ctx = await launch({
    state: makeState([{ id, kind: "claude", name: "Uso" }], TRUSTED),
    claudeArgs: CLAUDE_ARGS,
    width: 1400,
    height: 800,
  });
  try {
    const { page, app } = ctx;
    await page.evaluate(
      (sid) => (window as any).__hiloTest.selectSession(sid),
      id,
    );
    await acceptTrustIfNeeded(page, id);
    await waitStatus(page, id, "idle", 40_000);
    await send(page, id, "responde solo OK");
    await waitStatus(page, id, "done", 60_000);

    const file = join(ctx.dataDir, "hooks", "usage.json");
    await expect.poll(() => existsSync(file), { timeout: 30_000 }).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    // Solo el uso: nada de la conversación ni de la carpeta.
    expect(Object.keys(saved).sort()).toEqual(expect.arrayContaining(["at"]));
    for (const key of Object.keys(saved))
      expect(["at", "five_hour", "seven_day"]).toContain(key);

    await expect(page.locator(".usage-row").first()).toBeVisible({
      timeout: 10_000,
    });
    await settle(500);
    await page.screenshot({ path: "test-results/uso-horizontal.png" });
    await setWindowSize(app, 760, 1300);
    await settle(800);
    await page.screenshot({ path: "test-results/uso-vertical.png" });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

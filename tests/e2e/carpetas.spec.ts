import { expect, test } from "@playwright/test";
import { CLAUDE_ARGS, TRUSTED } from "./claude-helpers";
import {
  cleanup,
  focusTerm,
  launch,
  makeState,
  settle,
  waitStatus,
} from "./helpers";

test("mover una sesión a otro proyecto y quitar el viejo no la toca", async () => {
  const state = makeState([{ id: "v", name: "Video" }]);
  state.projects[0]!.name = "tienda-video";
  state.projects[0]!.sessions[0]!.cwd = TRUSTED;
  state.projects.push({
    id: "cf",
    name: "Tienda",
    path: state.projects[0]!.path,
    color: null,
    collapsed: false,
    sessions: [],
  });
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    await page.locator('.row[data-session="v"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Tienda" }).click();
    await expect(
      page.locator('.project[data-project="cf"] .row[data-session="v"]'),
    ).toBeVisible();

    await page
      .locator('.project[data-project="proy"] .project-head')
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Quitar proyecto" }).click();
    await page.locator('[data-confirm="ok"]').click();
    await expect(page.locator('.project[data-project="proy"]')).toHaveCount(0);
    const session = await page.evaluate(
      () => (window as any).__hiloTest.app.get().state.projects[0].sessions[0],
    );
    expect(session).toMatchObject({ id: "v", name: "Video", cwd: TRUSTED });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test("Claude abierto dentro de una PowerShell la vuelve esa sesión de Claude, con la carpeta del cd", async () => {
  test.skip(
    process.env.HILO_E2E_CLAUDE !== "1",
    "Definir HILO_E2E_CLAUDE=1 para usar Claude real",
  );
  test.setTimeout(150_000);
  const ctx = await launch({
    state: makeState([{ id: "ps", name: "Mi PowerShell", kind: "shell" }]),
    // Una PowerShell de verdad, no la falsa de las pruebas.
    env: { HILO_TEST_SHELL: "" },
  });
  try {
    const { page } = ctx;
    await page.evaluate(() => (window as any).__hiloTest.selectSession("ps"));
    await waitStatus(page, "ps", "idle", 30_000);
    await focusTerm(page, "ps");
    await page.keyboard.type(
      `cd '${TRUSTED}'; claude ${CLAUDE_ARGS.join(" ")}`,
      { delay: 1 },
    );
    await page.keyboard.press("Enter");

    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as any).__hiloTest.app.get().state.projects[0].sessions[0],
          ),
        { timeout: 60_000 },
      )
      .toMatchObject({
        id: "ps",
        kind: "claude",
        name: "Mi PowerShell",
        cwd: TRUSTED,
      });
    await expect(page.locator(".toast").last()).toContainText(
      "ahora es una sesión de Claude",
    );
    await settle(500);
    await page.screenshot({ path: "test-results/powershell-claude.png" });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

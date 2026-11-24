import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  dueUsageAlerts,
  pruneFired,
  type UsageAlert,
} from "../shared/usageAlerts";
import type { PlanUsage } from "../shared/usage";
import type { Settings } from "../shared/types";

/**
 * Avisos de uso del plan (#8). Recibe cada lectura de uso y decide qué umbrales avisar. Lo ya avisado se
 * guarda en la carpeta de datos, para no repetir el aviso al reabrir Hilo dentro de la misma ventana.
 */
export class UsageAlerter {
  private readonly file: string;
  private fired: Set<string>;

  constructor(
    dataDir: string,
    private readonly settings: () => Settings,
    private readonly onAlert: (alert: UsageAlert) => void,
  ) {
    this.file = join(dataDir, "avisos-uso.json");
    this.fired = new Set(this.load());
  }

  check(usage: PlanUsage | null, now = Date.now()): void {
    const due = dueUsageAlerts(usage, this.settings(), this.fired, now);
    if (!due.length) return;
    for (const alert of due) for (const key of alert.keys) this.fired.add(key);
    this.fired = new Set(pruneFired(this.fired, now));
    this.save();
    for (const alert of due) this.onAlert(alert);
  }

  private load(): string[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      return Array.isArray(raw)
        ? raw
            .filter((k): k is string => typeof k === "string" && k.length < 80)
            .slice(0, 200)
        : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify([...this.fired]));
    } catch {
      // Sin poder guardar, en el peor caso se repite un aviso al reabrir.
    }
  }
}

import { useEffect, useState } from "preact/hooks";
import { formatSpan, usageLevel, type UsageWindow } from "../../shared/usage";
import { app, planUsage, useStore } from "../controller";

/** Cuánto se lleva del plan y cuándo se renueva. El dato lo da Claude al responder (D25). */
export function UsageMeter({ compact = false }: { compact?: boolean }) {
  const { usage } = useStore(planUsage);
  const { state } = useStore(app);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!state.settings.usageMeter || !state.settings.useHooks) return null;
  const rows = [
    { key: "session", label: "Sesión", win: usage?.session },
    { key: "week", label: "Semana", win: usage?.week },
  ].filter(
    (r): r is { key: string; label: string; win: UsageWindow } => !!r.win,
  );
  const age = usage?.at
    ? `Dato de hace ${formatSpan(now - usage.at)}, de la última respuesta de Claude.`
    : "";

  if (compact) {
    if (!rows.length) return null;
    const title = rows
      .map(
        (r) =>
          `${r.label}: ${Math.round(r.win.used)} % usado, ${resetText(r.win, now)}`,
      )
      .join("\n");
    return (
      <div class="usage-mini" title={`${title}\n${age}`} data-usage="mini">
        {rows.map((r) => (
          <span
            key={r.key}
            class={`lvl-${now >= r.win.resetsAt ? "ok" : usageLevel(r.win.used)}`}
          >
            {now >= r.win.resetsAt ? "—" : `${Math.round(r.win.used)}%`}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div class="usage" title={age} data-usage="full">
      {rows.length === 0 && (
        <span class="usage-empty">
          El uso de tu plan aparece con la próxima respuesta de Claude.
        </span>
      )}
      {rows.map((r) => {
        const renewed = now >= r.win.resetsAt;
        const used = renewed ? 0 : r.win.used;
        const level = usageLevel(used);
        return (
          <div key={r.key} class="usage-row" data-window={r.key}>
            <span class="usage-label">{r.label}</span>
            <span
              class={`usage-bar lvl-${level}`}
              role="meter"
              aria-label={`${r.label}: ${Math.round(used)} % usado`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(used)}
            >
              <span style={{ width: `${Math.max(2, used)}%` }} />
            </span>
            <span class={`usage-pct lvl-${level}`}>
              {renewed ? "—" : `${Math.round(used)} %`}
            </span>
            <span class="usage-reset">{resetText(r.win, now)}</span>
          </div>
        );
      })}
    </div>
  );
}

function resetText(win: UsageWindow, now: number): string {
  if (now >= win.resetsAt) return "Ya se renovó";
  const left = 100 - Math.round(win.used);
  return `Te queda ${left} %, se renueva en ${formatSpan(win.resetsAt - now)}`;
}

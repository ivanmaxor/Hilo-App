import { useMemo, useState } from "preact/hooks";
import { buildDailySummary } from "../../shared/dailySummary";
import { api } from "../api";
import { app } from "../controller";
import { Backdrop, closeModal } from "./dialogs";

/**
 * El resumen del día: lo arma Hilo con sus propios datos y no hace nada solo. Se arma una vez al abrir,
 * y lo que se ve es exactamente lo que se copia y lo que se guarda.
 */
export function SummaryDialog() {
  const text = useMemo(() => {
    const { state, runtime } = app.get();
    return buildDailySummary(state, runtime, new Date());
  }, []);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);

  const say = (msg: string, bad = false) => {
    setMessage(msg);
    setProblem(bad);
  };
  const copy = async () => {
    try {
      await api.clipWrite(text);
      say("Copiado al portapapeles.");
    } catch {
      say("No se pudo copiar: otro programa está usando el portapapeles.", true);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const result = await api.summarySave(text);
      if (result.ok) say(`Guardado en ${result.path}`);
      else if (result.message) say(result.message, true);
      else say("");
    } catch {
      say("No se pudo guardar.", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={closeModal} labelledBy="summary-title">
      <h2 id="summary-title">Resumen del día</h2>
      <p class="dialog-body">
        Armado con lo que Hilo guarda de tus sesiones de hoy: nombre, estado,
        marca y nota. No lee las conversaciones y no guarda nada por su cuenta.
      </p>
      <pre class="summary-preview" data-field="summary-preview" tabIndex={0}>
        {text}
      </pre>
      <p
        class={`summary-msg${problem ? " warn" : ""}`}
        role={problem ? "alert" : "status"}
        data-field="summary-message"
      >
        {message}
      </p>
      <div class="actions">
        <button onClick={closeModal}>Cerrar</button>
        <button data-action="summary-save" disabled={busy} onClick={save}>
          Guardar en una carpeta…
        </button>
        <button class="primary" data-action="summary-copy" onClick={copy}>
          Copiar
        </button>
      </div>
    </Backdrop>
  );
}

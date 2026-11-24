import {
  CUSTOM_SOUND,
  CUSTOM_SOUND_MAX_SECONDS,
  SOUND_GAP,
  soundSeconds,
  type SoundId,
} from "../shared/sounds";

let ctx: AudioContext | null = null;

/** Lo que suena: uno de los sintetizados o el audio propio (#12). */
export type PlayableSound = SoundId | typeof CUSTOM_SOUND;

/** El audio propio ya decodificado. Si no hay, o no se pudo leer, suena la gota. */
let custom: AudioBuffer | null = null;

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Carga el audio propio. false si no se pudo decodificar: no es un audio que el sistema sepa leer. */
export async function loadCustomSound(bytes: Uint8Array | null): Promise<boolean> {
  custom = null;
  if (!bytes || !bytes.length) return true;
  try {
    const copy = bytes.slice().buffer;
    custom = await audio().decodeAudioData(copy);
    return true;
  } catch {
    return false;
  }
}

export function hasCustomSound(): boolean {
  return custom !== null;
}

function secondsOf(id: PlayableSound): number {
  if (id === CUSTOM_SOUND) return custom ? Math.min(custom.duration, CUSTOM_SOUND_MAX_SECONDS) : soundSeconds("gota");
  return soundSeconds(id);
}

/** Toca una pasada de un sonido sintetizado. `volume` de 0 a 100. Devuelve con qué cortarla. */
function playOnce(requested: PlayableSound, volume: number): () => void {
  const ac = audio();
  const master = ac.createGain();
  master.gain.value = (Math.min(100, volume) / 100) * 0.5;
  master.connect(ac.destination);
  const t = ac.currentTime + 0.02;
  // Sin audio propio cargado suena la gota, para no quedar en silencio.
  const id: SoundId = requested === CUSTOM_SOUND ? "gota" : requested;
  if (requested === CUSTOM_SOUND && custom) {
    const src = ac.createBufferSource();
    src.buffer = custom;
    src.connect(master);
    src.start(t);
    src.stop(t + secondsOf(CUSTOM_SOUND));
    let done = false;
    const stop = () => {
      if (done) return;
      done = true;
      try {
        src.stop();
      } catch {
        // Ya había terminado.
      }
      master.disconnect();
    };
    setTimeout(stop, (secondsOf(CUSTOM_SOUND) + 0.5) * 1000);
    return stop;
  }
  const tone = (
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType = "sine",
    peak = 1,
    endFreq?: number,
  ) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t + start);
    if (endFreq)
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + start + dur);
    gain.gain.setValueAtTime(0.0001, t + start);
    gain.gain.exponentialRampToValueAtTime(peak, t + start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t + start);
    osc.stop(t + start + dur + 0.05);
  };
  switch (id) {
    case "gota":
      tone(1250, 0, 0.28, "sine", 1, 520);
      break;
    case "campana":
      tone(660, 0, 1.6, "sine", 0.8);
      tone(1320, 0, 1, "sine", 0.3);
      tone(1980, 0, 0.6, "sine", 0.12);
      break;
    case "dos-notas":
      tone(659, 0, 0.26, "triangle", 0.9);
      tone(988, 0.17, 0.5, "triangle", 0.9);
      break;
    case "acorde":
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 1.1, "sine", 0.4));
      break;
    case "cristal":
      tone(1568, 0, 0.55, "sine", 0.55);
      tone(2093, 0.09, 0.65, "sine", 0.4);
      break;
    case "pitido":
      tone(1046, 0, 0.12, "square", 0.22);
      tone(1046, 0.2, 0.12, "square", 0.22);
      break;
    case "grave":
      tone(330, 0, 0.35, "triangle", 0.9);
      tone(220, 0.22, 0.65, "triangle", 0.9);
      break;
    case "timbre":
      // Din-don dos veces, como un timbre de puerta.
      [0, 0.9].forEach((at) => {
        tone(659, at, 0.8, "sine", 0.8);
        tone(1318, at, 0.4, "sine", 0.15);
        tone(523, at + 0.4, 0.9, "sine", 0.8);
        tone(1046, at + 0.4, 0.45, "sine", 0.15);
      });
      break;
    case "melodia":
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
        tone(f, i * 0.22, i === 5 ? 1.1 : 0.45, "triangle", 0.7),
      );
      break;
    case "alarma":
      // Tres grupos de tres notas que suben: insistente sin ser estridente.
      for (let g = 0; g < 3; g++) {
        [784, 988, 1175].forEach((f, i) =>
          tone(f, g * 0.8 + i * 0.14, 0.18, "triangle", 0.75),
        );
      }
      break;
    case "ola": {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 1.3);
      osc.frequency.exponentialRampToValueAtTime(440, t + 2.7);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.7, t + 0.5);
      gain.gain.setValueAtTime(0.7, t + 2.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.75);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + 2.8);
      break;
    }
  }
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    master.disconnect();
  };
  setTimeout(stop, (soundSeconds(id) + 0.5) * 1000);
  return stop;
}

/**
 * Toca el sonido una vez, o lo repite seguido hasta llenar `duration` segundos. Antes de cada pasada pregunta
 * `keepGoing`, para cortar apenas se atienda la sesión. `onEnd` avisa al terminar o al cortarse. Devuelve con
 * qué detenerlo.
 */
export function playSound(
  id: PlayableSound,
  volume: number,
  duration = 0,
  keepGoing: () => boolean = () => true,
  onEnd: () => void = () => undefined,
): () => void {
  if (volume <= 0) {
    onEnd();
    return () => undefined;
  }
  const seconds = secondsOf(id);
  const passes = duration <= 0 ? 1 : Math.max(1, Math.floor((duration + SOUND_GAP) / (seconds + SOUND_GAP)));
  const step = (seconds + SOUND_GAP) * 1000;
  let current: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let left = passes;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    current?.();
    onEnd();
  };
  const next = () => {
    if (left <= 0 || !keepGoing()) {
      finish();
      return;
    }
    left--;
    current = playOnce(id, volume);
    timer = setTimeout(next, step);
  };
  next();
  return finish;
}

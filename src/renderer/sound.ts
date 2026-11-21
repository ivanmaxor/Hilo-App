import type { SoundId } from "../shared/sounds";

let ctx: AudioContext | null = null;

/** Toca un sonido sintetizado. `volume` de 0 a 100. */
export function playSound(id: SoundId, volume: number): void {
  if (volume <= 0) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = (Math.min(100, volume) / 100) * 0.5;
  master.connect(ac.destination);
  const t = ac.currentTime + 0.02;
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
  }
  setTimeout(() => master.disconnect(), 2500);
}

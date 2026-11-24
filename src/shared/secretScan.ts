/**
 * Detecta, en un texto que se va a pegar, lo que parece una clave. Devuelve solo los TIPOS que encontró,
 * nunca el texto: lo pegado a Claude va al modelo y queda guardado en la conversación en disco.
 * Lista corta y de señal alta, para no molestar. Todo ocurre en memoria; nada se guarda ni se envía.
 */

export type SecretKind = 'anthropic' | 'github' | 'aws' | 'slack' | 'stripe' | 'privateKey' | 'envVar';

/** Cómo se nombra cada tipo en el diálogo. */
export const SECRET_LABELS: Record<SecretKind, string> = {
  anthropic: 'Clave de Anthropic (sk-ant-…)',
  github: 'Token de GitHub (ghp_…, github_pat_…)',
  aws: 'Clave de acceso de AWS (AKIA…)',
  slack: 'Token de Slack (xoxb-…, xoxp-…, xapp-…)',
  stripe: 'Clave secreta de Stripe (sk_live_…, sk_test_…, rk_…)',
  privateKey: 'Clave privada (BEGIN … PRIVATE KEY)',
  envVar: 'Línea de .env con una clave, token o contraseña',
};

/** Más allá de esto no se mira: 5 MB se revisan en decenas de milisegundos. */
export const MAX_SCAN_CHARS = 8 * 1024 * 1024;
/** Una línea de .env más larga que esto es otra cosa (código minificado, base64). */
const MAX_ENV_LINE = 400;

const PATTERNS: [SecretKind, RegExp][] = [
  ['anthropic', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/],
  ['github', /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['aws', /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/],
  // Slack y Stripe se añadieron por decisión del dueño (#13): sus prefijos son claros. JWT queda para después.
  ['slack', /(?<![A-Za-z0-9])(?:xox[abprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{20,})/],
  ['stripe', /(?<![A-Za-z0-9])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/],
  ['privateKey', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
];

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;
const SECRET_WORD = /^(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/;
const PLACEHOLDER = /^(?:changeme|change[-_]me|x{3,}|\*{3,}|your[-_ ].*|null|undefined|none|true|false)$/i;

function isEnvSecret(line: string): boolean {
  const m = ENV_LINE.exec(line);
  if (!m) return false;
  const name = m[1]!;
  // El nombre va en mayúsculas, como en un .env; solo cuenta su último segmento: KEYBOARD no es KEY.
  if (name !== name.toUpperCase()) return false;
  const last = name.split(/[_.-]/).pop()!;
  if (!SECRET_WORD.test(last)) return false;
  let value = m[2]!.trim();
  const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
  if (quote) {
    const end = value.indexOf(quote, 1);
    value = end > 0 ? value.slice(1, end) : value.slice(1);
  } else {
    // Sin comillas el valor llega hasta un espacio o un comentario.
    value = value.split(/\s/)[0]!;
  }
  if (value.length < 8) return false;
  if (/^\$/.test(value) || /^%.*%$/.test(value) || /^<.*>$/.test(value)) return false;
  return !PLACEHOLDER.test(value);
}

function hasEnvSecret(text: string): boolean {
  let start = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = n;
    // Se mira por línea (sin regex multilínea) y solo si es corta.
    if (end - start <= MAX_ENV_LINE + 1 && isEnvSecret(text.slice(start, end).replace(/\r$/, ''))) return true;
    start = end + 1;
  }
  return false;
}

/** Los tipos de clave que parece contener el texto, sin repetir y en orden fijo. Nunca el valor. */
export function scanSecrets(text: string): SecretKind[] {
  if (!text) return [];
  const sample = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  const found: SecretKind[] = [];
  for (const [kind, re] of PATTERNS) if (re.test(sample)) found.push(kind);
  if (hasEnvSecret(sample)) found.push('envVar');
  return found;
}

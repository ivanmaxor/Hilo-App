/**
 * Línea de estado de las sesiones de Hilo (D25). Claude Code le pasa por stdin un JSON con el modelo, la
 * carpeta y el uso del plan, sin el prompt ni el contenido de archivos. El script guarda solo
 * `rate_limits`, en un `usage-<sesión>.json` por sesión de Claude, y anota cuándo cambió cada ventana: una
 * sesión quieta repite el dato de su última respuesta, que pudo quedar viejo (una restauración del plan,
 * por ejemplo). Muestra en la línea de estado el dato más nuevo de todas. Solo reescribe si algo cambió.
 * ASCII con escapes: PowerShell 5 lee un .ps1 sin BOM con la página de códigos del sistema.
 */
export const USAGE_SCRIPT = `# Hilo: linea de estado de sus sesiones. Guarda solo el uso del plan (rate_limits).
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$e = [char]27
$keys = @('five_hour', 'seven_day')
$sid = [string]$j.session_id
if ($sid -notmatch '^[0-9A-Za-z-]{1,64}$') { $sid = 'x' }
$file = Join-Path $PSScriptRoot "usage-$sid.json"
$prev = $null
if (Test-Path -LiteralPath $file) { $prev = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json }
$data = [ordered]@{ at = $now }
$dirty = $false
foreach ($k in $keys) {
  $w = $j.rate_limits.$k
  $p = $null
  if ($null -ne $prev) { $p = $prev.$k }
  if ($null -eq $w -or $null -eq $w.used_percentage -or $null -eq $w.resets_at) {
    if ($null -ne $p) { $dirty = $true }
    continue
  }
  $used = [double]$w.used_percentage
  $resets = [long]$w.resets_at
  $changed = $now
  if ($null -ne $p -and $null -ne $p.changed -and [double]$p.used -eq $used -and [long]$p.resets_at -eq $resets) { $changed = [long]$p.changed } else { $dirty = $true }
  $data[$k] = [ordered]@{ used = $used; resets_at = $resets; changed = $changed }
}
if ($dirty -and $data.Count -gt 1) {
  $tmp = Join-Path $PSScriptRoot "usage-$sid.$PID.tmp"
  try {
    ($data | ConvertTo-Json -Compress) | Set-Content -Encoding ASCII -LiteralPath $tmp
    Move-Item -Force -LiteralPath $tmp -Destination $file
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp }
  }
}
$best = @{}
foreach ($f in Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'usage-*.json') {
  $r = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json
  if ($null -eq $r) { continue }
  foreach ($k in $keys) {
    $w = $r.$k
    if ($null -eq $w -or [long]$w.resets_at -le $now) { continue }
    $b = $best[$k]
    if ($null -eq $b -or [long]$w.changed -gt [long]$b.changed) { $best[$k] = $w }
  }
}
$parts = @()
foreach ($k in $keys) {
  $w = $best[$k]
  if ($null -eq $w) { continue }
  $used = [double]$w.used
  $left = [math]::Max(0, [long]$w.resets_at - $now)
  $mins = [math]::Ceiling($left / 60)
  $d = [math]::Floor($mins / 1440); $h = [math]::Floor(($mins % 1440) / 60); $m = $mins % 60
  if ($d -gt 0) { $t = if ($h -gt 0) { "$d d $h h" } else { "$d d" } } elseif ($h -gt 0) { $t = if ($m -gt 0) { "$h h $m min" } else { "$h h" } } else { $t = "$m min" }
  $c = if ($used -ge 80) { 31 } elseif ($used -ge 50) { 33 } else { 32 }
  $label = if ($k -eq 'five_hour') { 'Sesi' + [char]0xF3 + 'n' } else { 'Semana' }
  $parts += "$label $e[$($c)m$([math]::Round($used))%$e[0m, se renueva en $t"
}
if ($parts.Count) { $parts -join '   ' } elseif ($j.model.display_name) { $j.model.display_name }
`;

/**
 * El comando para \`statusLine\`. Sirve igual en Git Bash y en PowerShell: sin comillas en el ejecutable
 * y con comillas simples en el script. null si la ruta no se puede citar sin riesgo.
 */
export function usageCommand(
  scriptPath: string,
  systemRoot = process.env.SystemRoot ?? "C:\\Windows",
): string | null {
  const script = scriptPath.replace(/\\/g, "/");
  if (/['"\u2018\u2019\u201a\u201b\u201c\u201d\u201e$`]/.test(script))
    return null;
  const root = systemRoot.replace(/\\/g, "/");
  const exe = /^[A-Za-z]:\/[\w./-]+$/.test(root)
    ? `${root}/System32/WindowsPowerShell/v1.0/powershell.exe`
    : "powershell";
  return `${exe} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '${script}'`;
}

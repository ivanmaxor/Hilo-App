/**
 * Línea de estado de las sesiones de Hilo (D25). Claude Code le pasa por stdin un JSON con el modelo, la
 * carpeta y el uso del plan, sin el prompt ni el contenido de archivos. El script guarda en `usage.json`
 * solo `rate_limits` y muestra el uso en la línea de estado de Claude. ASCII con escapes: PowerShell 5
 * lee un .ps1 sin BOM con la página de códigos del sistema.
 */
export const USAGE_SCRIPT = `# Hilo: linea de estado de sus sesiones. Guarda solo el uso del plan (rate_limits) en usage.json.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$e = [char]27
$parts = @()
$data = [ordered]@{ at = $now }
foreach ($k in @('five_hour', 'seven_day')) {
  $w = $j.rate_limits.$k
  if ($null -eq $w -or $null -eq $w.used_percentage -or $null -eq $w.resets_at) { continue }
  $used = [double]$w.used_percentage
  $resets = [long]$w.resets_at
  $data[$k] = [ordered]@{ used = $used; resets_at = $resets }
  $left = [math]::Max(0, $resets - $now)
  $d = [math]::Floor($left / 86400); $h = [math]::Floor(($left % 86400) / 3600); $m = [math]::Ceiling(($left % 3600) / 60)
  if ($d -gt 0) { $t = "$d d $h h" } elseif ($h -gt 0) { $t = "$h h $m min" } else { $t = "$m min" }
  $c = if ($used -ge 80) { 31 } elseif ($used -ge 50) { 33 } else { 32 }
  $label = if ($k -eq 'five_hour') { 'Sesi' + [char]0xF3 + 'n' } else { 'Semana' }
  $parts += "$label $e[$($c)m$([math]::Round($used))%$e[0m, se renueva en $t"
}
if ($data.Count -gt 1) {
  $tmp = Join-Path $PSScriptRoot "usage.$PID.tmp"
  ($data | ConvertTo-Json -Compress) | Set-Content -Encoding ASCII -Path $tmp
  Move-Item -Force -Path $tmp -Destination (Join-Path $PSScriptRoot 'usage.json')
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

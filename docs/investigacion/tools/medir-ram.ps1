<#
.SYNOPSIS
  Mide la RAM de un arbol de procesos en Windows (PowerShell 5.1), de forma justa para apps multi-proceso.
.DESCRIPTION
  Recorre recursivamente el arbol de procesos desde -RootPid/-RootPids (Win32_Process.ParentProcessId,
  con guarda contra reutilizacion de PID), muestrea N veces cada S segundos y entrega:
    WS MB       = Working Set (incluye paginas compartidas: sobrecuenta en Chromium)
    PrivWS MB   = Working Set - Private (lo que muestra el Administrador de tareas, "Memory")
    PrivBytes MB= Private Bytes (memoria comprometida privada)
    Commit MB   = PageFileUsage de Win32_Process (commit charge del proceso)
  Totales: con todos los procesos y sin los excluidos (-Exclude por nombre sin .exe).
  Un proceso excluido NO se cuenta, pero sus hijos si, salvo -ExcludeSubtree (excluye tambien su descendencia).
  Solo lectura: no modifica ni mata nada.
.EXAMPLE
  .\medir-ram.ps1 -RootPid 1234 -Exclude claude,node -ExcludeSubtree -Samples 5 -IntervalSec 3 -Json out.json
.EXAMPLE
  # Usa -RootPids para varias raices (p.ej. WindowsTerminal.exe de la ventana aislada)
  .\medir-ram.ps1 -RootPids 100,200 -Exclude powershell
#>
[CmdletBinding()]
param(
  [int]$RootPid,
  [int[]]$RootPids,
  [string[]]$Exclude = @(),
  [switch]$ExcludeSubtree,
  [int]$Samples = 5,
  [double]$IntervalSec = 3,
  [double]$WarmupSec = 0,
  [string]$Json,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$roots = @()
if ($RootPid) { $roots += $RootPid }
if ($RootPids) { $roots += $RootPids }
$roots = @($roots | Select-Object -Unique)
if ($roots.Count -eq 0) { throw 'Indica -RootPid o -RootPids.' }
$excl = @($Exclude | ForEach-Object { ($_ -replace '\.exe$','').ToLowerInvariant() })
$MB = 1MB

function Get-Tree {
  param([int[]]$Roots)
  $all = @(Get-CimInstance Win32_Process)
  $byPid = @{}; $kids = @{}
  foreach ($p in $all) {
    $byPid[[int]$p.ProcessId] = $p
    $k = [int]$p.ParentProcessId
    if (-not $kids.ContainsKey($k)) { $kids[$k] = New-Object System.Collections.ArrayList }
    [void]$kids[$k].Add($p)
  }
  $res = @{}   # pid -> @{P=proc; Parent=pid}
  $queue = New-Object System.Collections.Queue
  foreach ($r in $Roots) { if ($byPid.ContainsKey($r)) { $res[$r] = @{P=$byPid[$r]; Parent=-1}; $queue.Enqueue($r) } }
  while ($queue.Count -gt 0) {
    $cur = $queue.Dequeue()
    $cp = $byPid[$cur]
    if (-not $kids.ContainsKey($cur)) { continue }
    foreach ($c in $kids[$cur]) {
      $cid = [int]$c.ProcessId
      if ($res.ContainsKey($cid)) { continue }
      # guarda anti reutilizacion de PID: el hijo debe haberse creado despues del padre
      if ($cp.CreationDate -and $c.CreationDate -and $c.CreationDate -lt $cp.CreationDate) { continue }
      $res[$cid] = @{P=$c; Parent=$cur}; $queue.Enqueue($cid)
    }
  }
  return $res
}

function Get-Sample {
  $tree = Get-Tree -Roots $roots
  $perf = @{}
  foreach ($x in (Get-CimInstance Win32_PerfFormattedData_PerfProc_Process)) { $perf[[int]$x.IDProcess] = $x }
  # excluidos (con subarbol opcional)
  $excludedSet = @{}
  foreach ($id in $tree.Keys) {
    $n = ($tree[$id].P.Name -replace '\.exe$','').ToLowerInvariant()
    if ($excl -contains $n) { $excludedSet[$id] = $true }
  }
  if ($ExcludeSubtree) {
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($id in $tree.Keys) {
        if (-not $excludedSet.ContainsKey($id) -and $excludedSet.ContainsKey($tree[$id].Parent)) { $excludedSet[$id] = $true; $changed = $true }
      }
    }
  }
  $rows = foreach ($id in ($tree.Keys | Sort-Object)) {
    $p = $tree[$id].P; $pf = $perf[$id]
    [pscustomobject]@{
      Name = $p.Name; Pid = $id; Parent = $tree[$id].Parent
      WS = [double]$p.WorkingSetSize
      PrivWS = $(if ($pf) { [double]$pf.WorkingSetPrivate } else { 0 })
      PrivBytes = $(if ($pf) { [double]$pf.PrivateBytes } else { [double]$p.PrivatePageCount })
      Commit = [double]$p.PageFileUsage * 1KB
      Excluded = $excludedSet.ContainsKey($id)
    }
  }
  return @($rows)
}

if ($WarmupSec -gt 0) { Start-Sleep -Seconds $WarmupSec }
$samplesData = New-Object System.Collections.ArrayList
for ($i = 1; $i -le $Samples; $i++) {
  [void]$samplesData.Add((Get-Sample))
  if ($i -lt $Samples) { Start-Sleep -Milliseconds ([int]($IntervalSec * 1000)) }
}

# Agregar por PID (media de las muestras donde aparece)
$agg = @{}
foreach ($s in $samplesData) {
  foreach ($r in $s) {
    if (-not $agg.ContainsKey($r.Pid)) { $agg[$r.Pid] = @{R=$r; n=0; ws=0.0; pws=0.0; pb=0.0; cm=0.0} }
    $a = $agg[$r.Pid]; $a.n++; $a.ws += $r.WS; $a.pws += $r.PrivWS; $a.pb += $r.PrivBytes; $a.cm += $r.Commit
  }
}
$table = foreach ($pid_ in ($agg.Keys | Sort-Object)) {
  $a = $agg[$pid_]
  [pscustomobject][ordered]@{
    Name = $a.R.Name; PID = $pid_; Parent = $a.R.Parent; Excluded = $a.R.Excluded; Seen = $a.n
    'WS MB' = [math]::Round($a.ws / $a.n / $MB, 1)
    'PrivWS MB' = [math]::Round($a.pws / $a.n / $MB, 1)
    'PrivBytes MB' = [math]::Round($a.pb / $a.n / $MB, 1)
    'Commit MB' = [math]::Round($a.cm / $a.n / $MB, 1)
  }
}
$table = @($table)

# Totales por muestra (para media/min/max reales, no suma de medias)
function Get-Totals([bool]$useExcl) {
  $ws=@();$pw=@();$pb=@();$cm=@();$cnt=@()
  foreach ($s in $samplesData) {
    $sel = if ($useExcl) { @($s | Where-Object { -not $_.Excluded }) } else { $s }
    $ws += ($sel | Measure-Object WS -Sum).Sum / $MB
    $pw += ($sel | Measure-Object PrivWS -Sum).Sum / $MB
    $pb += ($sel | Measure-Object PrivBytes -Sum).Sum / $MB
    $cm += ($sel | Measure-Object Commit -Sum).Sum / $MB
    $cnt += $sel.Count
  }
  function st($v) { $m = $v | Measure-Object -Average -Minimum -Maximum; [ordered]@{avg=[math]::Round($m.Average,1);min=[math]::Round($m.Minimum,1);max=[math]::Round($m.Maximum,1)} }
  [ordered]@{ procs_avg=[math]::Round(($cnt|Measure-Object -Average).Average,1); WS_MB=(st $ws); PrivWS_MB=(st $pw); PrivBytes_MB=(st $pb); Commit_MB=(st $cm) }
}
$totAll = Get-Totals $false
$totNet = Get-Totals $true

if (-not $Quiet) {
  $table | Format-Table Name,PID,Parent,Excluded,Seen,'WS MB','PrivWS MB','PrivBytes MB','Commit MB' -AutoSize | Out-String -Width 200 | Write-Host
  foreach ($t in @(@('TOTAL (todos)',$totAll),@('TOTAL (sin excluidos)',$totNet))) {
    $v = $t[1]
    Write-Host ("{0}: procs~{1}  WS={2} MB  PrivWS={3} MB (min {4} max {5})  PrivBytes={6} MB  Commit={7} MB" -f $t[0],$v.procs_avg,$v.WS_MB.avg,$v.PrivWS_MB.avg,$v.PrivWS_MB.min,$v.PrivWS_MB.max,$v.PrivBytes_MB.avg,$v.Commit_MB.avg)
  }
}
$out = [ordered]@{
  timestamp = (Get-Date).ToString('o'); roots = $roots; exclude = $excl; excludeSubtree = [bool]$ExcludeSubtree
  samples = $Samples; intervalSec = $IntervalSec; processes = $table; totalAll = $totAll; totalNet = $totNet
}
if ($Json) { $out | ConvertTo-Json -Depth 6 | Set-Content -Path $Json -Encoding UTF8 }
else { if ($Quiet) { $out | ConvertTo-Json -Depth 6 } }

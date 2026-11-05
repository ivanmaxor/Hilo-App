[Console]::OutputEncoding=[Text.Encoding]::UTF8
Clear-Host
$e=[char]27
Write-Output "Texto normal: The quick brown fox jumps over the lazy dog 0123456789"
Write-Output "$($e)[1mNegrita: The quick brown fox$($e)[0m  $($e)[2mAtenuado: lazy dog$($e)[0m"
Write-Output "$($e)[31mrojo $($e)[32mverde $($e)[33mamarillo $($e)[34mazul $($e)[35mmagenta $($e)[36mcian $($e)[90mgris$($e)[0m"
Write-Output "$($e)[38;2;215;119;87mtruecolor naranja Claude$($e)[0m  $($e)[48;2;55;55;55m fondo de línea $($e)[0m"
Write-Output "ñandú áéíóú ¿qué? 😀 日本語 ✳ ◐ ◑ ⏵⏵ ⎿ ● ❯"
Write-Output "╭────────────────────────╮"
Write-Output "│ caja con bordes  ▐▛███▜▌│"
Write-Output "╰────────────────────────╯"

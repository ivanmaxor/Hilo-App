# Captura la ventana de Windows Terminal con el mismo contenido que Hilo, para comparar a ojo.
# Abre una ventana propia con `wt -w new` y la cierra al terminar. No toca las del usuario.
param([string]$Out, [string]$Script)
Add-Type -AssemblyName System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;using System.Runtime.InteropServices;
public class Cap{
[StructLayout(LayoutKind.Sequential)] public struct RECT{public int L,T,R,B;}
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);
}
"@
$cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$root = [Windows.Automation.AutomationElement]::RootElement
$before = @($root.FindAll([Windows.Automation.TreeScope]::Children, $cond) | ForEach-Object { $_.Current.NativeWindowHandle })
Start-Process wt.exe -ArgumentList "-w new --title comparar-hilo powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -File `"$Script`""
$hwnd = $null
for ($i = 0; $i -lt 40 -and -not $hwnd; $i++) {
  Start-Sleep -Milliseconds 250
  foreach ($w in $root.FindAll([Windows.Automation.TreeScope]::Children, $cond)) {
    if ($w.Current.NativeWindowHandle -notin $before) { $hwnd = [IntPtr]$w.Current.NativeWindowHandle }
  }
}
if (-not $hwnd) { throw 'No apareció la ventana' }
Start-Sleep -Seconds 6
$rect = New-Object Cap+RECT
[void][Cap]::GetWindowRect($hwnd, [ref]$rect)
$bmp = New-Object Drawing.Bitmap ($rect.R - $rect.L), ($rect.B - $rect.T)
$g = [Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[void][Cap]::PrintWindow($hwnd, $dc, 2)
$g.ReleaseHdc($dc)
$g.Dispose()
$bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[void][Cap]::PostMessage($hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Seconds 2
if ([Cap]::IsWindow($hwnd)) {
  $e = [Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $b = $e.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, 'PrimaryButton')))
  if ($b) { $b.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
}
Start-Sleep -Seconds 1
"Ventana cerrada: " + (-not [Cap]::IsWindow($hwnd))

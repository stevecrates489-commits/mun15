param(
  [string]$Out = "shot.png",
  [int]$X = -1,
  [int]$Y = -1,
  [string]$Key = "",
  [string]$Text = "",
  [switch]$Enter,
  [switch]$Screen,
  [int]$Wait = 800
)
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int how);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process minidisc-player -ErrorAction Stop | Select-Object -First 1
$h = $p.MainWindowHandle
[void][W]::ShowWindow($h, 9)
[void][W]::SetForegroundWindow($h)
[void][W]::SetWindowPos($h, [IntPtr]-1, 0, 0, 0, 0, 0x0003)
Start-Sleep -Milliseconds 400
$r = New-Object W+RECT
[void][W]::GetWindowRect($h, [ref]$r)
if ($X -ge 0) {
  [void][W]::SetCursorPos($r.Left + $X, $r.Top + $Y)
  Start-Sleep -Milliseconds 200
  [W]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [W]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds $Wait
}
if ($Text) {
  [System.Windows.Forms.SendKeys]::SendWait($Text)
  Start-Sleep -Milliseconds 300
}
if ($Enter) {
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds $Wait
}
if ($Key -eq "ESC") {
  [W]::keybd_event(0x1B, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [W]::keybd_event(0x1B, 0, 2, [IntPtr]::Zero)
  Start-Sleep -Milliseconds $Wait
}
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ($Screen) {
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
} else {
  $dc = $g.GetHdc()
  [void][W]::PrintWindow($h, $dc, 2)
  $g.ReleaseHdc($dc)
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"SHOT $Out rect=$($r.Left),$($r.Top) ${w}x${hh}"

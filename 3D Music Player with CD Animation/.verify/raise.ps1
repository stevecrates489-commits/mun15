param([switch]$Close)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class R {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Find(uint want, string prefix) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want) {
        var sb = new StringBuilder(256);
        GetWindowText(h, sb, 256);
        if (sb.ToString().StartsWith(prefix)) { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$p = Get-Process minidisc-player | Select-Object -First 1
$h = [R]::Find([uint32]$p.Id, "Sign in")
if ($h -eq [IntPtr]::Zero) { "no sign-in window"; exit 1 }
if ($Close) { [void][R]::SendMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); "closed"; exit 0 }
[void][R]::SetWindowPos($h, [IntPtr]-1, 0, 0, 0, 0, 0x0003)
[void][R]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 4500
"raised"

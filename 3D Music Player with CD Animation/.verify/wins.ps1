Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> List(uint want) {
    var found = new List<string>();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want) {
        var sb = new StringBuilder(256);
        GetWindowTextW(h, sb, 256);
        if (sb.Length > 0) found.Add((IsWindowVisible(h) ? "visible" : "hidden") + " :: " + sb.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$p = Get-Process minidisc-player | Select-Object -First 1
[W]::List([uint32]$p.Id) | ForEach-Object { $_ }

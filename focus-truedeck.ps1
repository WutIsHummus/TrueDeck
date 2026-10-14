# Focus the local TrueDeck window if it is already running.
# Exit 0 when an existing window was found, 1 when the app is not running.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TdFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$proc = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.ExecutablePath -like 'C:\Users\alper\TrueDeck\node_modules\electron\*' } |
  Select-Object -First 1

if (-not $proc) { exit 1 }

$gp = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
if (-not $gp -or $gp.MainWindowHandle -eq [IntPtr]::Zero) { exit 1 }

$hwnd = $gp.MainWindowHandle
if ([TdFocus]::IsIconic($hwnd)) { [void][TdFocus]::ShowWindow($hwnd, 9) }

# Only pull the window onto the primary screen when it is not already on it.
Add-Type -AssemblyName System.Windows.Forms
$primary = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$rect = New-Object TdFocus+RECT
[void][TdFocus]::GetWindowRect($hwnd, [ref]$rect)
$onPrimary = $rect.Right -gt ($primary.X + 80) -and $rect.Left -lt ($primary.X + $primary.Width - 80) -and $rect.Bottom -gt ($primary.Y + 40) -and $rect.Top -lt ($primary.Y + $primary.Height - 40)
if (-not $onPrimary) {
  $width = [Math]::Min(1440, $primary.Width)
  $height = [Math]::Min(900, $primary.Height)
  $x = $primary.X + 80
  $y = $primary.Y + 60
  # SWP_SHOWWINDOW
  [void][TdFocus]::SetWindowPos($hwnd, [IntPtr]::Zero, $x, $y, $width, $height, 0x0040)
}

[void][TdFocus]::ShowWindow($hwnd, 5)
[void][TdFocus]::SetForegroundWindow($hwnd)
exit 0

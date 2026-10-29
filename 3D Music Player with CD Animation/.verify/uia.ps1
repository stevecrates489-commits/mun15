param([string]$Name = "", [string]$List = "0")
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$p = Get-Process minidisc-player -ErrorAction Stop | Select-Object -First 1
$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
if ($List -ne "0") {
  foreach ($e in $all) {
    try {
      if ($e.Current.ControlType.ProgrammaticName -eq "ControlType.Button" -and $e.Current.Name) {
        "BUTTON :: " + $e.Current.Name
      }
    } catch {}
  }
  exit 0
}
if (-not $Name) { "no name"; exit 1 }
foreach ($e in $all) {
  try {
    if ($e.Current.Name -eq $Name -and $e.Current.ControlType.ProgrammaticName -eq "ControlType.Button") {
      $pat = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $pat.Invoke()
      "INVOKED :: $Name"
      exit 0
    }
  } catch {}
}
"MISSING :: $Name"

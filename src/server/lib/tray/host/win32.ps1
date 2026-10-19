# Windows tray host - a NotifyIcon in the notification area, owned by the server.
#
# Run as:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this file> -ConfigPath <config.json>
#
# PowerShell is used rather than a compiled helper because it is on every Windows
# install, and `System.Windows.Forms.NotifyIcon` is the shell's own tray API.
# [INFERENCE: this host's API surface is the documented one; it was NOT exercised
# on this machine, which is macOS. The macOS host and the server half behind both
# are verified.]
#
# Same two lifecycle rules as the macOS host, for the same reasons:
#
#   1. The host is the SERVER's child and dies with it. `Parent` is polled on a
#      timer; when the server exits, `.HasExited` flips and the icon goes away,
#      so a crashed server leaves no orphan icon.
#   2. Quit signals the SERVER (SIGTERM via `taskkill` on the parent's pid), so
#      the icon and the console it fronts end together.
#
# Every other row is a platform call (open a URL, open a file) or a callback into
# the CLI (`serve --startup` / `--no-startup`), so liveness, server control and
# login registration each exist once, in `src/server/lib`.

param([Parameter(Mandatory = $true)][string]$ConfigPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId

function Invoke-Cli([string[]]$extra) {
  Start-Process -FilePath $config.bun -ArgumentList (@($config.cli, 'serve') + $extra + @('--port', "$($config.port)")) -WindowStyle Hidden | Out-Null
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-Object System.Drawing.Icon($config.icon)
$notify.Text = "$($config.label) - $($config.url)"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.add_Opening({
  $menu.Items.Clear()
  $rows = @(
    @{ Title = 'Open Console'; Kind = 'open' },
    @{ Title = 'Open Logs'; Kind = 'logs' },
    @{ Kind = 'separator' },
    @{ Title = $(if ($config.loginInstalled) { 'Disable Start at Login' } else { 'Start at Login' }); Kind = 'login' },
    @{ Kind = 'separator' },
    @{ Title = 'Quit Kabmo'; Kind = 'quit' }
  )
  foreach ($row in $rows) {
    if ($row.Kind -eq 'separator') {
      $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
      continue
    }
    $item = New-Object System.Windows.Forms.ToolStripMenuItem($row.Title)
    $item.Tag = $row.Kind
    $item.add_Click({
      param($sender, $eventArgs)
      switch ($sender.Tag) {
        'open' { Start-Process $config.url | Out-Null }
        'logs' { Start-Process $config.logFile | Out-Null }
        'login' {
          if ($config.loginInstalled) { Invoke-Cli @('--no-startup') } else { Invoke-Cli @('--startup') }
        }
        'quit' {
          # Signal the SERVER first, then exit: the console must go down with the
          # icon rather than being left running with no tray.
          & taskkill /PID $parentPid /T /F 2>$null | Out-Null
          $notify.Visible = $false
          [System.Windows.Forms.Application]::Exit()
        }
      }
    })
    $menu.Items.Add($item) | Out-Null
  }
})

$notify.ContextMenuStrip = $menu

# Left click opens the console, which is what a tray icon of a web console is
# expected to do; the menu stays on right click.
$notify.add_MouseClick({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
    Start-Process $config.url | Out-Null
  }
})

# Parent watch: when the server is gone the icon must be too. A message-loop
# timer is the only way to run code periodically while `Application.Run` blocks.
$watch = New-Object System.Windows.Forms.Timer
$watch.Interval = 2000
$watch.add_Tick({
  try {
    $server = Get-Process -Id $parentPid -ErrorAction Stop
    if ($server.HasExited) { $notify.Visible = $false; [System.Windows.Forms.Application]::Exit() }
  } catch {
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})
$watch.Start()

# A message loop is what keeps the icon on screen; without one the process exits
# and the tray disappears immediately.
[System.Windows.Forms.Application]::Run()

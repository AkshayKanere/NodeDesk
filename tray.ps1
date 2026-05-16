Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

$configFile = Join-Path $scriptDir "config.json"
$port = 8080
if (Test-Path $configFile) {
    try {
        $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
        if ($cfg.port) { $port = $cfg.port }
    } catch {}
}
if ($env:WEB_PORT) { $port = $env:WEB_PORT }

$logFile = Join-Path $scriptDir "web_out.txt"

$nodeProc = $null

function Start-Server {
    $script:nodeProc = Start-Process -FilePath "node" -ArgumentList "web-server.js" -WorkingDirectory $scriptDir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError (Join-Path $scriptDir "web_err.txt") -PassThru
}

function Stop-Server {
    if ($script:nodeProc -and !$script:nodeProc.HasExited) {
        Stop-Process -Id $script:nodeProc.Id -Force -ErrorAction SilentlyContinue
    }
}

Start-Server

$icon = [System.Drawing.SystemIcons]::Application
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "NodeDesk - Port $port"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openItem.Text = "Open in Browser"
$openItem.Add_Click({
    Start-Process "http://localhost:$port"
})

$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Text = "Running on port $port"
$statusItem.Enabled = $false

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "Restart Server"
$restartItem.Add_Click({
    Stop-Server
    Start-Sleep -Seconds 1
    Start-Server
    $notifyIcon.ShowBalloonTip(2000, "NodeDesk", "Server restarted on port $port", [System.Windows.Forms.ToolTipIcon]::Info)
})

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit"
$exitItem.Add_Click({
    Stop-Server
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$contextMenu.Items.Add($statusItem) | Out-Null
$contextMenu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null
$contextMenu.Items.Add($openItem) | Out-Null
$contextMenu.Items.Add($restartItem) | Out-Null
$contextMenu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null
$contextMenu.Items.Add($exitItem) | Out-Null

$notifyIcon.ContextMenuStrip = $contextMenu

$notifyIcon.Add_DoubleClick({
    Start-Process "http://localhost:$port"
})

$notifyIcon.ShowBalloonTip(3000, "NodeDesk", "Server running on port $port. Double-click to open.", [System.Windows.Forms.ToolTipIcon]::Info)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if ($script:nodeProc -and $script:nodeProc.HasExited) {
        Start-Server
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

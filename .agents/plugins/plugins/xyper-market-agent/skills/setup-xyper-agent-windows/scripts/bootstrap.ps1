param(
  [switch]$InstallDependencies,
  [switch]$InstallGit,
  [switch]$InstallNode,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "windows_required"
}

function Write-Status {
  param(
    [hashtable]$Payload,
    [int]$ExitCode = 0
  )
  Write-Output ($Payload | ConvertTo-Json -Compress -Depth 4)
  exit $ExitCode
}

function Stop-ExecutableBlocked {
  param([string]$Executable)
  Write-Status -ExitCode 5 -Payload @{
    status = "executable_launch_blocked"
    executable = $Executable
    nextAction = "Select Full access in the Codex permissions control, restart ChatGPT Desktop, open a new local Codex task, and retry. If execution is still blocked, configure [windows] sandbox = elevated and restart the app."
  }
}

function Test-ExecutableLaunch {
  $cmd = Join-Path $env:SystemRoot "System32\cmd.exe"
  try {
    & $cmd /d /c "exit 0"
    if ($LASTEXITCODE -ne 0) { Stop-ExecutableBlocked "cmd.exe" }
  } catch {
    Stop-ExecutableBlocked "cmd.exe"
  }
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Get-NodeMajor {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { return 0 }
  try {
    $version = (& node.exe --version).TrimStart("v")
  } catch {
    Stop-ExecutableBlocked "node.exe"
  }
  return [int]($version.Split(".")[0])
}

function Get-GitVersion {
  $command = Get-Command git.exe -ErrorAction SilentlyContinue
  if (-not $command) { return $null }
  try {
    return (& git.exe --version).Trim()
  } catch {
    Stop-ExecutableBlocked "git.exe"
  }
}

function Install-WithWinget {
  param(
    [string]$Id,
    [string]$Label
  )
  try {
    & winget.exe install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
  } catch {
    Stop-ExecutableBlocked "winget.exe"
  }
  if ($LASTEXITCODE -ne 0) {
    throw "dependency_install_failed:${Label}:${LASTEXITCODE}"
  }
}

Test-ExecutableLaunch

$gitVersion = Get-GitVersion
$nodeMajor = Get-NodeMajor
$missing = @()
if (-not $gitVersion) { $missing += "Git for Windows" }
if ($nodeMajor -lt 20) { $missing += "Node.js 20+" }

if ($missing.Count -gt 0) {
  $canInstallGit = $InstallDependencies -or $InstallGit
  $canInstallNode = $InstallDependencies -or $InstallNode
  $unapproved = @()
  if (-not $gitVersion -and -not $canInstallGit) { $unapproved += "Git for Windows" }
  if ($nodeMajor -lt 20 -and -not $canInstallNode) { $unapproved += "Node.js 20+" }
  if ($unapproved.Count -gt 0) {
    Write-Status -ExitCode 2 -Payload @{
      status = "dependencies_missing"
      missing = $missing
      nextAction = "After user approval, run bootstrap.ps1 -InstallDependencies."
    }
  }

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Status -ExitCode 3 -Payload @{
      status = "winget_missing"
      nextAction = "Install App Installer from Microsoft Store, or install Git for Windows and Node.js LTS manually outside ChatGPT, then restart ChatGPT Desktop."
    }
  }
  if (-not $gitVersion -and $canInstallGit) {
    Install-WithWinget -Id "Git.Git" -Label "git"
  }
  if ($nodeMajor -lt 20 -and $canInstallNode) {
    Install-WithWinget -Id "OpenJS.NodeJS.LTS" -Label "node"
  }
  Refresh-Path
  $gitVersion = Get-GitVersion
  $nodeMajor = Get-NodeMajor
  if (-not $gitVersion) { throw "git_not_available_after_install" }
  if ($nodeMajor -lt 20) { throw "node_20_not_available_after_install" }
}

$stateDir = Join-Path $env:LOCALAPPDATA "XyperMarketAgent"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
try {
  & icacls.exe $stateDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
} catch {
  Stop-ExecutableBlocked "icacls.exe"
}
if ($LASTEXITCODE -ne 0) { throw "state_acl_failed:${LASTEXITCODE}" }

Push-Location $PSScriptRoot
try {
  & npm.cmd install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw "npm_install_failed:${LASTEXITCODE}" }
  & node.exe .\xyper_agent.mjs doctor
  if ($LASTEXITCODE -ne 0) { throw "doctor_failed:${LASTEXITCODE}" }
  if ($DryRun) {
    & node.exe .\xyper_agent.mjs setup --dry-run
    if ($LASTEXITCODE -ne 0) { throw "dry_run_failed:${LASTEXITCODE}" }
  }
} finally {
  Pop-Location
}

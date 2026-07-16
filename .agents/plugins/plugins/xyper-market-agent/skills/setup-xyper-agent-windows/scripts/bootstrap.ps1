param(
  [switch]$InstallNode,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "windows_required"
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Get-NodeMajor {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) { return 0 }
  $version = (& node.exe --version).TrimStart("v")
  return [int]($version.Split(".")[0])
}

$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 20) {
  if (-not $InstallNode) {
    Write-Output '{"status":"node_missing","required":"Node.js 20+","nextAction":"Run bootstrap.ps1 -InstallNode after user approval."}'
    exit 2
  }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw "winget_required_to_install_node" }
  & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "node_install_failed:${LASTEXITCODE}" }
  Refresh-Path
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt 20) { throw "node_20_not_available_after_install" }
}

$stateDir = Join-Path $env:LOCALAPPDATA "XyperMarketAgent"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
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

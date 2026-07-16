$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "windows_required"
}

$skillRoot = Split-Path $PSScriptRoot -Parent
$skillsDir = Join-Path $env:USERPROFILE ".agents\skills"
$destination = Join-Path $skillsDir "setup-xyper-agent-windows"

if (Test-Path $destination) {
  throw "skill_already_installed:$destination"
}

New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
Copy-Item -Path $skillRoot -Destination $destination -Recurse

[ordered]@{
  status = "installed"
  destination = $destination
  nextPrompt = "Use `$setup-xyper-agent-windows to set up my local Xyper Market agent on Windows."
} | ConvertTo-Json

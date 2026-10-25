param([string]$Executable, [string]$Site, [string]$Game, [string]$Output = "test-results/windows")
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$Executable = [IO.Path]::GetFullPath($Executable)
$Site = [IO.Path]::GetFullPath($Site)
$Game = [IO.Path]::GetFullPath($Game)
function Invoke-NativeCheck([string]$Name, [string[]]$Arguments) {
  $Report = Join-Path $Output "$Name.json"
  $ProcessArgs = $Arguments + @('--report', ('"' + $Report + '"'))
  $Process = Start-Process -FilePath $Executable -ArgumentList $ProcessArgs -PassThru
  if (-not $Process.WaitForExit(120000)) { Stop-Process -Id $Process.Id -Force; throw "Native test timed out: $Name" }
  if (Test-Path $Report) { Get-Content $Report }
  if ($Process.ExitCode -ne 0 -or -not (Test-Path $Report)) { throw "Native test failed: $Name (exit $($Process.ExitCode))" }
  if ((Get-Content $Report -Raw | ConvertFrom-Json).result -ne 'passed') { throw "Native report did not pass: $Name" }
}
Invoke-NativeCheck 'host-policy' @('--self-test')
$StudioProfile = Join-Path $Output 'studio-profile'
$GameProfile = Join-Path $Output 'game-profile'
Invoke-NativeCheck 'studio-first' @('--site', ('"' + $Site + '"'), '--smoke-test', '--user-data-dir', ('"' + $StudioProfile + '"'))
Invoke-NativeCheck 'studio-restart' @('--site', ('"' + $Site + '"'), '--smoke-test', '--verify-persistence', '--user-data-dir', ('"' + $StudioProfile + '"'))
Invoke-NativeCheck 'game-first' @('--game', ('"' + $Game + '"'), '--smoke-test', '--user-data-dir', ('"' + $GameProfile + '"'))
Invoke-NativeCheck 'game-restart' @('--game', ('"' + $Game + '"'), '--smoke-test', '--verify-persistence', '--user-data-dir', ('"' + $GameProfile + '"'))

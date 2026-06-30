param(
  [string]$Source = (Split-Path -Parent $PSScriptRoot),
  [string]$Target = "$env:USERPROFILE\blackhole-timer-native",
  [switch]$NoRun
)

$ErrorActionPreference = "Stop"

function Find-CMake {
  $fromPath = Get-Command cmake.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $installPaths = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.CMake.Project -property installationPath
    foreach ($installPath in $installPaths) {
      $candidate = Join-Path $installPath "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
      if (Test-Path -LiteralPath $candidate) {
        return $candidate
      }
    }
  }

  $fallbacks = @(
    "$env:ProgramFiles\CMake\bin\cmake.exe",
    "${env:ProgramFiles(x86)}\CMake\bin\cmake.exe"
  )
  foreach ($candidate in $fallbacks) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

if (!(Test-Path -LiteralPath $Source)) {
  throw "Source path does not exist: $Source"
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null

$robocopyArgs = @(
  $Source,
  $Target,
  "/MIR",
  "/XD", ".git", "node_modules", "build", "windows-native-d3d\build",
  "/XF", ".DS_Store",
  "/NFL", "/NDL", "/NJH", "/NJS", "/NP"
)

& robocopy @robocopyArgs
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) {
  throw "robocopy failed with exit code $copyCode"
}

$cmake = Find-CMake
if (!$cmake) {
  throw "Windows cmake.exe was not found. Install Visual Studio 2022 Build Tools with the Desktop development with C++ workload."
}

& $cmake -S "$Target\windows-native-d3d" -B "$Target\windows-native-d3d\build" -G "Visual Studio 17 2022" -A x64
& $cmake --build "$Target\windows-native-d3d\build" --config Release

$exe = "$Target\windows-native-d3d\build\Release\BlackHoleRestNativeD3D.exe"
if (!(Test-Path -LiteralPath $exe)) {
  throw "Build finished but executable was not found: $exe"
}

if (!$NoRun) {
  & $exe
}

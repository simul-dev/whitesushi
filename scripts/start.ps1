param(
    [ValidateSet('dev', 'test', 'build', 'test:e2e', 'preview')]
    [string]$Task = 'dev',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TaskArguments = @()
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousNodePath = $env:Path
$taskExitCode = 0
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        $runtimeRoot = Join-Path $env:USERPROFILE '.local\node'
        $runtime = Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object {
                (Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe')) -and
                (Test-Path -LiteralPath (Join-Path $_.FullName 'npm.cmd'))
            } |
            Sort-Object Name -Descending | Select-Object -First 1
        if (-not $runtime) { throw 'Install Node.js 22.12 or later, then reopen PowerShell.' }
        $env:Path = $runtime.FullName + ';' + $env:Path
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        & npm.cmd ci
        $taskExitCode = $LASTEXITCODE
    }
    if ($taskExitCode -eq 0) {
        & npm.cmd run $Task -- @TaskArguments
        $taskExitCode = $LASTEXITCODE
    }
}
finally {
    $env:Path = $previousNodePath
    Pop-Location
}
exit $taskExitCode

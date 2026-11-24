param([string]$CodecDir)
$ErrorActionPreference = 'Stop'
$arguments = @("$PSScriptRoot/prepare.py")
if ($CodecDir) { $arguments += @('--codec-dir', $CodecDir) }
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 @arguments
} else {
    & python @arguments
}
exit $LASTEXITCODE

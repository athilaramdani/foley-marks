param(
  [Parameter(Mandatory)][string]$Installer,
  [string]$StagingBaseline,
  [switch]$PackageOnly
)
$ErrorActionPreference='Stop'
$Installer=(Resolve-Path $Installer).Path
if($StagingBaseline){$StagingBaseline=(Resolve-Path $StagingBaseline).Path}
if($StagingBaseline -and $PackageOnly){throw 'The staging updater test requires a desktop session.'}
$testDir=Join-Path ([IO.Path]::GetTempPath()) ('FoleyMarksQA-'+[guid]::NewGuid())
$installDir=Join-Path $testDir 'Installed App'
$mediaPath=Join-Path $testDir 'Données 媒体'
New-Item -ItemType Directory -Path $mediaPath | Out-Null
'FoleyMarks QA preservation marker' | Set-Content (Join-Path $mediaPath 'preserve.txt')
$registryPaths=@('HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/FoleyMarks','HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall/FoleyMarks')
foreach($reg in $registryPaths){if(Test-Path $reg){throw 'Existing FoleyMarks install found. Run installer lifecycle QA in a clean user profile.'}}
# NSIS requires /D as the final unquoted argument, including when it contains spaces.
$setup=Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDir" -Wait -PassThru -WindowStyle Hidden
if($setup.ExitCode -ne 0){throw "Setup exit $($setup.ExitCode)"}
$exe=(Get-ChildItem $installDir -Filter '*.exe' | Where-Object BaseName -eq 'foleymarks' | Select-Object -First 1).FullName
try {
  if(!$exe){throw 'Installed editor missing'}
  foreach($component in @('ffmpeg.exe','ffprobe.exe','media-runtime/python.exe','media-runtime/worker.py')){
    if(!(Test-Path -LiteralPath (Join-Path $installDir $component))){throw "Installed runtime missing $component"}
  }
  $programs=[Environment]::GetFolderPath('Programs')
  if(!(Test-Path -LiteralPath (Join-Path $programs 'FoleyMarks/FoleyMarks.lnk'))){throw 'Start Menu shortcut missing'}
  if($PackageOnly){
    foreach($tool in @('ffmpeg.exe','ffprobe.exe')){
      & (Join-Path $installDir $tool) -version | Out-Null
      if($LASTEXITCODE){throw "Installed runtime failed to start $tool"}
    }
    & (Join-Path $installDir 'media-runtime/python.exe') -I -B -c 'import cv2, numpy, PIL'
    if($LASTEXITCODE){throw 'Installed Python media dependencies failed to import'}
  } else {
    $env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $testDir 'webview'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-address=127.0.0.1 --remote-debugging-port=19471'
    if($StagingBaseline){Copy-Item -LiteralPath $StagingBaseline -Destination $exe -Force}
    $null=Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    if($StagingBaseline){node scripts/staging-update.mjs $Installer}
    else{node scripts/desktop-smoke.mjs}
    if($LASTEXITCODE){throw 'Installed desktop smoke failed'}
  }
} finally {
  if($exe){
    Get-Process -Name 'foleymarks' -ErrorAction SilentlyContinue | Where-Object Path -eq $exe | ForEach-Object {
      $null=$_.CloseMainWindow()
      if(!$_.WaitForExit(10000)){Stop-Process -Id $_.Id -Force}
    }
  }
  $uninstaller=Join-Path $installDir 'uninstall.exe'
  if(Test-Path $uninstaller){$u=Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait; if($u.ExitCode){throw "Uninstall exit $($u.ExitCode)"}}
}
if($exe -and (Test-Path -LiteralPath $exe)){throw 'Uninstall left the application executable'}
foreach($reg in $registryPaths){if(Test-Path $reg){throw 'Uninstall left its registry entry'}}
if((Get-Content (Join-Path $mediaPath 'preserve.txt')) -ne 'FoleyMarks QA preservation marker'){throw 'External data preservation failed'}
if($PackageOnly){Write-Host 'Verified install, bundled media runtimes, uninstall and preservation of external sentinel.'}
else{Write-Host 'Verified install, WebView startup, native IPC, uninstall and preservation of external sentinel.'}

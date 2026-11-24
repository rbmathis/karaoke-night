# Back up the NAS database, stage tracked build inputs as a release, walk through the manual
# Container Manager steps, then optionally remove NAS files that Docker no longer needs.
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$destRoot = if ($env:KARAOKE_NAS_ROOT) { $env:KARAOKE_NAS_ROOT } else { 'Z:\karaoke-night' }
$nasDataPath = '/volume1/docker/karaoke-night/data'
$serviceName = 'karaoke-night'
$verifier = Join-Path $sourceRoot 'deploy\synology\verify-deployment-backup.mjs'
# The only top-level NAS entries the container project needs; everything else is legacy.
$keepEntries = @('docker-compose.yml', '.env.local', 'data', 'backups', 'deployment-releases')

function Get-Sha256($filePath) {
  return (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
}

function Get-InputHash($inputFiles) {
  $lines = foreach ($file in ($inputFiles | Sort-Object -CaseSensitive)) {
    "$file $(Get-Sha256 (Join-Path $sourceRoot $file))"
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Test-ReleaseFiles($releaseDir, $inputFiles) {
  if (-not (Test-Path -LiteralPath $releaseDir -PathType Container)) { return $false }
  $expected = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($file in @($inputFiles) + @('docker-compose.yml', 'previous-compose.yml')) {
    [void]$expected.Add($file.Replace('/', '\'))
  }
  foreach ($file in $inputFiles) {
    $staged = Join-Path $releaseDir $file
    if (-not (Test-Path -LiteralPath $staged -PathType Leaf) -or
        (Get-Sha256 $staged) -ne (Get-Sha256 (Join-Path $sourceRoot $file))) {
      return $false
    }
  }
  foreach ($item in Get-ChildItem -LiteralPath $releaseDir -File -Recurse -Force) {
    $relative = $item.FullName.Substring($releaseDir.TrimEnd('\').Length + 1)
    if (-not $expected.Contains($relative)) { return $false }
  }
  return $true
}

function Write-DeploymentState($state, $statePath) {
  $tempPath = "$statePath.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    $state | ConvertTo-Json | Set-Content -LiteralPath $tempPath -Encoding UTF8
    Move-Item -LiteralPath $tempPath -Destination $statePath -Force
  } finally {
    if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force }
  }
}

function Read-ContinueChoice($prompt) {
  while ($true) {
    $choice = Read-Host "$prompt [C] Continue / [Q] Quit"
    if ([string]::IsNullOrWhiteSpace($choice)) {
      Write-Host 'No choice entered; quitting.'
      return $false
    }
    switch ($choice.Trim().ToUpperInvariant()) {
      'C' { return $true }
      'Q' { return $false }
      default { Write-Host 'Please enter C or Q.' }
    }
  }
}

function Invoke-LegacyCleanup($releasesRoot, $currentReleaseId) {
  # Synology metadata (#recycle, @eaDir) is managed by DSM and left alone.
  $legacy = @(Get-ChildItem -LiteralPath $destRoot -Force |
    Where-Object { $keepEntries -notcontains $_.Name -and $_.Name -notmatch '^[#@]' })
  $previousCompose = Join-Path (Join-Path $releasesRoot $currentReleaseId) 'previous-compose.yml'
  if (-not (Test-Path -LiteralPath $previousCompose -PathType Leaf)) {
    throw "Confirmed release is incomplete: $previousCompose"
  }
  # Keep the confirmed release and the release its previous compose file built from, as a rollback target.
  $rollbackId = $null
  $rollbackMatch = [regex]::Match((Get-Content -LiteralPath $previousCompose -Raw), 'deployment-releases/(\d{8}-\d{6}-[a-f0-9]{32})')
  if ($rollbackMatch.Success) { $rollbackId = $rollbackMatch.Groups[1].Value }
  $staleReleases = @(Get-ChildItem -LiteralPath $releasesRoot -Directory -Force |
    Where-Object { $_.Name -ne $currentReleaseId -and $_.Name -ne $rollbackId })
  $staleTemp = @(Get-ChildItem -LiteralPath $releasesRoot -File -Force -Filter 'state.json.*.tmp')
  $targets = @($legacy) + @($staleReleases) + @($staleTemp)
  if ($targets.Count -eq 0) {
    Write-Host 'No unneeded NAS files found.'
    return
  }

  Write-Host ''
  Write-Host "Docker only needs these entries in ${destRoot}: $($keepEntries -join ', ')"
  Write-Host 'The following are not used by the confirmed release and can be removed:'
  foreach ($item in $targets) {
    $relative = $item.FullName.Substring($destRoot.Length + 1)
    if ($item.PSIsContainer) {
      $files = @(Get-ChildItem -LiteralPath $item.FullName -File -Recurse -Force)
      $size = ($files | Measure-Object Length -Sum).Sum
      Write-Host ('  {0}\  ({1} files, {2:N1} KB)' -f $relative, $files.Count, ($size / 1KB))
    } else {
      Write-Host ('  {0}  ({1:N1} KB)' -f $relative, ($item.Length / 1KB))
    }
  }
  $strayEnv = @($legacy | ForEach-Object {
      if ($_.PSIsContainer) { Get-ChildItem -LiteralPath $_.FullName -File -Recurse -Force -Filter '.env*' } else { $_ }
    } | Where-Object { $_.Name -like '.env*' -and $_.Name -ne '.env.example' })
  foreach ($envFile in $strayEnv) {
    $active = Join-Path $destRoot '.env.local'
    if ((Get-Sha256 $envFile.FullName) -ne (Get-Sha256 $active)) {
      Write-Warning "$($envFile.FullName) differs from the active .env.local. Copy any secret you still need before removing it."
    }
  }
  if (-not $rollbackId -and $legacy.Count -gt 0) {
    Write-Host 'Note: the previous compose file built from the NAS root. After cleanup it cannot be rebuilt;'
    Write-Host '      roll back by re-running the previous image in Container Manager or redeploying an older commit.'
  }
  if (-not (Read-ContinueChoice 'Remove these files from the NAS')) {
    Write-Host 'Cleanup skipped; no files were removed. Re-run this script later to clean up.'
    return
  }
  foreach ($item in $targets) {
    Remove-Item -LiteralPath $item.FullName -Recurse -Force
  }
  Write-Host "Removed $($targets.Count) unneeded entries. Images, data, backups, the current release, and its rollback release were kept."
}

try {
  if (-not (Test-Path -LiteralPath $destRoot -PathType Container)) {
    throw "Project folder not found: $destRoot"
  }
  $destRoot = (Resolve-Path -LiteralPath $destRoot).Path.TrimEnd('\')
  $dataRoot = Join-Path $destRoot 'data'
  $backupRoot = Join-Path $destRoot 'backups'
  $database = Join-Path $dataRoot 'karaoke.db'
  $currentCompose = Join-Path $destRoot 'docker-compose.yml'
  if (-not (Test-Path -LiteralPath $currentCompose -PathType Leaf)) {
    throw "Compose file not found in project folder: $destRoot"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $destRoot '.env.local') -PathType Leaf)) {
    throw "NAS .env.local not found in $destRoot. The compose file requires it for YOUTUBE_API_KEY and ADMIN_PASSWORD."
  }
  if (-not (Test-Path -LiteralPath $database -PathType Leaf)) {
    throw "Database not found: $database. Refusing to deploy."
  }

  $git = @('-C', $sourceRoot)
  $pathspecs = @(
    'src', 'public', 'Dockerfile', '.dockerignore', 'package.json', 'package-lock.json',
    'next.config.ts', 'tsconfig.json', 'postcss.config.mjs'
  )
  $rawFiles = git @git ls-files -z -- @pathspecs
  if ($LASTEXITCODE -ne 0) { throw 'Could not list tracked deployment files.' }
  $files = @($rawFiles -split "`0" | Where-Object { $_ })
  if ($files.Count -eq 0) { throw 'No tracked deployment files found.' }
  $rawUntracked = git @git ls-files --others --exclude-standard -z -- @pathspecs
  if ($LASTEXITCODE -ne 0) { throw 'Could not check for untracked application files.' }
  $untracked = @($rawUntracked -split "`0" | Where-Object { $_ })
  if ($untracked.Count -gt 0) {
    throw "Untracked application files must be added to Git before deployment: $($untracked -join ', ')"
  }
  foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $file) -PathType Leaf)) {
      throw "Tracked deployment file is missing locally: $file"
    }
  }
  if (-not ($files -contains 'Dockerfile' -and $files -contains 'package-lock.json')) {
    throw 'Dockerfile and package-lock.json must be tracked in Git.'
  }

  $appHash = Get-InputHash $files
  $composeSource = Join-Path $sourceRoot 'docker-compose.yml'
  $composeHash = Get-Sha256 $composeSource
  $releasesRoot = Join-Path $destRoot 'deployment-releases'
  $statePath = Join-Path $releasesRoot 'state.json'
  $state = $null
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.releaseId -notmatch '^\d{8}-\d{6}-[a-f0-9]{32}$') {
      throw "Invalid deployment state: $statePath"
    }
  }

  if ($state -and $state.status -eq 'confirmed' -and
      $state.appHash -eq $appHash -and
      $state.composeSourceHash -eq $composeHash -and
      $state.composeDeployedHash -eq (Get-Sha256 $currentCompose)) {
    if (Test-ReleaseFiles (Join-Path $releasesRoot $state.releaseId) $files) {
      Write-Host 'Inputs match the last operator-confirmed release. No files copied or backup taken.'
      Write-Host 'The script cannot inspect running containers. Check the image tag in Container Manager if unsure.'
      Invoke-LegacyCleanup $releasesRoot $state.releaseId
      exit 0
    }
    Write-Warning 'The staged release no longer matches its inputs; a fresh release is required.'
  }
  if ($state -and $state.status -ne 'confirmed') {
    Write-Warning 'The previous deployment was not confirmed. Staging files alone does not mean the image was built or started.'
  }

  $shortHash = $appHash.Substring(0, 12)
  $imageTag = "${serviceName}:sha256-$shortHash"
  Write-Host "Image: $imageTag"
  Write-Host "Tracked build inputs to stage: $($files.Count)"
  Write-Host 'Nothing is deleted until the release is confirmed; cleanup then asks separately.'
  Write-Host ''
  Write-Host 'Before continuing:'
  Write-Host "  1. In Container Manager, verify the running $serviceName container mounts $nasDataPath at /data."
  Write-Host '     If it points elsewhere, quit and locate the actual database.'
  Write-Host '  2. Note a few rooms, favorites, and history entries in the app (or /en/admin) to compare afterwards.'
  Write-Host "  3. Stop the $serviceName project in Container Manager."
  Write-Host '  4. Ensure nothing else is using the database, and keep the project stopped during backup and staging.'
  Write-Host '  5. The NAS docker-compose.yml will be replaced with this repository version, with the release path and image tag.'
  Write-Host '     The NAS .env.local is kept as-is. Preserve any other custom compose settings separately.'
  if (-not (Read-ContinueChoice 'Confirm the project is stopped')) {
    Write-Host 'Deployment cancelled. No database or application files were copied.'
    exit 2
  }

  $names = @('karaoke.db', 'karaoke.db-wal', 'karaoke.db-shm', 'karaoke.db-journal')
  $present = @($names | Where-Object { Test-Path -LiteralPath (Join-Path $dataRoot $_) -PathType Leaf })
  if ($present -notcontains 'karaoke.db' -or (Get-Item -LiteralPath $database).Length -eq 0) {
    throw 'The source database is missing or empty.'
  }

  [void][System.IO.Directory]::CreateDirectory($backupRoot)
  $backupName = 'pre-deploy-{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N')
  $backupDir = Join-Path $backupRoot $backupName
  [void][System.IO.Directory]::CreateDirectory($backupDir)
  Write-Host "Backing up database files to $backupDir"
  foreach ($name in $present) {
    $src = Join-Path $dataRoot $name
    $dst = Join-Path $backupDir $name
    $before = Get-Sha256 $src
    Copy-Item -LiteralPath $src -Destination $dst
    if ((Get-Sha256 $dst) -ne $before -or (Get-Sha256 $src) -ne $before) {
      throw "Database file changed during backup or copy verification failed: $name"
    }
  }
  $after = @($names | Where-Object { Test-Path -LiteralPath (Join-Path $dataRoot $_) -PathType Leaf })
  if (Compare-Object $present $after) {
    throw 'Database files changed during backup. Ensure the project is stopped.'
  }

  & node $verifier $backupDir
  if ($LASTEXITCODE -ne 0) { throw "Backup verification failed: $backupDir" }

  $releaseId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), [guid]::NewGuid().ToString('N')
  $releaseDir = Join-Path $releasesRoot $releaseId
  [void][System.IO.Directory]::CreateDirectory($releaseDir)
  foreach ($file in $files) {
    $dst = Join-Path $releaseDir $file
    [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $dst))
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination $dst
  }

  $compose = Get-Content -LiteralPath $composeSource -Raw
  $contextPattern = '(?m)^([ \t]*)context: \.[ \t]*\r?$'
  if ([regex]::Matches($compose, $contextPattern).Count -ne 1) {
    throw 'Expected exactly one "context: ." build context in docker-compose.yml.'
  }
  $compose = [regex]::Replace($compose, $contextPattern, "`${1}context: ./deployment-releases/$releaseId")
  $servicePattern = "(?m)^  ${serviceName}:[ \t]*\r?$"
  if ([regex]::Matches($compose, $servicePattern).Count -ne 1) {
    throw "Expected exactly one $serviceName service in docker-compose.yml."
  }
  $compose = [regex]::Replace($compose, $servicePattern, "  ${serviceName}:`n    image: $imageTag")
  if ($compose -notmatch [regex]::Escape("${nasDataPath}:/data")) {
    throw "docker-compose.yml no longer mounts $nasDataPath at /data."
  }

  $stagedCompose = Join-Path $releaseDir 'docker-compose.yml'
  [System.IO.File]::WriteAllText($stagedCompose, $compose, (New-Object System.Text.UTF8Encoding $false))
  $previousCompose = Join-Path $releaseDir 'previous-compose.yml'
  $previousComposeHash = Get-Sha256 $currentCompose
  Copy-Item -LiteralPath $currentCompose -Destination $previousCompose
  if ((Get-Sha256 $previousCompose) -ne $previousComposeHash -or
      (Get-Sha256 $currentCompose) -ne $previousComposeHash) {
    throw 'The existing compose file changed or its backup failed verification.'
  }
  if ((Get-InputHash $files) -ne $appHash -or
      (Get-Sha256 $composeSource) -ne $composeHash -or
      -not (Test-ReleaseFiles $releaseDir $files)) {
    throw 'Build inputs changed during staging or failed verification. The live compose file was not changed.'
  }

  $state = [pscustomobject]@{
    status = 'pending'
    releaseId = $releaseId
    appHash = $appHash
    imageTag = $imageTag
    composeSourceHash = $composeHash
    composeDeployedHash = Get-Sha256 $stagedCompose
  }
  Write-DeploymentState $state $statePath
  Copy-Item -LiteralPath $stagedCompose -Destination $currentCompose -Force
  if ((Get-Sha256 $currentCompose) -ne $state.composeDeployedHash) {
    throw 'Copied compose file failed verification.'
  }
  Write-Host "Backup verified: $backupDir"
  Write-Host "Staged release: $releaseDir"
  Write-Host "Previous compose file saved: $previousCompose"
  Write-Host ''
  Write-Host 'Release staged, not yet deployed. Finish manually:'
  Write-Host '  1. In Container Manager, update the project from the NAS docker-compose.yml and review the settings.'
  Write-Host "  2. Confirm the data mount still maps $nasDataPath to /data."
  Write-Host '  3. Build with cache enabled, then recreate and start the project. Do not clean images, data, backups, or volumes.'
  Write-Host "  4. Verify the running container uses the newly built image $imageTag"
  Write-Host '     (compare the container image ID with the new image ID in Container Manager).'
  Write-Host '  5. Wait for the container to report healthy, then check http://<nas-ip>:3000/api/health and the container logs.'
  Write-Host '  6. Open the app through the HTTPS reverse proxy and compare rooms, favorites, and history with the values noted earlier.'
  Write-Host '     If they differ, stop and investigate before using the app.'
  if (-not (Read-ContinueChoice 'Confirm the image tag, health, and data checks are complete')) {
    Write-Host 'Release remains pending; the manual deployment and checks were not confirmed.'
    exit 2
  }
  if ((Get-Sha256 $currentCompose) -ne $state.composeDeployedHash -or
      (Get-InputHash $files) -ne $appHash -or
      -not (Test-ReleaseFiles $releaseDir $files)) {
    throw 'The compose file or staged inputs changed before confirmation. Release remains pending.'
  }
  $state.status = 'confirmed'
  Write-DeploymentState $state $statePath
  Write-Host 'Manual deployment and checks confirmed by the operator.'
  Invoke-LegacyCleanup $releasesRoot $releaseId
} catch {
  Write-Error "Deployment stopped: $($_.Exception.Message)" -ErrorAction Continue
  exit 1
}

# Asserts, with Windows' own verifier, that every executable listed in a
# verify-windows-signatures.mjs / rewrap-windows.mjs report carries an
# Authenticode signature: the installers and every executable inside them.
#
# `-ne 'NotSigned'` (not `-eq 'Valid'`) deliberately: 'Valid' also requires
# full chain validation on this runner, and a timestamping or intermediate-cert
# hiccup can return 'UnknownError' on a binary that is genuinely signed, which
# would block a legitimate release. 'NotSigned' is the unambiguous signal for
# the failure this guards against. The real status is logged either way so a
# degraded-but-signed case stays visible.
#
# -Rehearsal accepts the throwaway rehearsal certificate. Without it, a file
# signed by that certificate is rejected: rehearsal output must never ship.
param(
  [Parameter(Mandatory = $true)][string]$Report,
  [switch]$Rehearsal
)

$ErrorActionPreference = 'Stop'
# Two installers; each contains the app executable and the elevate helper, and
# the NSIS installer also contains the uninstaller.
$minimumExecutables = 7

$rows = @((Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json).executables)
if ($rows.Count -lt $minimumExecutables) {
  throw "report lists $($rows.Count) executable(s); expected at least $minimumExecutables - refusing to treat that as verified"
}

$failures = @()
foreach ($row in $rows) {
  $label = "$($row.artifact) :: $($row.path)"
  $signature = Get-AuthenticodeSignature -LiteralPath $row.absolute
  $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '<none>' }
  Write-Host "$label - $($signature.Status) - $subject"
  if ($signature.Status -eq 'NotSigned') {
    $failures += "$label has no Authenticode signature"
  } elseif (-not $Rehearsal -and $subject -match 'signing rehearsal') {
    $failures += "$label is signed by the rehearsal certificate"
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Host "::error::$_" }
  throw "refusing to ship: $($failures.Count) executable(s) failed the Authenticode check"
}
Write-Host "Authenticode signature present on all $($rows.Count) executables"

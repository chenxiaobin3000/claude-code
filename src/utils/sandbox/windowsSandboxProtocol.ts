import { isAbsolute, normalize, parse, resolve } from 'path'

/**
 * Wire format shared by the host and the PowerShell runner inside Windows
 * Sandbox.  Arguments stay an argv array; neither side is allowed to turn
 * them into a command-line string.
 */
export type WindowsSandboxRequest = {
  id: string
  executable: string
  arguments: string[]
  cwd: string
  environment: Record<string, string>
}

export type WindowsSandboxResult = {
  id: string
  code: number
  stdout: string
  stderr: string
  cwd: string
}

export type WindowsSandboxMapping = {
  hostFolder: string
  sandboxFolder: string
  readOnly: boolean
}

const WINDOWS_ROOT = /^[a-z]:\\?$/i

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Reject roots and reparse-sensitive broad mappings before a .wsb is made. */
export function validateWindowsSandboxMapping(mapping: WindowsSandboxMapping): void {
  const hostFolder = normalize(mapping.hostFolder)
  if (
    !isAbsolute(hostFolder) ||
    WINDOWS_ROOT.test(hostFolder) ||
    hostFolder.startsWith('\\\\')
  ) {
    throw new Error(`Windows Sandbox mapping must be a non-root absolute path: ${mapping.hostFolder}`)
  }
  if (!/^C:\\claude(?:\\|$)/i.test(mapping.sandboxFolder)) {
    throw new Error(`Windows Sandbox target must stay below C:\\claude: ${mapping.sandboxFolder}`)
  }
  const parsed = parse(hostFolder)
  if (hostFolder === parsed.root) {
    throw new Error(`Windows Sandbox mapping cannot expose a volume root: ${mapping.hostFolder}`)
  }
}

/**
 * Produces the minimal fixed-policy .wsb file.  Networking, clipboard, vGPU,
 * audio/video input and printers are intentionally never inherited defaults.
 */
export function buildWindowsSandboxConfiguration(
  mappings: WindowsSandboxMapping[],
  logonCommand: string,
): string {
  for (const mapping of mappings) validateWindowsSandboxMapping(mapping)
  if (!logonCommand || /[\r\n]/.test(logonCommand)) {
    throw new Error('Windows Sandbox logon command must be a single non-empty command')
  }
  const mappedFolders = mappings
    .map(
      mapping =>
        `<MappedFolder><HostFolder>${xmlEscape(resolve(mapping.hostFolder))}</HostFolder>` +
        `<SandboxFolder>${xmlEscape(mapping.sandboxFolder)}</SandboxFolder>` +
        `<ReadOnly>${mapping.readOnly ? 'true' : 'false'}</ReadOnly></MappedFolder>`,
    )
    .join('')
  return `<Configuration><VGpu>Disable</VGpu><Networking>Disable</Networking>` +
    // These three settings are supported by the Windows 10 Sandbox build used
    // by this project. Device-redirection tags are intentionally omitted here:
    // unsupported .wsb elements make older Windows Sandbox builds reject the
    // entire configuration before the guest runner can report readiness.
    `<ClipboardRedirection>Disable</ClipboardRedirection>` +
    `<MappedFolders>${mappedFolders}</MappedFolders><LogonCommand><Command>` +
    `${xmlEscape(logonCommand)}</Command></LogonCommand></Configuration>`
}

/**
 * The guest only accepts JSON requests and invokes an executable with argv.
 * Output is emitted as JSON in the mapped control folder for the host to poll.
 */
export const WINDOWS_SANDBOX_GUEST_RUNNER = String.raw`
$ErrorActionPreference = 'Continue'
$control = 'C:\claude\control'
$alive = Join-Path $control 'alive'
Set-Content -LiteralPath (Join-Path $control 'ready') -Value 'ready' -NoNewline -Encoding utf8
while (Test-Path -LiteralPath $alive) {
  Get-ChildItem -LiteralPath $control -Filter 'request-*.json' -File -ErrorAction SilentlyContinue |
    ForEach-Object {
      $requestPath = $_.FullName
      $processingPath = "$requestPath.processing"
      try {
        Move-Item -LiteralPath $requestPath -Destination $processingPath -ErrorAction Stop
        $request = Get-Content -LiteralPath $processingPath -Raw | ConvertFrom-Json
        $stdoutPath = Join-Path $control ("stdout-" + $request.id + '.txt')
        $stderrPath = Join-Path $control ("stderr-" + $request.id + '.txt')
        $old = Get-Location
        try {
          Set-Location -LiteralPath $request.cwd
          foreach ($entry in $request.environment.PSObject.Properties) { Set-Item -Path ("Env:" + $entry.Name) -Value ([string]$entry.Value) }
          & $request.executable @($request.arguments) 1> $stdoutPath 2> $stderrPath
          $code = if ($null -eq $LASTEXITCODE) { if ($?) { 0 } else { 1 } } else { $LASTEXITCODE }
        } finally { Set-Location -LiteralPath $old }
        @{ id = $request.id; code = $code; cwd = (Get-Location).Path } |
          ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $control ("result-" + $request.id + '.json')) -NoNewline -Encoding utf8
      } catch {
        @{ id = 'unknown'; code = 1; cwd = ''; error = $_.Exception.Message } |
          ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $control ('result-protocol-error.json')) -NoNewline -Encoding utf8
      } finally {
        Remove-Item -LiteralPath $processingPath -Force -ErrorAction SilentlyContinue
      }
    }
  Start-Sleep -Milliseconds 100
}
shutdown.exe /s /t 0
`

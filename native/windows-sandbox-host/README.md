# Windows Sandbox Host

This native helper is the future Windows backend for the existing Claude Code
Sandbox contract. It is **not** a kernel driver and does not introduce a new
settings format.

## Current scope

The current milestone provides a read-only `--probe` command and a strict,
network-denied `--launch` command. `--launch` creates a temporary AppContainer,
adds access only to declared directory trees, starts the child in a Job Object,
removes its temporary ACEs, and removes the AppContainer profile on exit. It reports
whether the operating system exposes the Windows primitives required by the
planned backend:

- AppContainer APIs from `userenv.dll`;
- Job Object process-tree cleanup APIs;
- optional experimental Sandbox Engine APIs from `processmodel.dll`.

The helper never grants an Internet capability, so its current network policy is
**deny all**. It intentionally does not claim to support domain allowlists yet.
The TypeScript runtime must keep treating native Windows Sandbox as unavailable
until it has wired this verified launcher into `SandboxManager`.

## Current Windows limitation

An AppContainer always runs at Low integrity. Windows Mandatory Integrity
Control therefore prevents it from writing to a normal Medium-integrity project
directory, even when its DACL grants the temporary AppContainer SID write
access. This has been verified on the target Windows 10 host. Do **not** lower
or persistently modify a project directory's integrity label merely to bypass
this protection: a normal CLI cannot reliably restore that label after a crash.

Consequently this host currently proves process, read and network isolation but
is not eligible for TypeScript integration. Writable workspaces need one of:

- Microsoft's Bound File System/Sandbox Engine on a supported Windows build;
- a Windows Sandbox VM backend; or
- a separately designed, audited file-write broker.

Each allowed directory is enumerated without following reparse points, and the
temporary AppContainer SID receives an explicit ACE on its existing files and
directories. This is necessary because inherited ACLs do not retroactively
cover files that already exist. No volume root, home directory root, junction,
or symlink is accepted as a grant. This is the chosen strict Windows behavior:
only the workspace, required runtime directories, and explicitly configured
paths may be granted; it does not emulate macOS/Linux's broad default read of
the whole computer.

## Build

Install Visual Studio Build Tools with the Desktop development with C++ workload
and CMake, then run from this directory:

```powershell
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
.\build\Release\windows-sandbox-host.exe --probe
```

The probe writes a single JSON object to stdout and uses a non-zero exit code
only for invalid command-line arguments or an unsupported operating system.

Before enabling the backend, run `windows-sandbox-host --check-app-container`.
It creates and immediately deletes an empty AppContainer profile; it does not
launch a child process or modify any filesystem ACL. A non-zero result means
the current user or its Windows policy cannot use this backend.

## Launch protocol

```powershell
.\build\Release\windows-sandbox-host.exe --launch `
  --exe C:\\Windows\\System32\\cmd.exe --cwd C:\\work\\project `
  --read C:\\work\\runtime --write C:\\work\\project -- /d /c whoami
```

The executable and child arguments are separate fields: the helper never
accepts a shell-concatenated policy string. The TypeScript side will resolve the
existing Sandbox settings before invoking this host. Domain allowlists require
an external proxy plus OS-level direct-egress blocking and are deliberately not
implemented by this first launcher.

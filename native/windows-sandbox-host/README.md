# Windows Sandbox Host

This native helper is the future Windows backend for the existing Claude Code
Sandbox contract. It is **not** a kernel driver and does not introduce a new
settings format.

## Current scope

The initial milestone provides a read-only `--probe` command. It reports
whether the operating system exposes the Windows primitives required by the
planned backend:

- AppContainer APIs from `userenv.dll`;
- Job Object process-tree cleanup APIs;
- optional experimental Sandbox Engine APIs from `processmodel.dll`.

No command execution, ACL modification, AppContainer profile creation, network
proxying, or sandbox claim is implemented yet. The TypeScript runtime must keep
treating native Windows Sandbox as unavailable until a later milestone wires a
verified launcher into `SandboxManager`.

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

## Planned protocol

The eventual `--launch` protocol will accept a structured request over stdin
and return structured lifecycle events over stdout. It must never accept a
shell-concatenated policy string. The TypeScript side remains responsible for
resolving the existing Sandbox settings; this host will enforce the resolved
filesystem, process, and proxy boundaries at the Windows OS layer.


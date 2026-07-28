#include "platform_probe.hpp"

#include <windows.h>
#include <winternl.h>

namespace windows_sandbox_host {
namespace {

bool HasExport(const wchar_t* module_name, const char* export_name) {
  HMODULE module = LoadLibraryExW(module_name, nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (module == nullptr) {
    return false;
  }

  const bool found = GetProcAddress(module, export_name) != nullptr;
  FreeLibrary(module);
  return found;
}

bool IsWindows10OrLater() {
  // GetVersionEx/VerifyVersionInfoW can report a compatibility version when
  // the executable does not carry a current Windows compatibility manifest.
  // Query ntdll directly so the probe describes the host OS, not its manifest.
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  const auto rtl_get_version = reinterpret_cast<RtlGetVersionFn>(
      GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion"));
  if (rtl_get_version == nullptr) {
    return false;
  }

  RTL_OSVERSIONINFOW version{};
  version.dwOSVersionInfoSize = sizeof(version);
  return rtl_get_version(&version) == 0 && version.dwMajorVersion >= 10;
}

}  // namespace

PlatformCapabilities ProbePlatformCapabilities() {
  return {
      .is_windows_10_or_later = IsWindows10OrLater(),
      .app_container_apis =
          HasExport(L"userenv.dll", "CreateAppContainerProfile") &&
          HasExport(L"userenv.dll", "DeriveAppContainerSidFromAppContainerName"),
      .job_object_apis =
          GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "CreateJobObjectW") != nullptr &&
          GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "AssignProcessToJobObject") != nullptr,
      .sandbox_engine_apis =
          HasExport(L"processmodel.dll", "Experimental_CreateProcessInSandbox"),
  };
}

}  // namespace windows_sandbox_host

#include <windows.h>

#include <iostream>
#include <string_view>

#include "platform_probe.hpp"
#include "sandbox_launch.hpp"

namespace {

constexpr int kUsageError = 64;
constexpr int kUnsupportedPlatform = 69;

void PrintUsage() {
  std::cerr << "Usage: windows-sandbox-host --probe | --check-app-container | --launch ...\n";
}

void PrintProbeResult(const windows_sandbox_host::PlatformCapabilities& capabilities) {
  std::cout << "{\"platform\":\"windows\","
            << "\"windows10OrLater\":"
            << (capabilities.is_windows_10_or_later ? "true" : "false") << ','
            << "\"appContainerApis\":"
            << (capabilities.app_container_apis ? "true" : "false") << ','
            << "\"jobObjectApis\":"
            << (capabilities.job_object_apis ? "true" : "false") << ','
            << "\"experimentalSandboxEngineApis\":"
            << (capabilities.sandbox_engine_apis ? "true" : "false") << "}\n";
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc == 2 && std::wstring_view(argv[1]) == L"--check-app-container") {
    return windows_sandbox_host::CheckAppContainerReadiness();
  }
  if (argc >= 2 && std::wstring_view(argv[1]) == L"--launch") {
    std::vector<std::wstring> arguments;
    for (int index = 2; index < argc; ++index) arguments.emplace_back(argv[index]);
    return windows_sandbox_host::RunSandboxedProcess(arguments);
  }
  if (argc != 2 || std::wstring_view(argv[1]) != L"--probe") {
    PrintUsage();
    return kUsageError;
  }

  const auto capabilities = windows_sandbox_host::ProbePlatformCapabilities();
  PrintProbeResult(capabilities);
  return capabilities.is_windows_10_or_later ? 0 : kUnsupportedPlatform;
}

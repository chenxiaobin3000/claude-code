#pragma once

#include <string>
#include <vector>

namespace windows_sandbox_host {

// The launcher deliberately accepts an executable plus an argv vector.  It does
// not accept a command string or evaluate a shell expression.
int RunSandboxedProcess(const std::vector<std::wstring>& arguments);
int CheckAppContainerReadiness();

}  // namespace windows_sandbox_host

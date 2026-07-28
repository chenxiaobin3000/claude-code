#pragma once

namespace windows_sandbox_host {

struct PlatformCapabilities {
  bool is_windows_10_or_later;
  bool app_container_apis;
  bool job_object_apis;
  bool sandbox_engine_apis;
};

PlatformCapabilities ProbePlatformCapabilities();

}  // namespace windows_sandbox_host


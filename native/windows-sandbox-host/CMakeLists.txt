cmake_minimum_required(VERSION 3.24)

project(windows-sandbox-host VERSION 0.1.0 LANGUAGES CXX)

add_executable(windows-sandbox-host
  src/main.cpp
  src/platform_probe.cpp
  src/sandbox_launch.cpp
)

target_compile_features(windows-sandbox-host PRIVATE cxx_std_20)
target_compile_definitions(windows-sandbox-host PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(windows-sandbox-host PRIVATE advapi32 userenv)

if(MSVC)
  target_compile_options(windows-sandbox-host PRIVATE /W4 /WX /permissive- /EHsc)
else()
  message(FATAL_ERROR "windows-sandbox-host currently requires an MSVC-compatible Windows toolchain")
endif()

#include "sandbox_launch.hpp"

#include <Aclapi.h>
#include <userenv.h>
#include <windows.h>

#include <algorithm>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace windows_sandbox_host {
namespace {

constexpr int kUsageError = 64;
constexpr int kLaunchError = 70;

enum class GrantAccess { kRead, kWrite };

struct Grant {
  std::wstring path;
  GrantAccess access;
};

struct LaunchRequest {
  std::wstring executable;
  std::wstring cwd;
  std::vector<std::wstring> child_arguments;
  std::vector<Grant> grants;
};

struct ScopedHandle {
  HANDLE value = nullptr;
  ScopedHandle() = default;
  explicit ScopedHandle(HANDLE handle) : value(handle) {}
  ~ScopedHandle() {
    if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
  }
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  ScopedHandle(ScopedHandle&& other) noexcept : value(std::exchange(other.value, nullptr)) {}
  ScopedHandle& operator=(ScopedHandle&& other) noexcept {
    if (this != &other) {
      if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
      value = std::exchange(other.value, nullptr);
    }
    return *this;
  }
};

std::wstring LastErrorMessage(DWORD error = GetLastError()) {
  LPWSTR buffer = nullptr;
  const DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, error, 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
  std::wstring message = length == 0 ? L"Windows error " + std::to_wstring(error)
                                      : std::wstring(buffer, length);
  if (buffer != nullptr) LocalFree(buffer);
  while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n')) message.pop_back();
  return message;
}

void PrintError(const std::wstring& message) {
  std::wcerr << L"windows-sandbox-host: " << message << L"\n";
}

void PrintLaunchUsage() {
  std::wcerr
      << L"Usage: windows-sandbox-host --launch --exe <absolute-exe> --cwd <absolute-dir> "
         L"[--read <absolute-dir>] [--write <absolute-dir>] -- <argv...>\n";
}

std::optional<std::wstring> NormalizeDirectory(const std::wstring& input) {
  if (input.empty()) return std::nullopt;
  std::vector<wchar_t> buffer(32768);
  const DWORD length = GetFullPathNameW(input.c_str(), static_cast<DWORD>(buffer.size()),
                                        buffer.data(), nullptr);
  if (length == 0 || length >= buffer.size()) return std::nullopt;
  std::wstring path(buffer.data(), length);
  std::vector<wchar_t> volume_buffer(32768);
  if (!GetVolumePathNameW(path.c_str(), volume_buffer.data(),
                          static_cast<DWORD>(volume_buffer.size()))) {
    return std::nullopt;
  }
  std::wstring volume_root(volume_buffer.data());
  if (CompareStringOrdinal(path.c_str(), static_cast<int>(path.size()), volume_root.c_str(),
                           static_cast<int>(volume_root.size()), TRUE) == CSTR_EQUAL) {
    return std::nullopt;
  }
  while (path.size() > 3 && (path.back() == L'\\' || path.back() == L'/')) path.pop_back();
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    return std::nullopt;
  }
  wchar_t user_profile[32768]{};
  const DWORD profile_length = GetEnvironmentVariableW(L"USERPROFILE", user_profile, 32768);
  if (profile_length > 0 && profile_length < 32768) {
    std::vector<wchar_t> normalized_profile(32768);
    const DWORD normalized_length = GetFullPathNameW(user_profile,
                                                      static_cast<DWORD>(normalized_profile.size()),
                                                      normalized_profile.data(), nullptr);
    if (normalized_length > 0 && normalized_length < normalized_profile.size() &&
        CompareStringOrdinal(path.c_str(), static_cast<int>(path.size()), normalized_profile.data(),
                             static_cast<int>(normalized_length), TRUE) == CSTR_EQUAL) {
      return std::nullopt;
    }
  }
  return path;
}

bool IsAbsoluteExistingFile(const std::wstring& input) {
  if (input.empty() || !std::filesystem::path(input).is_absolute()) return false;
  const DWORD attributes = GetFileAttributesW(input.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY) &&
         !(attributes & FILE_ATTRIBUTE_REPARSE_POINT);
}

std::optional<LaunchRequest> ParseLaunchRequest(const std::vector<std::wstring>& args) {
  LaunchRequest request;
  bool after_separator = false;
  for (size_t index = 0; index < args.size(); ++index) {
    const std::wstring& argument = args[index];
    if (after_separator) {
      request.child_arguments.push_back(argument);
      continue;
    }
    if (argument == L"--") {
      after_separator = true;
      continue;
    }
    if (argument == L"--exe" || argument == L"--cwd" || argument == L"--read" ||
        argument == L"--write") {
      if (++index >= args.size()) return std::nullopt;
      const std::wstring& value = args[index];
      if (argument == L"--exe") request.executable = value;
      if (argument == L"--cwd") request.cwd = value;
      if (argument == L"--read") request.grants.push_back({value, GrantAccess::kRead});
      if (argument == L"--write") request.grants.push_back({value, GrantAccess::kWrite});
      continue;
    }
    return std::nullopt;
  }
  if (!after_separator || request.child_arguments.empty() || !IsAbsoluteExistingFile(request.executable)) {
    return std::nullopt;
  }
  auto cwd = NormalizeDirectory(request.cwd);
  if (!cwd) return std::nullopt;
  request.cwd = *cwd;
  request.grants.push_back({request.cwd, GrantAccess::kWrite});
  for (Grant& grant : request.grants) {
    auto normalized = NormalizeDirectory(grant.path);
    if (!normalized) return std::nullopt;
    grant.path = *normalized;
  }
  return request;
}

std::wstring QuoteCommandLineArgument(const std::wstring& value) {
  if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
  std::wstring result = L"\"";
  size_t slash_count = 0;
  for (wchar_t character : value) {
    if (character == L'\\') {
      ++slash_count;
    } else if (character == L'\"') {
      result.append(slash_count * 2 + 1, L'\\');
      result.push_back(character);
      slash_count = 0;
    } else {
      result.append(slash_count, L'\\');
      slash_count = 0;
      result.push_back(character);
    }
  }
  result.append(slash_count * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

std::wstring BuildCommandLine(const LaunchRequest& request) {
  std::wstring line = QuoteCommandLineArgument(request.executable);
  for (const std::wstring& argument : request.child_arguments) {
    line.push_back(L' ');
    line.append(QuoteCommandLineArgument(argument));
  }
  return line;
}

bool AddAccessAce(const std::wstring& path, PSID app_container_sid, GrantAccess access) {
  PACL old_dacl = nullptr;
  PSECURITY_DESCRIPTOR security_descriptor = nullptr;
  const DWORD get_status = GetNamedSecurityInfoW(
      const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr,
      nullptr, &old_dacl, nullptr, &security_descriptor);
  if (get_status != ERROR_SUCCESS) {
    PrintError(L"could not read ACL for " + path + L": " + LastErrorMessage(get_status));
    return false;
  }
  EXPLICIT_ACCESSW entry{};
  // `cmd.exe` and PowerShell commonly request FILE_APPEND_DATA for redirection.
  // FILE_GENERIC_WRITE does not include it, so express the minimum file and
  // directory write operations explicitly instead of widening to GENERIC_ALL.
  entry.grfAccessPermissions =
      access == GrantAccess::kWrite
          ? GENERIC_READ | GENERIC_EXECUTE | FILE_WRITE_DATA | FILE_APPEND_DATA |
                FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | DELETE | SYNCHRONIZE
          : GENERIC_READ | GENERIC_EXECUTE | SYNCHRONIZE;
  entry.grfAccessMode = GRANT_ACCESS;
  entry.grfInheritance = NO_INHERITANCE;
  entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  entry.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  entry.Trustee.ptstrName = static_cast<LPWSTR>(app_container_sid);
  PACL new_dacl = nullptr;
  const DWORD acl_status = SetEntriesInAclW(1, &entry, old_dacl, &new_dacl);
  if (acl_status != ERROR_SUCCESS) {
    if (security_descriptor != nullptr) LocalFree(security_descriptor);
    PrintError(L"could not construct ACL for " + path + L": " + LastErrorMessage(acl_status));
    return false;
  }
  const DWORD set_status = SetNamedSecurityInfoW(
      const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr,
      nullptr, new_dacl, nullptr);
  LocalFree(new_dacl);
  if (security_descriptor != nullptr) LocalFree(security_descriptor);
  if (set_status != ERROR_SUCCESS) {
    PrintError(L"could not grant AppContainer access to " + path + L": " + LastErrorMessage(set_status));
    return false;
  }
  return true;
}

// Existing children require an explicit ACE: inheritance only affects objects
// created after the directory ACL is changed.  Reparse points are deliberately
// not traversed, so junctions and symlinks cannot convert a permitted tree into
// a host-filesystem escape.
bool GrantDirectoryTree(const Grant& grant, PSID app_container_sid,
                        std::vector<std::wstring>* granted_paths) {
  std::vector<std::wstring> pending{grant.path};
  while (!pending.empty()) {
    const std::wstring current = std::move(pending.back());
    pending.pop_back();
    if (!AddAccessAce(current, app_container_sid, grant.access)) return false;
    granted_paths->push_back(current);
    const std::wstring pattern = current + L"\\*";
    WIN32_FIND_DATAW entry{};
    HANDLE find = FindFirstFileW(pattern.c_str(), &entry);
    if (find == INVALID_HANDLE_VALUE) {
      PrintError(L"could not enumerate " + current + L": " + LastErrorMessage());
      return false;
    }
    do {
      if (wcscmp(entry.cFileName, L".") == 0 || wcscmp(entry.cFileName, L"..") == 0 ||
          (entry.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
        continue;
      }
      const std::wstring child = current + L"\\" + entry.cFileName;
      if (!AddAccessAce(child, app_container_sid, grant.access)) {
        FindClose(find);
        return false;
      }
      granted_paths->push_back(child);
      if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) pending.push_back(child);
    } while (FindNextFileW(find, &entry));
    const DWORD error = GetLastError();
    FindClose(find);
    if (error != ERROR_NO_MORE_FILES) {
      PrintError(L"could not enumerate " + current + L": " + LastErrorMessage(error));
      return false;
    }
  }
  return true;
}

bool IsOurAccessAllowedAce(void* ace, PSID app_container_sid) {
  const auto* header = static_cast<ACE_HEADER*>(ace);
  if (header->AceType != ACCESS_ALLOWED_ACE_TYPE ||
      header->AceSize < sizeof(ACCESS_ALLOWED_ACE)) {
    return false;
  }
  const auto* allowed = static_cast<ACCESS_ALLOWED_ACE*>(ace);
  return EqualSid(reinterpret_cast<PSID>(const_cast<DWORD*>(&allowed->SidStart)),
                  app_container_sid) != FALSE;
}

// The AppContainer SID is unique to this invocation. Removing all of its
// explicit allow ACEs cannot remove a pre-existing user grant. The function
// preserves every other ACE byte-for-byte, including inherited ACEs.
void RemoveAppContainerAce(const std::wstring& path, PSID app_container_sid) {
  PACL old_dacl = nullptr;
  PSECURITY_DESCRIPTOR security_descriptor = nullptr;
  const DWORD get_status = GetNamedSecurityInfoW(
      const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr,
      nullptr, &old_dacl, nullptr, &security_descriptor);
  if (get_status != ERROR_SUCCESS || old_dacl == nullptr) {
    if (security_descriptor != nullptr) LocalFree(security_descriptor);
    return;
  }
  ACL_SIZE_INFORMATION size{};
  if (!GetAclInformation(old_dacl, &size, sizeof(size), AclSizeInformation)) {
    LocalFree(security_descriptor);
    return;
  }
  std::vector<std::byte> storage(size.AclBytesInUse);
  auto* replacement = reinterpret_cast<PACL>(storage.data());
  if (!InitializeAcl(replacement, static_cast<DWORD>(storage.size()), old_dacl->AclRevision)) {
    LocalFree(security_descriptor);
    return;
  }
  for (DWORD index = 0; index < size.AceCount; ++index) {
    void* ace = nullptr;
    if (!GetAce(old_dacl, index, &ace) || IsOurAccessAllowedAce(ace, app_container_sid)) continue;
    const auto* header = static_cast<ACE_HEADER*>(ace);
    if (!AddAce(replacement, old_dacl->AclRevision, MAXDWORD, ace, header->AceSize)) {
      LocalFree(security_descriptor);
      return;
    }
  }
  SetNamedSecurityInfoW(const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
                        DACL_SECURITY_INFORMATION, nullptr, nullptr, replacement, nullptr);
  LocalFree(security_descriptor);
}

bool CreateAppContainer(const std::wstring& profile_name, PSID* sid_out) {
  const HRESULT create_result = CreateAppContainerProfile(
      profile_name.c_str(), profile_name.c_str(), L"Temporary Claude Code Windows sandbox", nullptr,
      0, sid_out);
  if (SUCCEEDED(create_result)) return true;
  PrintError(L"could not create AppContainer profile (HRESULT " +
             std::to_wstring(static_cast<long>(create_result)) + L"): " +
             LastErrorMessage(HRESULT_CODE(create_result)));
  return false;
}

int Launch(const LaunchRequest& request) {
  const std::wstring profile_name = L"ClaudeCodeSandbox" +
                                    std::to_wstring(GetCurrentProcessId()) + L"x" +
                                    std::to_wstring(GetTickCount64());
  PSID app_container_sid = nullptr;
  if (!CreateAppContainer(profile_name, &app_container_sid)) return kLaunchError;
  std::vector<std::wstring> granted_paths;
  struct ProfileCleanup {
    std::wstring name;
    PSID sid;
    std::vector<std::wstring>* paths;
    ~ProfileCleanup() {
      if (paths != nullptr) {
        std::sort(paths->begin(), paths->end());
        paths->erase(std::unique(paths->begin(), paths->end()), paths->end());
        for (auto iterator = paths->rbegin(); iterator != paths->rend(); ++iterator) {
          RemoveAppContainerAce(*iterator, sid);
        }
      }
      if (sid != nullptr) FreeSid(sid);
      DeleteAppContainerProfile(name.c_str());
    }
  } cleanup{profile_name, app_container_sid, &granted_paths};

  for (const Grant& grant : request.grants) {
    if (!GrantDirectoryTree(grant, app_container_sid, &granted_paths)) return kLaunchError;
  }

  ScopedHandle job(CreateJobObjectW(nullptr, nullptr));
  if (job.value == nullptr) {
    PrintError(L"could not create Job Object: " + LastErrorMessage());
    return kLaunchError;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    PrintError(L"could not configure Job Object: " + LastErrorMessage());
    return kLaunchError;
  }

  SECURITY_CAPABILITIES capabilities{};
  capabilities.AppContainerSid = app_container_sid;
  SIZE_T list_size = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &list_size);
  std::vector<std::byte> attribute_storage(list_size);
  auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute_storage.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &list_size) ||
      !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                                 &capabilities, sizeof(capabilities), nullptr, nullptr)) {
    PrintError(L"could not configure AppContainer launch attributes: " + LastErrorMessage());
    return kLaunchError;
  }
  struct AttributeCleanup {
    LPPROC_THREAD_ATTRIBUTE_LIST value;
    ~AttributeCleanup() { DeleteProcThreadAttributeList(value); }
  } attributes_cleanup{attributes};

  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION process{};
  std::wstring command_line = BuildCommandLine(request);
  if (!CreateProcessW(request.executable.c_str(), command_line.data(), nullptr, nullptr, TRUE,
                      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, nullptr,
                      request.cwd.c_str(), &startup.StartupInfo, &process)) {
    PrintError(L"could not start AppContainer process: " + LastErrorMessage());
    return kLaunchError;
  }
  ScopedHandle process_handle(process.hProcess);
  ScopedHandle thread_handle(process.hThread);
  if (!AssignProcessToJobObject(job.value, process_handle.value)) {
    PrintError(L"could not attach process to Job Object: " + LastErrorMessage());
    TerminateProcess(process_handle.value, ERROR_ACCESS_DENIED);
    return kLaunchError;
  }
  WaitForSingleObject(process_handle.value, INFINITE);
  DWORD exit_code = 1;
  if (!GetExitCodeProcess(process_handle.value, &exit_code)) {
    PrintError(L"could not read process exit code: " + LastErrorMessage());
    return kLaunchError;
  }
  std::wcout << L"{\"sandboxed\":true,\"network\":\"denied\",\"exitCode\":" << exit_code
             << L"}\n";
  return static_cast<int>(exit_code);
}

}  // namespace

int RunSandboxedProcess(const std::vector<std::wstring>& arguments) {
  const auto request = ParseLaunchRequest(arguments);
  if (!request) {
    PrintLaunchUsage();
    return kUsageError;
  }
  return Launch(*request);
}

int CheckAppContainerReadiness() {
  const std::wstring profile_name = L"ClaudeCodeSandboxCheck" +
                                    std::to_wstring(GetCurrentProcessId()) + L"x" +
                                    std::to_wstring(GetTickCount64());
  PSID sid = nullptr;
  if (!CreateAppContainer(profile_name, &sid)) {
    std::wcout << L"{\"appContainerReady\":false}\n";
    return kLaunchError;
  }
  FreeSid(sid);
  const HRESULT delete_result = DeleteAppContainerProfile(profile_name.c_str());
  if (FAILED(delete_result)) {
    PrintError(L"could not remove AppContainer readiness profile (HRESULT " +
               std::to_wstring(static_cast<long>(delete_result)) + L")");
    std::wcout << L"{\"appContainerReady\":false}\n";
    return kLaunchError;
  }
  std::wcout << L"{\"appContainerReady\":true}\n";
  return 0;
}

}  // namespace windows_sandbox_host

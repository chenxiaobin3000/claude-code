// weixin local Plugin — WeChat channel integration

// Types
export {
  MessageType,
  MessageItemType,
  MessageState,
  UploadMediaType,
  TypingStatus,
} from './types.js'
export type {
  BaseInfo,
  CDNMedia,
  TextItem,
  ImageItem,
  VoiceItem,
  FileItem,
  VideoItem,
  RefMessage,
  MessageItem,
  WeixinMessage,
  GetUpdatesReq,
  GetUpdatesResp,
  SendMessageReq,
  SendMessageResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  GetConfigResp,
  SendTypingReq,
  SendTypingResp,
  NotifyLifecycleResp,
} from './types.js'

// API client
export {
  getUpdates,
  sendMessage,
  getUploadUrl,
  getConfig,
  sendTyping,
  notifyStart,
  notifyStop,
} from './api.js'

// Account management
export {
  DEFAULT_BASE_URL,
  CDN_BASE_URL,
  DEFAULT_ACCOUNT_ID,
  DEFAULT_FEATURE_CONFIG,
  getStateDir,
  getAccountStateDir,
  listAccounts,
  loadAllAccounts,
  resolveAccountId,
  validateAccountId,
  loadAccount,
  saveAccount,
  clearAccount,
  loadStateJson,
  saveStateJson,
  loadStateText,
  saveStateText,
  loadFeatureConfig,
  formatRoutedChatId,
  parseRoutedChatId,
  listAccountStateFiles,
} from './accounts.js'
export type {
  AccountData,
  AccountSummary,
  WeixinFeatureConfig,
} from './accounts.js'

// Login
export { startLogin, waitForLogin } from './login.js'
export type { QRCodeResult, LoginResult } from './login.js'

// Pairing / access control
export {
  loadAccessConfig,
  saveAccessConfig,
  isAllowed,
  addPendingPairing,
  confirmPairing,
} from './pairing.js'
export type { AccessConfig } from './pairing.js'

// Media encryption / upload
export {
  encryptAesEcb,
  decryptAesEcb,
  aesEcbPaddedSize,
  buildCdnDownloadUrl,
  buildCdnUploadUrl,
  parseAesKey,
  downloadAndDecrypt,
  uploadFile,
  guessMediaType,
  downloadRemoteToTemp,
  uploadBufferToCdn,
  WEIXIN_MEDIA_MAX_BYTES,
} from './media.js'
export type { UploadedFileInfo } from './media.js'

// Message sending
export { markdownToPlainText, sendText, sendMediaFile } from './send.js'

// Monitor (message polling)
export {
  getContextToken,
  extractPermissionReply,
  extractEchoCommand,
  extractMessageText,
  selectInboundMedia,
  resolveNextLongPollTimeout,
  startPollLoop,
} from './monitor.js'
export type {
  ParsedMessage,
  OnMessageCallback,
  PermissionResponse,
  OnPermissionResponseCallback,
} from './monitor.js'

// Permission state
export {
  setActivePermissionChat,
  getActivePermissionChat,
  savePendingPermission,
  consumePendingPermission,
} from './permissions.js'
export type {
  ChannelPermissionRequestParams,
  PendingPermissionRequest,
  ActivePermissionChat,
} from './permissions.js'

// Server (MCP)
export {
  createWeixinMcpServer,
  resolveWeixinToolTarget,
  runWeixinMcpServer,
} from './server.js'

// CLI
export { handleWeixinCli } from './cli.js'

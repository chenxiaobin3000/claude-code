/** Permission result exchanged by self-hosted Direct Connect and SSH transports. */
export type RemotePermissionResponse =
  | {
      behavior: 'allow'
      updatedInput: Record<string, unknown>
    }
  | {
      behavior: 'deny'
      message: string
    }

export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

/** Hand-written SRC-JSON Typert contribution shared by Host registration and Client mount. */

import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
  TypertRemoteNamespace,
} from '@deepseek-ai/dsh-typert-protocol'
import type { McpRuntimeSnapshot } from './status.js'

export const MCP_STATUS_SERVICE = 'trsAipMcpStatusController'
export const MCP_STATUS_NAMESPACE = 'trsAipMcp'

const snapshotDescriptor = {
  id: '@trs-aip/dsh-mcp-settings#mcp-status/snapshot',
  service: MCP_STATUS_SERVICE,
  namespace: MCP_STATUS_NAMESPACE,
  method: 'snapshot',
  invocation: { kind: 'direct' },
  parameters: [],
  result: { mode: 'src-json' },
} as const satisfies InvocationDescriptor

export const MCP_STATUS_REMOTE: TypertRemoteContribution = Object.freeze({
  package: '@trs-aip/dsh-mcp-settings',
  descriptors: Object.freeze([snapshotDescriptor]),
})

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'trsAipMcp/snapshot': () => Promise<RemoteResult<McpRuntimeSnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    trsAipMcp: TypertRemoteNamespace<'trsAipMcp'>
  }
}

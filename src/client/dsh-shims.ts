/** Standalone TypeScript shims for AgentTeams Studio UI runtime contracts. */

export type SessionId = string

export interface SubagentAddress {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId
  readonly mode: 'continuable' | 'oneshot'
}

export interface ObservableSnapshot<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}

export interface SessionListState {
  readonly current?: SessionId
  readonly byId: Readonly<Record<string, { readonly id: SessionId; readonly retainedBy?: Readonly<Record<string, number>> }>>
}

export interface ModelCandidateMeta {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly defaultEffort?: string
    readonly efforts?: readonly {
      readonly id: string
      readonly name: string
      readonly description?: string
    }[]
  }
}

export interface ModelDirectorySnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly groups: readonly {
    readonly id: string
    readonly name: string
    readonly models: readonly ModelCandidateMeta[]
  }[]
  readonly failures: readonly string[]
  readonly error?: string
}

export interface ModelDirectory {
  readonly store: ObservableSnapshot<ModelDirectorySnapshot>
  load(): Promise<void>
}

export interface ModelDirectoryResolver {
  directoryFor(sessionId?: SessionId): ModelDirectory
}

export interface PropsLocale<NS extends string = 'agentTeams'> {
  readonly t: (key: any, params?: Record<string, unknown>) => string
}

export type PropsRuntime<Slot extends string = string, Key extends string = string> = {
  readonly sessionId: SessionId
  readonly useTabInfo: () => {
    readonly tab: {
      readonly visible: boolean
      readonly actions: {
        readonly close: () => void
      }
    }
  }
  readonly useChat?: <R>(selector: (snapshot: { readonly nodes: Map<string, unknown> }) => R) => R
  readonly turn?: { readonly turn: number; readonly status: string }
  readonly size?: number
  readonly active?: boolean
} & (Slot extends 'conversation.chat.node'
  ? {
      readonly node: {
        readonly key: string
        readonly location: { readonly kind: string; readonly turn: { readonly status: string } }
        readonly data: any
      }
    }
  : {
      readonly node?: {
        readonly key: string
        readonly location: { readonly kind: string; readonly turn: { readonly status: string } }
        readonly data: any
      }
    })

export interface ISidebarRight {
  readonly mounted: { getSnapshot(): SessionId | undefined }
  isExpanded(): boolean
  openTab(kind: string): void
}

export type UsePanelInfo = <T>(selector: (panel: { readonly activePanelId: string | null }) => T) => T

export interface ChatConversationViewNode {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: {
    readonly kind: string
    readonly turn: { readonly turn: number; readonly status: string }
  }
  readonly visibility: 'visible' | 'hidden'
  readonly data: unknown
}

export interface ConversationNodeContext<S> {
  readonly key: string
  readonly id: string
  readonly state: S
  readonly start?: {
    readonly event: { readonly seq: number }
    readonly location: {
      readonly kind: string
      readonly turn: { readonly turn: number; readonly status: string }
    }
  }
}

export interface ConversationNodeDefinition<S> {
  readonly kind: string
  readonly target: 'chat'
  readonly match: (event: any) => { id: string; role: 'start' | 'update' } | null
  readonly start: (context: ConversationNodeContext<S>, match: { event: any }) => S
  readonly update: (context: ConversationNodeContext<S>, match: { event: any }) => S
  readonly buildViewNode: (context: ConversationNodeContext<S>) => ChatConversationViewNode | null
}

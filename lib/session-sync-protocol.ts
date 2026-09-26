/** Read-only session synchronization protocol. No server/runtime imports. */
export const SESSION_SYNC_PROTOCOL = 1 as const;

export interface SessionSyncSnapshot {
  sessionId: string;
  snapshotRevision?: string | null;
  context: {
    messages: unknown[];
    entryIds: string[];
  };
}

export type SessionSyncMetadata<T extends SessionSyncSnapshot> = Omit<T, "context"> & {
  context: Omit<T["context"], "messages">;
};

export type SessionSyncResponse<T extends SessionSyncSnapshot> =
  | { protocol: 1; mode: "unchanged"; revision: string }
  | { protocol: 1; mode: "reset"; revision: string | null; data: T }
  | {
      protocol: 1;
      mode: "delta";
      baseRevision: string;
      revision: string;
      dropCount: number;
      keepCount: number;
      tailMessages: T["context"]["messages"];
      data: SessionSyncMetadata<T>;
    };

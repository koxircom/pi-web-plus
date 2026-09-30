export interface EnhancementTagDefinition {
  id: string;
  name: string;
  color?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface EnhancementDurableState {
  sessionTagsDefinitions: EnhancementTagDefinition[];
  sessionTagMappings: Record<string, unknown>;
  sessionColors: Record<string, string>;
  enhancementSettingsByClient: Record<string, Record<string, string>>;
}

export interface EnhancementStateReadResult {
  ok: true;
  revision: number;
  state: EnhancementDurableState;
  storageVersion: 1;
}

export interface EnhancementStateCommitResult extends EnhancementStateReadResult {
  acknowledgedOpIds: string[];
  tagIdRemap: Record<string, string>;
}

export interface EnhancementStateStoreInstance {
  initializeFromLegacy(options?: { modelsConfigPath?: string }): EnhancementStateReadResult;
  read(): EnhancementStateReadResult;
  commit(operations: unknown[]): Promise<EnhancementStateCommitResult>;
}

export function createStateStore(options: { agentDir: string }): EnhancementStateStoreInstance;

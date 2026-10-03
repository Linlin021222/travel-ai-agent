import { randomUUID } from 'node:crypto';
import { AiCacheService } from './ai-cache.service.js';

/**
 * LangGraph Checkpointer-shaped state store backed by the AI task-state cache.
 *
 * The method names and signatures mirror LangGraph's `BaseCheckpointSaver`
 * (`getTuple` / `put` / `putWrites` / `list`) so a graph can be handed this
 * instance directly once orchestration lands next sprint. Types are declared
 * locally instead of importing `@langchain/langgraph`, whose peer dependency
 * `@langchain/core` is not installed in this project.
 */

export interface CheckpointConfigurable {
  thread_id?: string;
  checkpoint_ns?: string;
  checkpoint_id?: string;
}

export interface CheckpointConfig {
  configurable?: CheckpointConfigurable;
}

export interface CheckpointTuple {
  config: CheckpointConfig;
  checkpoint: unknown;
  metadata?: unknown;
  parentConfig?: CheckpointConfig;
}

export interface StoredCheckpoint {
  checkpointId: string;
  checkpoint: unknown;
  metadata?: unknown;
  parentCheckpointId?: string | null;
  createdAt: string;
}

export interface StoredWrite {
  taskId: string;
  writes: unknown[];
  createdAt: string;
}

export interface StoredThreadState {
  threadId: string;
  namespace: string;
  checkpoints: StoredCheckpoint[];
  writes: Record<string, StoredWrite[]>;
  updatedAt: string;
}

export class AiTaskStateCheckpointer {
  constructor(
    private readonly cache: AiCacheService,
    private readonly tenantId: string,
  ) {}

  private threadIdOf(config: CheckpointConfig): string {
    const threadId = config.configurable?.thread_id;
    if (!threadId) throw new Error('config.configurable.thread_id is required');
    return threadId;
  }

  private async read(threadId: string, namespace: string): Promise<StoredThreadState | null> {
    const key = `${namespace}:${threadId}`;
    return this.cache.getTaskState<StoredThreadState>(this.tenantId, key);
  }

  private async write(state: StoredThreadState): Promise<void> {
    await this.cache.setTaskState(this.tenantId, `${state.namespace}:${state.threadId}`, state);
  }

  /** Latest checkpoint for a thread, or a specific one when `checkpoint_id` is set. */
  async getTuple(config: CheckpointConfig): Promise<CheckpointTuple | undefined> {
    const threadId = this.threadIdOf(config);
    const namespace = config.configurable?.checkpoint_ns ?? 'default';
    const state = await this.read(threadId, namespace);
    if (!state?.checkpoints?.length) return undefined;

    const wanted = config.configurable?.checkpoint_id;
    const found = wanted
      ? state.checkpoints.find((entry) => entry.checkpointId === wanted)
      : state.checkpoints[state.checkpoints.length - 1];
    if (!found) return undefined;

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: namespace,
          checkpoint_id: found.checkpointId,
        },
      },
      checkpoint: found.checkpoint,
      metadata: found.metadata,
      parentConfig: found.parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: namespace,
              checkpoint_id: found.parentCheckpointId,
            },
          }
        : undefined,
    };
  }

  /** Append a checkpoint; returns the config that addresses it. */
  async put(
    config: CheckpointConfig,
    checkpoint: unknown,
    metadata?: unknown,
  ): Promise<CheckpointConfig> {
    const threadId = this.threadIdOf(config);
    const namespace = config.configurable?.checkpoint_ns ?? 'default';
    const checkpointId = randomUUID();

    const state: StoredThreadState =
      (await this.read(threadId, namespace)) ??
      { threadId, namespace, checkpoints: [], writes: {}, updatedAt: new Date().toISOString() };

    state.checkpoints.push({
      checkpointId,
      checkpoint,
      metadata,
      parentCheckpointId:
        config.configurable?.checkpoint_id ??
        state.checkpoints[state.checkpoints.length - 1]?.checkpointId ??
        null,
      createdAt: new Date().toISOString(),
    });
    state.updatedAt = new Date().toISOString();
    await this.write(state);

    return { configurable: { thread_id: threadId, checkpoint_ns: namespace, checkpoint_id: checkpointId } };
  }

  /** Record intermediate task writes next to a checkpoint. */
  async putWrites(config: CheckpointConfig, writes: unknown[], taskId: string): Promise<void> {
    const threadId = this.threadIdOf(config);
    const namespace = config.configurable?.checkpoint_ns ?? 'default';
    const state =
      (await this.read(threadId, namespace)) ??
      { threadId, namespace, checkpoints: [], writes: {}, updatedAt: new Date().toISOString() };

    const bucket = config.configurable?.checkpoint_id ?? 'latest';
    state.writes[bucket] = [
      ...(state.writes[bucket] ?? []),
      { taskId, writes, createdAt: new Date().toISOString() },
    ];
    state.updatedAt = new Date().toISOString();
    await this.write(state);
  }

  /** Newest-first iteration, matching LangGraph's `list` contract. */
  async *list(config: CheckpointConfig, options?: { limit?: number }): AsyncGenerator<CheckpointTuple> {
    const threadId = this.threadIdOf(config);
    const namespace = config.configurable?.checkpoint_ns ?? 'default';
    const state = await this.read(threadId, namespace);
    if (!state?.checkpoints?.length) return;

    const limit = options?.limit ?? 20;
    for (const entry of [...state.checkpoints].reverse().slice(0, limit)) {
      yield {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: namespace,
            checkpoint_id: entry.checkpointId,
          },
        },
        checkpoint: entry.checkpoint,
        metadata: entry.metadata,
        parentConfig: entry.parentCheckpointId
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: namespace,
                checkpoint_id: entry.parentCheckpointId,
              },
            }
          : undefined,
      };
    }
  }

  /** Drop the whole thread (task finished / cancelled). */
  async deleteThread(config: CheckpointConfig): Promise<void> {
    const threadId = this.threadIdOf(config);
    const namespace = config.configurable?.checkpoint_ns ?? 'default';
    await this.cache.deleteTaskState(this.tenantId, `${namespace}:${threadId}`);
  }
}

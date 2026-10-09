import type { BaseWriteTool } from './base-write-tool.js';
import { FlightRecordCreateTool } from './flight-record-create.tool.js';
import { FlightRecordDeleteTool } from './flight-record-delete.tool.js';
import { FlightRecordUpdateTool } from './flight-record-update.tool.js';
import { UserBatchDeleteTool } from './user-batch-delete.tool.js';
import { UserCreateTool } from './user-create.tool.js';
import { UserDeleteTool } from './user-delete.tool.js';
import { UserUpdateTool } from './user-update.tool.js';

/**
 * Write tools live in their own directory, physically separated from the read
 * tools in `../`. They are still plain Nest providers, so registration works
 * the same way — but nothing in the read path can pick them up by accident.
 *
 * Every tool here declares `autoExecute: false`: the registry converts an
 * unconfirmed call into a preview, and only a matching confirmation token
 * reaches `execute()`.
 */
export const AI_WRITE_TOOL_CLASSES = [
  UserCreateTool,
  UserUpdateTool,
  UserDeleteTool,
  UserBatchDeleteTool,
  FlightRecordCreateTool,
  FlightRecordUpdateTool,
  FlightRecordDeleteTool,
] as unknown as Array<new (...args: never[]) => BaseWriteTool<never, unknown>>;

export { BaseWriteTool, isWriteTool } from './base-write-tool.js';
export type { WriteToolDefinition, WritePreviewInput, RollbackRecord } from './base-write-tool.js';
export { WriteGuardService } from './write-guard.service.js';
export {
  FlightRecordCreateTool,
  FlightRecordDeleteTool,
  FlightRecordUpdateTool,
  UserBatchDeleteTool,
  UserCreateTool,
  UserDeleteTool,
  UserUpdateTool,
};

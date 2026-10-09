import type { BaseTool } from './base-tool.js';
import { DashboardBarTool } from './dashboard-bar.tool.js';
import { DashboardBubbleTool } from './dashboard-bubble.tool.js';
import { DashboardOverviewTool } from './dashboard-overview.tool.js';
import { FlightQueryTool } from './flight-query.tool.js';
import { UserQueryTool } from './user-query.tool.js';
import { AI_WRITE_TOOL_CLASSES } from './write/index.js';

/**
 * Read-only tools: safe to expose to the model through function calling.
 */
export const AI_READ_TOOL_CLASSES = [
  UserQueryTool,
  FlightQueryTool,
  DashboardOverviewTool,
  DashboardBarTool,
  DashboardBubbleTool,
] as unknown as Array<new (...args: never[]) => BaseTool<never, unknown>>;

/**
 * Every tool is a plain Nest provider: the registry receives them through DI
 * and registers itself, so adding a tool means adding one class here.
 *
 * Read tools come first; write tools are appended from their own directory and
 * are withheld from `toolSpecs()`, so the model can never call them directly.
 */
export const AI_TOOL_CLASSES = [
  ...AI_READ_TOOL_CLASSES,
  ...AI_WRITE_TOOL_CLASSES,
] as unknown as Array<new (...args: never[]) => BaseTool<never, unknown>>;

export { BaseTool } from './base-tool.js';
export { ToolRegistryService } from './tool-registry.service.js';
export * from './tool.types.js';
export { AI_WRITE_TOOL_CLASSES } from './write/index.js';
export { DashboardBarTool, DashboardBubbleTool, DashboardOverviewTool, FlightQueryTool, UserQueryTool };

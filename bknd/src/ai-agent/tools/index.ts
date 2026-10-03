import type { BaseTool } from './base-tool.js';
import { DashboardBarTool } from './dashboard-bar.tool.js';
import { DashboardBubbleTool } from './dashboard-bubble.tool.js';
import { DashboardOverviewTool } from './dashboard-overview.tool.js';
import { FlightQueryTool } from './flight-query.tool.js';
import { UserQueryTool } from './user-query.tool.js';

/**
 * Every tool is a plain Nest provider: the registry receives them through DI
 * and registers itself, so adding a tool means adding one class here.
 */
export const AI_TOOL_CLASSES = [
  UserQueryTool,
  FlightQueryTool,
  DashboardOverviewTool,
  DashboardBarTool,
  DashboardBubbleTool,
] as unknown as Array<new (...args: never[]) => BaseTool<never, unknown>>;

export { BaseTool } from './base-tool.js';
export { ToolRegistryService } from './tool-registry.service.js';
export * from './tool.types.js';
export { DashboardBarTool, DashboardBubbleTool, DashboardOverviewTool, FlightQueryTool, UserQueryTool };

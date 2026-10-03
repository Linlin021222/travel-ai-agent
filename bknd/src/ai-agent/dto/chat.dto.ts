import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { isChatMessageType, type ChatMessageType } from '../entities/ai-chat-message.entity.js';
import { LLM_PROVIDER_IDS } from '../llm/llm.types.js';

export class ChatHistoryItemDto {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  content!: string;
}

export class ChatAttachmentDto {
  @ApiProperty({ description: '文件名' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: '文件大小（字节）' })
  @IsOptional()
  size?: number;

  @ApiPropertyOptional({ description: 'MIME 类型' })
  @IsOptional()
  @IsString()
  type?: string;
}

export class SendChatMessageDto {
  @ApiPropertyOptional({ description: '会话 ID；为空则自动创建新会话' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @ApiProperty({ description: '用户输入的消息' })
  @IsString()
  @MaxLength(20_000)
  content!: string;

  @ApiPropertyOptional({ description: '历史消息（用于多轮对话上下文）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChatHistoryItemDto)
  history?: ChatHistoryItemDto[];

  @ApiPropertyOptional({ description: '覆盖默认模型提供商', enum: LLM_PROVIDER_IDS })
  @IsOptional()
  @IsIn(LLM_PROVIDER_IDS as unknown as string[])
  provider?: string;

  @ApiPropertyOptional({ description: '覆盖默认模型' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;

  @ApiPropertyOptional({ description: '上传的文件元信息（本周仅透传展示）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatAttachmentDto)
  attachments?: ChatAttachmentDto[];

  @ApiPropertyOptional({
    description: '业务维度，用于聊天结果缓存的分组与定向失效，例如 flight-delay',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dimension?: string;
}

export class CreateSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: LLM_PROVIDER_IDS })
  @IsOptional()
  @IsIn(LLM_PROVIDER_IDS as unknown as string[])
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;
}

export class AppendMessageDto {
  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @ApiPropertyOptional({ description: '消息类型，决定前端渲染器' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40_000)
  content!: string;

  @ApiPropertyOptional({ description: '表格/图表/报表/确认的结构化数据' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export function normalizeMessageType(type?: string): ChatMessageType {
  return type && isChatMessageType(type) ? type : 'text';
}

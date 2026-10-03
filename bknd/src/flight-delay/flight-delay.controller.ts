import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueryFlightDelayDto } from './dto/query-flight-delay.dto.js';
import { FlightDelayService, type PagedFlightDelay } from './flight-delay.service.js';
import type {
  AggregateResult,
  BubbleResult,
  FlightDelayFilterOptions,
} from './flight-delay.fields.js';

@ApiTags('flight-delay')
@Controller('flight-delay')
export class FlightDelayController {
  constructor(private readonly flightDelayService: FlightDelayService) {}

  @Get()
  @ApiOperation({ summary: '分页查询航班延误统计数据' })
  @ApiOkResponse({ description: '当前页数据以及分页信息' })
  findAll(@Query() query: QueryFlightDelayDto): Promise<PagedFlightDelay> {
    return this.flightDelayService.findAll(query);
  }

  @Get('filter-options')
  @ApiOperation({ summary: '获取筛选下拉选项（按当前筛选条件联动）' })
  @ApiOkResponse({ description: '年份、月份、航司、机场选项及数值字段边界' })
  getFilterOptions(@Query() query: QueryFlightDelayDto): Promise<FlightDelayFilterOptions> {
    return this.flightDelayService.getFilterOptions(query);
  }

  @Get('aggregate')
  @ApiOperation({ summary: '按维度聚合单指标求和（动态条形图数据）' })
  @ApiOkResponse({ description: '按 日期/航司/机场 分组的单指标汇总' })
  aggregate(@Query() query: QueryFlightDelayDto): Promise<AggregateResult> {
    return this.flightDelayService.aggregate(query);
  }

  @Get('bubble')
  @ApiOperation({ summary: '按 航司×机场 聚合核心指标（气泡图数据）' })
  @ApiOkResponse({ description: '每个航司-机场对的 5 项核心指标汇总' })
  bubble(@Query() query: QueryFlightDelayDto): Promise<BubbleResult> {
    return this.flightDelayService.bubble(query);
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/decorators';

@ApiTags('Root')
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Orion API Root Welcome' })
  getRoot() {
    return {
      name: 'Orion Platform API',
      status: 'online',
      version: '1.0.0',
      docs: '/docs',
      health: '/api/v1/health/liveness',
    };
  }
}

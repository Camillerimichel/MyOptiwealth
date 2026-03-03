import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: 'ok',
      service: 'myoptiwealth-api',
      at: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return {
      status: 'alive',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        checks: {
          database: 'ok',
        },
      };
    } catch {
      throw new ServiceUnavailableException('Database not ready');
    }
  }

  @Get('details')
  async details() {
    let database: 'ok' | 'error' = 'ok';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      service: 'myoptiwealth-api',
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        database,
      },
      at: new Date().toISOString(),
    };
  }
}

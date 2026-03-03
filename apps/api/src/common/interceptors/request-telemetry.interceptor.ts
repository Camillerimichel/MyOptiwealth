import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';
import { MetricsService } from '../../modules/observability/metrics.service';

interface RequestWithUser {
  method: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: {
    sub?: string;
    activeWorkspaceId?: string;
  };
}

interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
}

@Injectable()
export class RequestTelemetryInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = process.hrtime.bigint();
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<ResponseLike>();

    const requestIdHeader = request.headers['x-request-id'];
    const requestId =
      typeof requestIdHeader === 'string' && requestIdHeader.length > 0
        ? requestIdHeader
        : randomUUID();
    response.setHeader('x-request-id', requestId);

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Number(process.hrtime.bigint() - now) / 1_000_000;
          const route = request.originalUrl ?? request.url ?? 'unknown';
          const statusCode = response.statusCode;

          this.metricsService.recordHttp(
            request.method,
            route,
            statusCode,
            durationMs,
          );

          console.log(
            JSON.stringify({
              type: 'http_request',
              requestId,
              method: request.method,
              route,
              statusCode,
              durationMs: Number(durationMs.toFixed(2)),
              ip: request.ip,
              userId: request.user?.sub,
              workspaceId: request.user?.activeWorkspaceId,
              at: new Date().toISOString(),
            }),
          );
        },
        error: (error: unknown) => {
          const durationMs = Number(process.hrtime.bigint() - now) / 1_000_000;
          const route = request.originalUrl ?? request.url ?? 'unknown';
          const statusCode = response.statusCode || 500;

          this.metricsService.recordHttp(
            request.method,
            route,
            statusCode,
            durationMs,
          );

          console.error(
            JSON.stringify({
              type: 'http_error',
              requestId,
              method: request.method,
              route,
              statusCode,
              durationMs: Number(durationMs.toFixed(2)),
              message: error instanceof Error ? error.message : 'Unknown error',
              at: new Date().toISOString(),
            }),
          );
        },
      }),
    );
  }
}

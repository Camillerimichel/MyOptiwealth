import { Injectable } from '@nestjs/common';

interface MetricBucket {
  count: number;
  totalMs: number;
  maxMs: number;
}

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly httpBuckets = new Map<string, MetricBucket>();

  recordHttp(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method}|${route}|${statusCode}`;
    const current = this.httpBuckets.get(key) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };

    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);

    this.httpBuckets.set(key, current);
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP myoptiwealth_process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE myoptiwealth_process_uptime_seconds gauge');
    lines.push(`myoptiwealth_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);

    lines.push('# HELP myoptiwealth_http_requests_total Total HTTP requests');
    lines.push('# TYPE myoptiwealth_http_requests_total counter');

    lines.push('# HELP myoptiwealth_http_request_duration_ms_sum Total HTTP request duration in ms');
    lines.push('# TYPE myoptiwealth_http_request_duration_ms_sum counter');

    lines.push('# HELP myoptiwealth_http_request_duration_ms_max Max HTTP request duration in ms');
    lines.push('# TYPE myoptiwealth_http_request_duration_ms_max gauge');

    for (const [key, value] of this.httpBuckets.entries()) {
      const [method, route, statusCode] = key.split('|');
      const labels = `{method="${method}",route="${route}",status_code="${statusCode}"}`;
      lines.push(`myoptiwealth_http_requests_total${labels} ${value.count}`);
      lines.push(`myoptiwealth_http_request_duration_ms_sum${labels} ${value.totalMs.toFixed(2)}`);
      lines.push(`myoptiwealth_http_request_duration_ms_max${labels} ${value.maxMs.toFixed(2)}`);
    }

    return `${lines.join('\n')}\n`;
  }
}

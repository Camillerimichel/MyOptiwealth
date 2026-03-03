"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsService = void 0;
const common_1 = require("@nestjs/common");
let MetricsService = class MetricsService {
    constructor() {
        this.startedAt = Date.now();
        this.httpBuckets = new Map();
    }
    recordHttp(method, route, statusCode, durationMs) {
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
    renderPrometheus() {
        const lines = [];
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
};
exports.MetricsService = MetricsService;
exports.MetricsService = MetricsService = __decorate([
    (0, common_1.Injectable)()
], MetricsService);
//# sourceMappingURL=metrics.service.js.map
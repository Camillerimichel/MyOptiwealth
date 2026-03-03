"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestTelemetryInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const crypto_1 = require("crypto");
const metrics_service_1 = require("../../modules/observability/metrics.service");
let RequestTelemetryInterceptor = class RequestTelemetryInterceptor {
    constructor(metricsService) {
        this.metricsService = metricsService;
    }
    intercept(context, next) {
        const now = process.hrtime.bigint();
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const requestIdHeader = request.headers['x-request-id'];
        const requestId = typeof requestIdHeader === 'string' && requestIdHeader.length > 0
            ? requestIdHeader
            : (0, crypto_1.randomUUID)();
        response.setHeader('x-request-id', requestId);
        return next.handle().pipe((0, rxjs_1.tap)({
            next: () => {
                const durationMs = Number(process.hrtime.bigint() - now) / 1_000_000;
                const route = request.originalUrl ?? request.url ?? 'unknown';
                const statusCode = response.statusCode;
                this.metricsService.recordHttp(request.method, route, statusCode, durationMs);
                console.log(JSON.stringify({
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
                }));
            },
            error: (error) => {
                const durationMs = Number(process.hrtime.bigint() - now) / 1_000_000;
                const route = request.originalUrl ?? request.url ?? 'unknown';
                const statusCode = response.statusCode || 500;
                this.metricsService.recordHttp(request.method, route, statusCode, durationMs);
                console.error(JSON.stringify({
                    type: 'http_error',
                    requestId,
                    method: request.method,
                    route,
                    statusCode,
                    durationMs: Number(durationMs.toFixed(2)),
                    message: error instanceof Error ? error.message : 'Unknown error',
                    at: new Date().toISOString(),
                }));
            },
        }));
    }
};
exports.RequestTelemetryInterceptor = RequestTelemetryInterceptor;
exports.RequestTelemetryInterceptor = RequestTelemetryInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [metrics_service_1.MetricsService])
], RequestTelemetryInterceptor);
//# sourceMappingURL=request-telemetry.interceptor.js.map
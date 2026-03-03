export declare class MetricsService {
    private readonly startedAt;
    private readonly httpBuckets;
    recordHttp(method: string, route: string, statusCode: number, durationMs: number): void;
    renderPrometheus(): string;
}

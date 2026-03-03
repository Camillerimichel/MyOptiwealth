import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

interface UserPayload {
  activeWorkspaceId?: string;
}

interface WorkspaceRequest {
  user?: UserPayload;
  headers: Record<string, string | string[] | undefined>;
  workspaceId?: string;
}

@Injectable()
export class WorkspaceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const headerWorkspace = request.headers['x-workspace-id'];
    const workspaceFromHeader =
      typeof headerWorkspace === 'string' ? headerWorkspace : undefined;

    request.workspaceId = workspaceFromHeader ?? request.user?.activeWorkspaceId;
    return next.handle();
  }
}

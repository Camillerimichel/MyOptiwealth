import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface WorkspaceRequest {
  workspaceId?: string;
}

export const WorkspaceId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    return request.workspaceId ?? '';
  },
);

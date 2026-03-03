import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface AuthUser {
  sub: string;
  email: string;
  activeWorkspaceId: string;
  isPlatformAdmin: boolean;
}

interface RequestWithUser {
  user: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);

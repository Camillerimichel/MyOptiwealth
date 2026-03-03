"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceInterceptor = void 0;
const common_1 = require("@nestjs/common");
let WorkspaceInterceptor = class WorkspaceInterceptor {
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        const headerWorkspace = request.headers['x-workspace-id'];
        const workspaceFromHeader = typeof headerWorkspace === 'string' ? headerWorkspace : undefined;
        request.workspaceId = workspaceFromHeader ?? request.user?.activeWorkspaceId;
        return next.handle();
    }
};
exports.WorkspaceInterceptor = WorkspaceInterceptor;
exports.WorkspaceInterceptor = WorkspaceInterceptor = __decorate([
    (0, common_1.Injectable)()
], WorkspaceInterceptor);
//# sourceMappingURL=workspace.interceptor.js.map
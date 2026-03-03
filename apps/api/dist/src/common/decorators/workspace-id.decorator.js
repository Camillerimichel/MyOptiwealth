"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceId = void 0;
const common_1 = require("@nestjs/common");
exports.WorkspaceId = (0, common_1.createParamDecorator)((_data, context) => {
    const request = context.switchToHttp().getRequest();
    return request.workspaceId ?? '';
});
//# sourceMappingURL=workspace-id.decorator.js.map
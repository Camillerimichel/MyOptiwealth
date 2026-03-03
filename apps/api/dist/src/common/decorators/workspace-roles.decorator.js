"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRoles = exports.WORKSPACE_ROLES_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.WORKSPACE_ROLES_KEY = 'workspaceRoles';
const WorkspaceRoles = (...roles) => (0, common_1.SetMetadata)(exports.WORKSPACE_ROLES_KEY, roles);
exports.WorkspaceRoles = WorkspaceRoles;
//# sourceMappingURL=workspace-roles.decorator.js.map
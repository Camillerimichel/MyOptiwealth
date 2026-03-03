import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';
import { UpdateProjectDto } from './dto/update-project.dto';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class ProjectsController {
    private readonly projectsService;
    constructor(projectsService: ProjectsService);
    list(user: AuthUser): Promise<{
        progressPercent: number;
        society: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            name: string;
            updatedAt: Date;
            legalForm: string | null;
            siren: string | null;
            siret: string | null;
            addressLine1: string | null;
            addressLine2: string | null;
            postalCode: string | null;
            city: string | null;
            country: string | null;
        };
        phases: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            updatedAt: Date;
            title: string;
            projectId: string;
            position: number;
        }[];
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        societyId: string;
        missionType: string | null;
        currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
        estimatedFees: import("@prisma/client/runtime/library").Decimal;
        invoicedAmount: import("@prisma/client/runtime/library").Decimal;
        collectedAmount: import("@prisma/client/runtime/library").Decimal;
        estimatedMargin: import("@prisma/client/runtime/library").Decimal;
    }[]>;
    create(user: AuthUser, dto: CreateProjectDto): Promise<{
        phases: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            updatedAt: Date;
            title: string;
            projectId: string;
            position: number;
        }[];
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        societyId: string;
        missionType: string | null;
        currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
        progressPercent: number;
        estimatedFees: import("@prisma/client/runtime/library").Decimal;
        invoicedAmount: import("@prisma/client/runtime/library").Decimal;
        collectedAmount: import("@prisma/client/runtime/library").Decimal;
        estimatedMargin: import("@prisma/client/runtime/library").Decimal;
    }>;
    update(user: AuthUser, projectId: string, dto: UpdateProjectDto): Promise<({
        society: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            name: string;
            updatedAt: Date;
            legalForm: string | null;
            siren: string | null;
            siret: string | null;
            addressLine1: string | null;
            addressLine2: string | null;
            postalCode: string | null;
            city: string | null;
            country: string | null;
        };
        phases: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
            updatedAt: Date;
            title: string;
            projectId: string;
            position: number;
        }[];
    } & {
        id: string;
        createdAt: Date;
        workspaceId: string;
        name: string;
        updatedAt: Date;
        societyId: string;
        missionType: string | null;
        currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
        progressPercent: number;
        estimatedFees: import("@prisma/client/runtime/library").Decimal;
        invoicedAmount: import("@prisma/client/runtime/library").Decimal;
        collectedAmount: import("@prisma/client/runtime/library").Decimal;
        estimatedMargin: import("@prisma/client/runtime/library").Decimal;
    }) | null>;
}
export {};

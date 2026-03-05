import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { LinkProjectContactDto } from './dto/link-project-contact.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectContactDto } from './dto/update-project-contact.dto';
export declare class ProjectsService {
    private readonly prisma;
    private readonly auditService;
    constructor(prisma: PrismaService, auditService: AuditService);
    create(workspaceId: string, userId: string, dto: CreateProjectDto): Promise<{
        phases: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
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
        progressPercent: number;
        societyId: string;
        missionType: string | null;
        currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
        estimatedFees: import("@prisma/client/runtime/library").Decimal;
        invoicedAmount: import("@prisma/client/runtime/library").Decimal;
        collectedAmount: import("@prisma/client/runtime/library").Decimal;
        estimatedMargin: import("@prisma/client/runtime/library").Decimal;
    }>;
    update(workspaceId: string, userId: string, projectId: string, dto: UpdateProjectDto): Promise<({
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
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
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
        progressPercent: number;
        societyId: string;
        missionType: string | null;
        currentPhase: import(".prisma/client").$Enums.ProjectPhaseCode;
        estimatedFees: import("@prisma/client/runtime/library").Decimal;
        invoicedAmount: import("@prisma/client/runtime/library").Decimal;
        collectedAmount: import("@prisma/client/runtime/library").Decimal;
        estimatedMargin: import("@prisma/client/runtime/library").Decimal;
    }) | null>;
    list(workspaceId: string): Promise<{
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
            updatedAt: Date;
            code: import(".prisma/client").$Enums.ProjectPhaseCode;
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
    listProjectContacts(workspaceId: string, projectId: string): Promise<({
        contact: {
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
            } | null;
        } & {
            id: string;
            createdAt: Date;
            workspaceId: string;
            email: string | null;
            firstName: string;
            lastName: string;
            updatedAt: Date;
            role: import(".prisma/client").$Enums.ContactRole | null;
            societyId: string | null;
            phone: string | null;
        };
    } & {
        createdAt: Date;
        projectId: string;
        contactId: string;
        projectRole: import(".prisma/client").$Enums.ContactRole | null;
    })[]>;
    addProjectContact(workspaceId: string, userId: string, projectId: string, dto: LinkProjectContactDto): Promise<{
        contact: {
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
            } | null;
        } & {
            id: string;
            createdAt: Date;
            workspaceId: string;
            email: string | null;
            firstName: string;
            lastName: string;
            updatedAt: Date;
            role: import(".prisma/client").$Enums.ContactRole | null;
            societyId: string | null;
            phone: string | null;
        };
    } & {
        createdAt: Date;
        projectId: string;
        contactId: string;
        projectRole: import(".prisma/client").$Enums.ContactRole | null;
    }>;
    updateProjectContact(workspaceId: string, userId: string, projectId: string, contactId: string, dto: UpdateProjectContactDto): Promise<{
        contact: {
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
            } | null;
        } & {
            id: string;
            createdAt: Date;
            workspaceId: string;
            email: string | null;
            firstName: string;
            lastName: string;
            updatedAt: Date;
            role: import(".prisma/client").$Enums.ContactRole | null;
            societyId: string | null;
            phone: string | null;
        };
    } & {
        createdAt: Date;
        projectId: string;
        contactId: string;
        projectRole: import(".prisma/client").$Enums.ContactRole | null;
    }>;
    removeProjectContact(workspaceId: string, userId: string, projectId: string, contactId: string): Promise<{
        success: boolean;
    }>;
    private getProjectOrThrow;
    private getContactOrThrow;
}

import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';
import { LinkProjectContactDto } from './dto/link-project-contact.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectContactDto } from './dto/update-project-contact.dto';
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
        contacts: ({
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
        })[];
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
    create(user: AuthUser, dto: CreateProjectDto): Promise<{
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
    listProjectContacts(user: AuthUser, projectId: string): Promise<({
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
    addProjectContact(user: AuthUser, projectId: string, dto: LinkProjectContactDto): Promise<{
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
    updateProjectContact(user: AuthUser, projectId: string, contactId: string, dto: UpdateProjectContactDto): Promise<{
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
    removeProjectContact(user: AuthUser, projectId: string, contactId: string): Promise<{
        success: boolean;
    }>;
}
export {};

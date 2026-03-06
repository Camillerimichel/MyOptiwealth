import { CreateContactDto } from './dto/create-contact.dto';
import { CreateSocietyDto } from './dto/create-society.dto';
import { CrmService } from './crm.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateSocietyDto } from './dto/update-society.dto';
interface AuthUser {
    sub: string;
    activeWorkspaceId: string;
}
export declare class CrmController {
    private readonly crmService;
    constructor(crmService: CrmService);
    listSocieties(user: AuthUser): Promise<({
        contacts: {
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
        }[];
    } & {
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
    })[]>;
    listSocietiesAll(user: AuthUser): Promise<({
        contacts: {
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
        }[];
    } & {
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
    })[]>;
    createSociety(user: AuthUser, dto: CreateSocietyDto): import(".prisma/client").Prisma.Prisma__SocietyClient<{
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
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    updateSociety(user: AuthUser, societyId: string, dto: UpdateSocietyDto): Promise<({
        contacts: {
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
        }[];
    } & {
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
    }) | null>;
    listContacts(user: AuthUser): Promise<({
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
    })[]>;
    listContactsAll(user: AuthUser): Promise<({
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
    })[]>;
    createContact(user: AuthUser, dto: CreateContactDto): import(".prisma/client").Prisma.Prisma__ContactClient<{
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
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    updateContact(user: AuthUser, contactId: string, dto: UpdateContactDto): Promise<({
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
    }) | null>;
}
export {};

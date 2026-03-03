import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateSocietyDto } from './dto/update-society.dto';
export declare class CrmService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createSociety(workspaceId: string, dto: CreateSocietyDto): import(".prisma/client").Prisma.Prisma__SocietyClient<{
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
    updateSociety(workspaceId: string, societyId: string, dto: UpdateSocietyDto): Promise<({
        contacts: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            email: string | null;
            updatedAt: Date;
            role: import(".prisma/client").$Enums.ContactRole | null;
            societyId: string | null;
            firstName: string;
            lastName: string;
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
    listSocieties(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
        contacts: {
            id: string;
            createdAt: Date;
            workspaceId: string;
            email: string | null;
            updatedAt: Date;
            role: import(".prisma/client").$Enums.ContactRole | null;
            societyId: string | null;
            firstName: string;
            lastName: string;
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
    createContact(workspaceId: string, dto: CreateContactDto): import(".prisma/client").Prisma.Prisma__ContactClient<{
        id: string;
        createdAt: Date;
        workspaceId: string;
        email: string | null;
        updatedAt: Date;
        role: import(".prisma/client").$Enums.ContactRole | null;
        societyId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
    }, never, import("@prisma/client/runtime/library").DefaultArgs, import(".prisma/client").Prisma.PrismaClientOptions>;
    updateContact(workspaceId: string, contactId: string, dto: UpdateContactDto): Promise<({
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
        updatedAt: Date;
        role: import(".prisma/client").$Enums.ContactRole | null;
        societyId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
    }) | null>;
    listContacts(workspaceId: string): import(".prisma/client").Prisma.PrismaPromise<({
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
        updatedAt: Date;
        role: import(".prisma/client").$Enums.ContactRole | null;
        societyId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
    })[]>;
}

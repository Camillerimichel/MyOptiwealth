import { ContactRole } from '@prisma/client';
export declare class CreateContactDto {
    societyId?: string;
    firstName: string;
    lastName: string;
    role?: ContactRole;
    email?: string;
    phone?: string;
}

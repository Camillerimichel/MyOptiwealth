import { ContactRole } from '@prisma/client';
export declare class UpdateContactDto {
    societyId?: string | null;
    firstName?: string;
    lastName?: string;
    role?: ContactRole | null;
    email?: string | null;
    phone?: string | null;
}

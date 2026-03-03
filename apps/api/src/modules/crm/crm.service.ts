import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateSocietyDto } from './dto/update-society.dto';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  createSociety(workspaceId: string, dto: CreateSocietyDto) {
    return this.prisma.society.create({ data: { workspaceId, ...dto } });
  }

  async updateSociety(workspaceId: string, societyId: string, dto: UpdateSocietyDto) {
    const result = await this.prisma.society.updateMany({
      where: { id: societyId, workspaceId },
      data: {
        name: dto.name,
        legalForm: dto.legalForm,
        siren: dto.siren,
        siret: dto.siret,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        postalCode: dto.postalCode,
        city: dto.city,
        country: dto.country,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Societe introuvable dans ce workspace');
    }

    return this.prisma.society.findUnique({
      where: { id: societyId },
      include: { contacts: true },
    });
  }

  listSocieties(workspaceId: string) {
    return this.prisma.society.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { contacts: true },
    });
  }

  createContact(workspaceId: string, dto: CreateContactDto) {
    return this.prisma.contact.create({ data: { workspaceId, ...dto } });
  }

  async updateContact(workspaceId: string, contactId: string, dto: UpdateContactDto) {
    const result = await this.prisma.contact.updateMany({
      where: { id: contactId, workspaceId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
        societyId: dto.societyId ?? undefined,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Contact introuvable dans ce workspace');
    }

    return this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { society: true },
    });
  }

  listContacts(workspaceId: string) {
    return this.prisma.contact.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { society: true },
    });
  }
}

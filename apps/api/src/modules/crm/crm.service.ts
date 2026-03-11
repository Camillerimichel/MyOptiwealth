import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { UpdateSocietyDto } from './dto/update-society.dto';

const collator = new Intl.Collator('fr', { sensitivity: 'base' });

function normalizeForSort(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function compareByName(
  a: { name: string },
  b: { name: string },
): number {
  return collator.compare(normalizeForSort(a.name), normalizeForSort(b.name));
}

function compareContactByFullName(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }): number {
  return compareByName(
    { name: normalizeForSort(`${a.lastName} ${a.firstName}`) },
    { name: normalizeForSort(`${b.lastName} ${b.firstName}`) },
  );
}

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
      include: { contacts: true },
    }).then((societies) => societies.sort(compareByName));
  }

  async listSocietiesAll(userId: string) {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((item) => item.workspaceId);
    if (workspaceIds.length === 0) return [];
    return this.prisma.society.findMany({
      where: { workspaceId: { in: workspaceIds } },
      include: { contacts: true },
    }).then((societies) => societies.sort(compareByName));
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
        branch: dto.branch,
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

  async deleteContact(workspaceId: string, contactId: string) {
    const result = await this.prisma.contact.deleteMany({
      where: { id: contactId, workspaceId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Contact introuvable dans ce workspace');
    }
    return { success: true };
  }

  listContacts(workspaceId: string) {
    return this.prisma.contact.findMany({
      where: { workspaceId },
      include: { society: true },
    }).then((contacts) => contacts.sort(compareContactByFullName));
  }

  async listContactsAll(userId: string) {
    const memberships = await this.prisma.userWorkspaceRole.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((item) => item.workspaceId);
    if (workspaceIds.length === 0) return [];
    return this.prisma.contact.findMany({
      where: { workspaceId: { in: workspaceIds } },
      include: { society: true },
    }).then((contacts) => contacts.sort(compareContactByFullName));
  }
}

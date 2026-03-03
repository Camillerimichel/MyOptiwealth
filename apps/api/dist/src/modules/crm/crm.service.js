"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrmService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
let CrmService = class CrmService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    createSociety(workspaceId, dto) {
        return this.prisma.society.create({ data: { workspaceId, ...dto } });
    }
    async updateSociety(workspaceId, societyId, dto) {
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
            throw new common_1.NotFoundException('Societe introuvable dans ce workspace');
        }
        return this.prisma.society.findUnique({
            where: { id: societyId },
            include: { contacts: true },
        });
    }
    listSocieties(workspaceId) {
        return this.prisma.society.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            include: { contacts: true },
        });
    }
    createContact(workspaceId, dto) {
        return this.prisma.contact.create({ data: { workspaceId, ...dto } });
    }
    async updateContact(workspaceId, contactId, dto) {
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
            throw new common_1.NotFoundException('Contact introuvable dans ce workspace');
        }
        return this.prisma.contact.findUnique({
            where: { id: contactId },
            include: { society: true },
        });
    }
    listContacts(workspaceId) {
        return this.prisma.contact.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            include: { society: true },
        });
    }
};
exports.CrmService = CrmService;
exports.CrmService = CrmService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CrmService);
//# sourceMappingURL=crm.service.js.map
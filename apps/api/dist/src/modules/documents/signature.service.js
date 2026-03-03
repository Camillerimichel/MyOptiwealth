"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureService = void 0;
const common_1 = require("@nestjs/common");
let SignatureService = class SignatureService {
    async sendSignatureRequest(input) {
        if (input.provider === 'MOCK') {
            return this.mockRequest(input.provider);
        }
        if (!input.apiKey || !input.baseUrl) {
            return {
                externalRequestId: `${input.provider.toLowerCase()}_missing_config`,
                state: 'error',
            };
        }
        if (input.provider === 'YOUSIGN') {
            return this.sendViaYousign(input);
        }
        return this.sendViaDocuSign(input);
    }
    async sendViaYousign(input) {
        const response = await fetch(`${input.baseUrl}/signature_requests`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                name: input.documentTitle,
                delivery_mode: 'email',
                signers: [
                    {
                        info: {
                            first_name: input.signerName,
                            email: input.signerEmail,
                        },
                    },
                ],
            }),
        });
        if (!response.ok) {
            return {
                externalRequestId: `yousign_error_${response.status}`,
                state: 'error',
            };
        }
        const payload = (await response.json());
        const id = this.extractId(payload) ?? `yousign_${Date.now()}`;
        return { externalRequestId: id, state: 'sent' };
    }
    async sendViaDocuSign(input) {
        const response = await fetch(`${input.baseUrl}/envelopes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${input.apiKey}`,
            },
            body: JSON.stringify({
                emailSubject: input.documentTitle,
                status: 'sent',
                recipients: {
                    signers: [
                        {
                            email: input.signerEmail,
                            name: input.signerName,
                            recipientId: '1',
                        },
                    ],
                },
            }),
        });
        if (!response.ok) {
            return {
                externalRequestId: `docusign_error_${response.status}`,
                state: 'error',
            };
        }
        const payload = (await response.json());
        const id = this.extractId(payload) ?? `docusign_${Date.now()}`;
        return { externalRequestId: id, state: 'sent' };
    }
    mockRequest(provider) {
        const providerPrefix = provider.toLowerCase();
        const externalRequestId = `${providerPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
            externalRequestId,
            state: 'sent',
        };
    }
    extractId(payload) {
        const id = payload.id ?? payload.signature_request_id ?? payload.envelopeId;
        if (typeof id === 'string' && id.length > 0) {
            return id;
        }
        return null;
    }
};
exports.SignatureService = SignatureService;
exports.SignatureService = SignatureService = __decorate([
    (0, common_1.Injectable)()
], SignatureService);
//# sourceMappingURL=signature.service.js.map
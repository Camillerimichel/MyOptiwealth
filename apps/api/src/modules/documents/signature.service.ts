import { Injectable } from '@nestjs/common';

interface SignatureRequestInput {
  provider: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
  documentTitle: string;
  signerEmail: string;
  signerName: string;
  apiKey?: string;
  baseUrl?: string;
}

interface SignatureRequestOutput {
  externalRequestId: string;
  state: 'sent' | 'error';
}

@Injectable()
export class SignatureService {
  async sendSignatureRequest(input: SignatureRequestInput): Promise<SignatureRequestOutput> {
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

  private async sendViaYousign(input: SignatureRequestInput): Promise<SignatureRequestOutput> {
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

    const payload = (await response.json()) as Record<string, unknown>;
    const id = this.extractId(payload) ?? `yousign_${Date.now()}`;
    return { externalRequestId: id, state: 'sent' };
  }

  private async sendViaDocuSign(input: SignatureRequestInput): Promise<SignatureRequestOutput> {
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

    const payload = (await response.json()) as Record<string, unknown>;
    const id = this.extractId(payload) ?? `docusign_${Date.now()}`;
    return { externalRequestId: id, state: 'sent' };
  }

  private mockRequest(provider: 'MOCK' | 'YOUSIGN' | 'DOCUSIGN'): SignatureRequestOutput {
    const providerPrefix = provider.toLowerCase();
    const externalRequestId = `${providerPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      externalRequestId,
      state: 'sent',
    };
  }

  private extractId(payload: Record<string, unknown>): string | null {
    const id = payload.id ?? payload.signature_request_id ?? payload.envelopeId;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
    return null;
  }
}

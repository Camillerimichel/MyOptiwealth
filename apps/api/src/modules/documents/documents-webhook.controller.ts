import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignatureWebhookDto } from './dto/signature-webhook.dto';
import { DocumentsService } from './documents.service';

@Controller('documents/signature')
export class DocumentsWebhookController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  applyWebhook(
    @Body() dto: SignatureWebhookDto,
    @Headers('x-signature-webhook-token') token?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    const expected = this.configService.get<string>('SIGNATURE_WEBHOOK_TOKEN', 'dev_webhook_token');
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid webhook token');
    }

    if (!workspaceId) {
      throw new UnauthorizedException('Missing workspace id header');
    }

    return this.documentsService.applySignatureWebhook(workspaceId, dto);
  }
}

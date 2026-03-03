export declare class UpdateWorkspaceSettingsDto {
    imapHost?: string;
    imapPort?: number;
    imapUser?: string;
    imapPassword?: string;
    signatureProvider?: 'YOUSIGN' | 'DOCUSIGN' | 'MOCK';
    signatureApiBaseUrl?: string;
    signatureApiKey?: string;
    projectTypologies?: string[];
}

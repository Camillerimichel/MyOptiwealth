declare const MISSION_TYPES: readonly ["WEALTH_STRATEGY", "SUCCESSION", "CORPORATE_FINANCE"];
export declare class CreateProjectDto {
    name: string;
    societyId: string;
    estimatedFees?: string;
    missionType?: (typeof MISSION_TYPES)[number];
}
export {};

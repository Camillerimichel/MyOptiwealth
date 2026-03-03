declare const MISSION_TYPES: readonly ["WEALTH_STRATEGY", "SUCCESSION", "CORPORATE_FINANCE"];
export declare class UpdateProjectDto {
    name?: string;
    missionType?: (typeof MISSION_TYPES)[number];
}
export {};

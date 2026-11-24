export function habitProblems(d: Record<string, unknown>): string[];
export function completionProblems(d: Record<string, unknown>, id: string): string[];
export function noteProblems(d: Record<string, unknown>, id: string): string[];
export function profileExtraFields(d: Record<string, unknown>): string[];
export function ledgerEntryAccepted(d: Record<string, unknown>, id: string): boolean;
export function rewardAccepted(d: Record<string, unknown>): boolean;
export function anonymize(path: string, hash: (s: string) => string): string;

export function syntheticHabits(today: string, options?: { includeRiskProbes?: boolean }): [string, string, Record<string, unknown>][];
export function seedAccount(args: { db: unknown; uid: string; fs: Record<string, unknown>; today: string; includeRiskProbes?: boolean }): Promise<{ habits: number; completions: number; notes: number; ledgerEntries: number }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>;
export function runAudit(db: unknown, options?: { limit?: number; all?: boolean; showPaths?: boolean; hash?: (s: string) => string }): Promise<Report>;

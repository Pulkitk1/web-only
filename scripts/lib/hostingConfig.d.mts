export type HeaderRule = { re: RegExp; source: string; headers: { key: string; value: string }[] };
export type RewriteRule = { re: RegExp; source: string; destination: string };
export type Hosting = {
  kind: 'vercel' | 'firebase';
  config: Record<string, unknown>;
  publicDir: string;
  headerRules: HeaderRule[];
  rewrites: RewriteRule[];
  headerPath: (path: string, isFile: boolean) => string;
};
export function hostingKind(root: string): 'vercel' | 'firebase';
export function loadHosting(root: string, kind?: 'vercel' | 'firebase'): Hosting;
export function resolveRequest(h: Hosting, path: string, exists: (p: string) => boolean): { status: number; file: string; isFile: boolean; headers: Record<string, string> };

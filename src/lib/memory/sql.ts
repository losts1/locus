/** Minimal query surface shared by Neon, PGLite, and node:test. */
export type MailboxSql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

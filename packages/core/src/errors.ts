export type ErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid'
  | 'conflict'
  | 'invalid_transition'
  | 'expired';

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('not_found', `${what} nenalezen`);
export const forbidden = (why = 'Nemáte oprávnění k této akci') => new DomainError('forbidden', why);
export const invalid = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError('invalid', message, details);
export const conflict = (message: string) => new DomainError('conflict', message);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'DomainError');
}

import pg from 'pg';

// https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PgError = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  invalidTextRepresentation: '22P02',
  invalidDatetimeFormat: '22007',
  datetimeFieldOverflow: '22008',
} as const;

export function isPgError(error: unknown, code: string, constraint?: string): error is pg.DatabaseError {
  return (
    error instanceof pg.DatabaseError &&
    error.code === code &&
    (constraint === undefined || error.constraint === constraint)
  );
}

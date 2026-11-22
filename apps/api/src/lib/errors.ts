/** An error with an HTTP status and a stable code the client can branch on. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new HttpError(400, code, message);
export const unauthorized = (message = 'Authentication required', code = 'UNAUTHORIZED') => new HttpError(401, code, message);
export const forbidden = (message = 'You are not allowed to do this', code = 'FORBIDDEN') => new HttpError(403, code, message);
export const notFound = (resource: string) => new HttpError(404, 'NOT_FOUND', `${resource} not found`);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);

/** Returns the row, or throws a 404 naming the resource. */
export function found<T>(row: T | undefined, resource: string): T {
  if (row === undefined) throw notFound(resource);
  return row;
}

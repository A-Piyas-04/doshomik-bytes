import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isPgError, PgError } from '../db/errors';
import { HttpError } from './errors';

// Every error response has the shape { error: { code, message, details? } }.
const errorBody = (code: string, message: string, details?: unknown) => ({ error: { code, message, details } });

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(errorBody(error.code, error.message));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({ path: issue.instancePath, message: issue.message }));
      return reply.status(400).send(errorBody('VALIDATION_ERROR', 'Invalid request', details));
    }

    if (error instanceof z.ZodError) {
      const details = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return reply.status(400).send(errorBody('VALIDATION_ERROR', 'Invalid request', details));
    }

    // The schema's constraints are the last line of defence; report their failures as client errors.
    if (isPgError(error, PgError.uniqueViolation)) {
      return reply.status(409).send(errorBody('ALREADY_EXISTS', 'This already exists'));
    }
    if (isPgError(error, PgError.foreignKeyViolation)) {
      return error.detail?.includes('is still referenced')
        ? reply.status(409).send(errorBody('IN_USE', 'Other records still use this'))
        : reply.status(400).send(errorBody('INVALID_REFERENCE', 'A referenced record does not exist'));
    }
    if (
      [
        PgError.checkViolation,
        PgError.notNullViolation,
        PgError.invalidTextRepresentation,
        PgError.invalidDatetimeFormat,
        PgError.datetimeFieldOverflow,
      ].some((code) => isPgError(error, code))
    ) {
      return reply.status(400).send(errorBody('INVALID_DATA', 'The data breaks a validation rule'));
    }

    // Fastify and plugin errors (bad JSON, payload too large, rate limit) carry their own status.
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send(errorBody(error.code ?? 'REQUEST_ERROR', error.message));
    }

    request.log.error(error);
    return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Something went wrong'));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody('NOT_FOUND', 'Route not found')));
}

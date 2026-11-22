import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isPgError, PgError } from '../db/errors';
import { HttpError } from './errors';

// Every error response is { error: { code, message, request_id, details? } }. Never a stack trace;
// the request id lets support find the full error in the logs.

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      sendError(reply, status, code, message, details);

    if (error instanceof HttpError) return send(error.statusCode, error.code, error.message);

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({ path: issue.instancePath, message: issue.message }));
      return send(400, 'VALIDATION_ERROR', 'Invalid request', details);
    }
    if (error instanceof z.ZodError) {
      const details = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
      return send(400, 'VALIDATION_ERROR', 'Invalid request', details);
    }

    // The schema's constraints are the last line of defence; report their failures as client errors.
    if (isPgError(error, PgError.uniqueViolation)) return send(409, 'ALREADY_EXISTS', 'This already exists');
    if (isPgError(error, PgError.foreignKeyViolation)) {
      return error.detail?.includes('is still referenced')
        ? send(409, 'IN_USE', 'Other records still use this')
        : send(400, 'INVALID_REFERENCE', 'A referenced record does not exist');
    }
    const invalidData = [
      PgError.checkViolation,
      PgError.notNullViolation,
      PgError.invalidTextRepresentation,
      PgError.invalidDatetimeFormat,
      PgError.datetimeFieldOverflow,
    ];
    if (invalidData.some((code) => isPgError(error, code))) {
      return send(400, 'INVALID_DATA', 'The data breaks a validation rule');
    }

    // Fastify and plugin errors (bad JSON, payload too large, rate limit) carry their own status.
    if (error.statusCode && error.statusCode < 500) {
      return send(error.statusCode, error.code ?? 'REQUEST_ERROR', error.message);
    }

    request.log.error(error);
    return send(500, 'INTERNAL_ERROR', 'Something went wrong');
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND', 'Route not found'));
}

function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  return reply.status(status).send({ error: { code, message, request_id: reply.request.id, details } });
}

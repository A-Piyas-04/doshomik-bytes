import { REPORT_REASONS, REPORT_TARGET_TYPES } from '@doshomik/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { perUser } from '../../lib/rate-limits';
import { optionalText, publicId } from '../../lib/validation';
import { createReport } from './reports.service';

const ReportBody = z.object({
  target_type: z.enum(REPORT_TARGET_TYPES),
  target_id: publicId,
  reason: z.enum(REPORT_REASONS),
  details: optionalText(1000),
});

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/reports', { config: perUser(20, '1 hour'), schema: { body: ReportBody } }, async (request, reply) => {
    const result = await createReport(request.auth.userId, { ...request.body, details: request.body.details ?? null });
    return reply.status(result.created ? 201 : 200).send({ status: result.status });
  });
};

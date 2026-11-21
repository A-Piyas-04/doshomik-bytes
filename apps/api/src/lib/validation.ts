import { z } from 'zod';

export const id = z.coerce.number().int().positive();
export const idParams = z.object({ id });

/** Required text, trimmed. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** Optional text for create and update bodies: an empty string clears the value (null). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === '' ? null : value));

export const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/** Makes every field optional and rejects an empty update. */
export const updateOf = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.partial().refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

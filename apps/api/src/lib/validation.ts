import { z } from 'zod';

/** Public ids (UUIDs). The API never accepts or returns the internal numeric ids. */
export const publicId = z.uuid();
export const idParams = z.object({ id: publicId });

/** Readable ids for topics and fields, such as "attention-mechanism". */
export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes')
  .max(80);
export const slugParams = z.object({ slug });

/** Staff-only records without a public id (reports). */
export const numericIdParams = z.object({ id: z.coerce.number().int().positive() });

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

/** A list of public ids with no repeats. */
export const uniqueIds = (max: number) =>
  z
    .array(publicId)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Each id can appear once');

/** Makes every field optional and rejects an empty update. */
export const updateOf = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.partial().refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

/** Turns a name into a slug ("Attention mechanism" → "attention-mechanism"). Empty for names with no ASCII letters. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

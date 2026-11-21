import argon2 from 'argon2';
import { db } from '../../db';
import { isPgError, PgError } from '../../db/errors';
import { conflict } from '../../lib/errors';
import { ACCOUNT_COLUMNS } from '../users/users.service';

export async function createUser(input: { email: string; username: string; password: string }) {
  const passwordHash = await argon2.hash(input.password);
  try {
    return await db
      .insertInto('users')
      .values({ email: input.email, username: input.username, password_hash: passwordHash })
      .returning(ACCOUNT_COLUMNS)
      .executeTakeFirstOrThrow();
  } catch (error) {
    if (isPgError(error, PgError.uniqueViolation, 'users_username_key')) {
      throw conflict('That username is taken', 'USERNAME_TAKEN');
    }
    if (isPgError(error, PgError.uniqueViolation, 'users_email_key')) {
      throw conflict('An account with that email already exists', 'EMAIL_TAKEN');
    }
    throw error;
  }
}

/** Finds the account by email or username and checks the password. Returns null on any mismatch. */
export async function verifyCredentials(login: string, password: string) {
  const row = await db
    .selectFrom('users')
    .select([...ACCOUNT_COLUMNS, 'password_hash'])
    .where((eb) => eb.or([eb('email', '=', login), eb('username', '=', login)]))
    .executeTakeFirst();

  if (!row || !(await argon2.verify(row.password_hash, password))) return null;
  const { password_hash: _, ...account } = row;
  return account;
}

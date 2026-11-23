import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { scholarlySources, type ScholarlySources } from './scholarly';

// Outside services, each behind a small interface. The local stand-ins let everything run
// without accounts; tests swap them for fakes through `providers`.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}
export interface PushSender {
  send(deviceTokens: string[], message: PushMessage): Promise<void>;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}
export interface GoogleVerifier {
  /** Checks the ID token's signature, audience, issuer and expiry. Throws if any is wrong. */
  verify(idToken: string): Promise<GoogleIdentity>;
}

class SmtpEmail implements EmailSender {
  private readonly transport = nodemailer.createTransport(env.SMTP_URL);
  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: env.EMAIL_FROM, ...message });
  }
}

/** Development: each email becomes a text file in DEV_MAIL_DIR, so links can be opened by hand. */
class DevMailbox implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    await mkdir(env.DEV_MAIL_DIR, { recursive: true });
    const file = path.join(env.DEV_MAIL_DIR, `${Date.now()}-${message.subject.replace(/\W+/g, '-').toLowerCase()}.txt`);
    await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
  }
}

/** Until Firebase Cloud Messaging is set up: logs what would be pushed (never the device tokens). */
class DevPush implements PushSender {
  async send(deviceTokens: string[], message: PushMessage): Promise<void> {
    await mkdir(env.DEV_MAIL_DIR, { recursive: true });
    const line = `${new Date().toISOString()} push to ${deviceTokens.length} device(s): ${message.title} - ${message.body}\n`;
    await appendFile(path.join(env.DEV_MAIL_DIR, 'push.log'), line);
  }
}

class GoogleIdTokens implements GoogleVerifier {
  private readonly keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (env.GOOGLE_CLIENT_IDS.length === 0) throw new Error('Google sign-in is not configured');
    const { payload } = await jwtVerify(idToken, this.keys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_IDS,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') throw new Error('Incomplete Google token');
    return { subject: payload.sub, email: payload.email, emailVerified: payload.email_verified === true };
  }
}

export const providers: { email: EmailSender; push: PushSender; google: GoogleVerifier; scholarly: ScholarlySources } = {
  email: env.SMTP_URL ? new SmtpEmail() : new DevMailbox(),
  push: new DevPush(),
  google: new GoogleIdTokens(),
  /** Paper ingestion sources; only the worker calls them. */
  scholarly: scholarlySources(),
};

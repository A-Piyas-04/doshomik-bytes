import type { NotificationType } from '@doshomik/shared';
import { db, type Db } from '../db';
import { providers, type PushMessage } from '../providers';

/** Work to do after the event's transaction commits (push, email). Failures are logged, not retried. */
export type SideEffect = () => Promise<void>;

const MESSAGES: Record<NotificationType, (actor: string) => Omit<PushMessage, 'data'>> = {
  follow: (actor) => ({ title: 'New follower', body: `${actor} started following you` }),
  follow_request: (actor) => ({ title: 'Follow request', body: `${actor} wants to follow you` }),
  like: (actor) => ({ title: 'New like', body: `${actor} liked your post` }),
  comment: (actor) => ({ title: 'New comment', body: `${actor} commented on your post` }),
  reply: (actor) => ({ title: 'New reply', body: `${actor} replied to your comment` }),
  post_ready: () => ({ title: 'Your post is live', body: 'Your post finished processing and is now visible' }),
};

/**
 * Records an in-app notification and returns the push to send after commit. Skips alerts for your
 * own actions (except "post ready"), for inactive recipients, and between users who blocked each other.
 */
export async function notify(
  trx: Db,
  alert: { userId: number; actorId: number; type: NotificationType; postId?: number | null; commentId?: number | null },
): Promise<SideEffect | null> {
  if (alert.userId === alert.actorId && alert.type !== 'post_ready') return null;

  const people = await trx
    .selectFrom('users as recipient')
    .innerJoin('users as actor', (join) => join.on('actor.id', '=', alert.actorId))
    .select(['recipient.status', 'actor.username as actorName'])
    .where('recipient.id', '=', alert.userId)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('blocks')
            .select('blocker_id')
            .where((b) =>
              b.or([
                b.and([b('blocker_id', '=', alert.userId), b('blocked_id', '=', alert.actorId)]),
                b.and([b('blocker_id', '=', alert.actorId), b('blocked_id', '=', alert.userId)]),
              ]),
            ),
        ),
      ),
    )
    .executeTakeFirst();
  if (!people || people.status !== 'active') return null;

  const notification = await trx
    .insertInto('notifications')
    .values({
      user_id: alert.userId,
      actor_id: alert.actorId,
      type: alert.type,
      post_id: alert.postId ?? null,
      comment_id: alert.commentId ?? null,
    })
    .returning('public_id')
    .executeTakeFirstOrThrow();

  const message = { ...MESSAGES[alert.type](people.actorName), data: { type: alert.type, notification_id: notification.public_id } };
  return () => pushToUser(alert.userId, message);
}

/** Sends to every signed-in device of the user that registered a push token. */
async function pushToUser(userId: number, message: PushMessage): Promise<void> {
  const devices = await db
    .selectFrom('sessions')
    .select('push_token')
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .where('push_token', 'is not', null)
    .execute();
  if (devices.length) await providers.push.send(devices.map((d) => d.push_token!), message);
}

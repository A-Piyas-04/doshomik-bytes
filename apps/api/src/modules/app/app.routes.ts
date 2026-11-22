import type { FastifyPluginAsync } from 'fastify';
import { env } from '../../config/env';
import { notFound } from '../../lib/errors';

/** GET /v1/app/config: lets the app require an update after a security fix. */
export const appConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get('/app/config', async () => ({
    min_version: { android: env.MIN_APP_VERSION_ANDROID, ios: env.MIN_APP_VERSION_IOS },
  }));
};

/**
 * Share links (/p/:id, /papers/:id, /courses/:id) open the app through Android App Links.
 * Without the app installed, they land here and go to the Play Store listing.
 */
export const deepLinkRoutes: FastifyPluginAsync = async (app) => {
  app.get('/.well-known/assetlinks.json', async () => {
    if (!env.ANDROID_PACKAGE_NAME) throw notFound('App links');
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: env.ANDROID_PACKAGE_NAME,
          sha256_cert_fingerprints: env.ANDROID_CERT_FINGERPRINTS,
        },
      },
    ];
  });

  for (const path of ['/p/:id', '/papers/:id', '/courses/:id']) {
    app.get(path, async (_request, reply) => {
      if (!env.ANDROID_PACKAGE_NAME) throw notFound('App');
      return reply.redirect(`https://play.google.com/store/apps/details?id=${encodeURIComponent(env.ANDROID_PACKAGE_NAME)}`);
    });
  }
};

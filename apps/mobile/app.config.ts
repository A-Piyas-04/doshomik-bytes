import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config. Static values live in app.json; everything that differs
 * between build variants is decided here.
 *
 * APP_VARIANT is set per build profile in eas.json, so a development, preview
 * and production app can sit side by side on the same phone without replacing
 * each other. `com.doshomik.bytes` (production) is the permanent Play Store
 * identity and must never change.
 */
const variant = process.env.APP_VARIANT ?? 'production';

const PACKAGE_ID = 'com.doshomik.bytes';

const variants = {
  development: { name: 'Doshomik Bytes (Dev)', package: `${PACKAGE_ID}.dev` },
  preview: { name: 'Doshomik Bytes (Preview)', package: `${PACKAGE_ID}.preview` },
  production: { name: 'Doshomik Bytes', package: PACKAGE_ID },
} as const;

function resolve(name: string) {
  if (name in variants) return variants[name as keyof typeof variants];
  throw new Error(`Unknown APP_VARIANT "${name}". Expected development, preview or production.`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const { name, package: androidPackage } = resolve(variant);

  return {
    ...config,
    name,
    slug: config.slug ?? 'doshomik-bytes',
    android: { ...config.android, package: androidPackage },
  };
};

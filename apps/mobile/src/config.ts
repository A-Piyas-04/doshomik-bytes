import { Platform } from 'react-native';

/**
 * Where the API lives. Never hardcode a host in a screen: this is the only
 * place a host is resolved, so dev, preview and the VPS differ by config only.
 *
 * `EXPO_PUBLIC_API_URL` is inlined at bundle time (see .env). Without it, the
 * fallback is localhost, which on the Android emulator means the host machine
 * at 10.0.2.2. A physical device needs the LAN IP set in .env.
 */
const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallback).replace(/\/$/, '');

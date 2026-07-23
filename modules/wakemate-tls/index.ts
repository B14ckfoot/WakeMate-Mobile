import { requireOptionalNativeModule } from 'expo-modules-core';

export type PinnedHttpsResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type WakemateTlsNativeModule = {
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    fingerprint: string,
    timeoutMs: number
  ): Promise<PinnedHttpsResponse>;
};

const nativeModule =
  requireOptionalNativeModule<WakemateTlsNativeModule>('WakemateTls');

export async function requestPinnedHttps(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  fingerprint: string,
  timeoutMs: number
): Promise<PinnedHttpsResponse> {
  if (!nativeModule) {
    throw new Error(
      'Pinned HTTPS requires a current WakeMATE native build. Rebuild the app after installing Stage 2.'
    );
  }

  return nativeModule.request(url, method, headers, body, fingerprint, timeoutMs);
}

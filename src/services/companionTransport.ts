import axios from 'axios';
import { requestPinnedHttps } from '../../modules/wakemate-tls';

type CompanionHttpMethod = 'GET' | 'POST';

export const SECURE_PAIRING_REQUIRED_MESSAGE =
  'Secure pairing is missing or invalid. Update WakeMATE Companion and scan its current pairing QR code from the Devices screen before using controls.';

export const SECURE_STORAGE_UNAVAILABLE_MESSAGE =
  'Secure credential storage is unavailable. Unlock this phone and reopen WakeMATE; if the problem continues, scan the computer\u2019s pairing QR code again.';

export type CompanionTransportResponse<T> = {
  data: T;
  status: number;
  headers: Record<string, string>;
};

type CompanionRequestOptions = {
  ip: string;
  port: number;
  path: string;
  method?: CompanionHttpMethod;
  headers?: Record<string, string>;
  data?: unknown;
  timeoutMs: number;
  tlsFingerprint?: string | null;
};

export const normalizeTlsFingerprint = (
  value: string | null | undefined
): string | null => {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/^sha256:/, '')
    .replace(/:/g, '');

  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
};

export const buildCompanionBaseUrl = (
  ip: string,
  port: number,
  tlsFingerprint?: string | null
): string => {
  const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
  return `${normalizeTlsFingerprint(tlsFingerprint) ? 'https' : 'http'}://${host}:${port}`;
};

const parseResponseBody = (body: string): unknown => {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const createHttpStatusError = (
  status: number,
  data: unknown,
  url: string
): Error => {
  const error = new Error(`Companion request failed with status ${status}`) as Error & {
    isAxiosError: boolean;
    response: {
      status: number;
      data: unknown;
      config: { url: string };
    };
  };
  error.isAxiosError = true;
  error.response = {
    status,
    data,
    config: { url },
  };
  return error;
};

export async function requestCompanion<T>({
  ip,
  port,
  path,
  method = 'GET',
  headers = {},
  data,
  timeoutMs,
  tlsFingerprint,
}: CompanionRequestOptions): Promise<CompanionTransportResponse<T>> {
  const fingerprint = normalizeTlsFingerprint(tlsFingerprint);
  const requestPath = path.startsWith('/') ? path : `/${path}`;
  const hasCredentials = Object.keys(headers).some((name) =>
    ['x-wakemate-token', 'authorization', 'proxy-authorization', 'cookie'].includes(
      name.toLowerCase()
    )
  );
  // Only the public health probe may use plaintext. In particular, a missing
  // keychain entry is never permission to send a saved credential over HTTP.
  // Reject malformed supplied pins even for public probes instead of erasing
  // the caller's expectation that this connection was secured.
  const publicHealthProbe = method === 'GET' && requestPath === '/v1/health' && !hasCredentials && data == null;
  if (!fingerprint && (tlsFingerprint != null || !publicHealthProbe)) {
    throw new Error(SECURE_PAIRING_REQUIRED_MESSAGE);
  }
  const baseUrl = buildCompanionBaseUrl(ip, port, fingerprint);
  const url = `${baseUrl}${requestPath}`;

  if (!fingerprint) {
    const response = await axios.request<T>({
      url,
      method,
      headers,
      data,
      timeout: timeoutMs,
    });
    return {
      data: response.data,
      status: response.status,
      headers: response.headers as Record<string, string>,
    };
  }

  const requestHeaders = { ...headers };
  let body: string | null = null;
  if (data !== undefined && data !== null) {
    body = typeof data === 'string' ? data : JSON.stringify(data);
    if (
      !Object.keys(requestHeaders).some(
        (name) => name.toLowerCase() === 'content-type'
      )
    ) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }

  const response = await requestPinnedHttps(
    url,
    method,
    requestHeaders,
    body,
    fingerprint,
    timeoutMs
  );
  const responseData = parseResponseBody(response.body);

  if (response.status < 200 || response.status >= 300) {
    throw createHttpStatusError(response.status, responseData, url);
  }

  return {
    data: responseData as T,
    status: response.status,
    headers: response.headers,
  };
}

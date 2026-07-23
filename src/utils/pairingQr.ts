import { normalizeTlsFingerprint } from '../services/companionTransport';
import { isValidIpAddress } from './deviceNetwork';

const SCANNABLE_TOKEN_KEYS = [
  'api_token',
  'token',
  'pairing_token',
  'pairingToken',
  'serverToken',
] as const;

const getScannableString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const extractTokenFromObject = (value: Record<string, unknown>): string | null => {
  for (const key of SCANNABLE_TOKEN_KEYS) {
    const token = getScannableString(value[key]);
    if (token) {
      return token;
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (
      nestedValue &&
      typeof nestedValue === 'object' &&
      !Array.isArray(nestedValue)
    ) {
      const token = extractTokenFromObject(
        nestedValue as Record<string, unknown>
      );
      if (token) {
        return token;
      }
    }
  }

  return null;
};

const parsePort = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : null;
};

export const extractTokenFromQrData = (rawData: string): string | null => {
  const trimmedData = rawData.trim();
  if (!trimmedData) {
    return null;
  }

  try {
    const parsedData = JSON.parse(trimmedData);
    if (
      parsedData &&
      typeof parsedData === 'object' &&
      !Array.isArray(parsedData)
    ) {
      const tokenFromJson = extractTokenFromObject(
        parsedData as Record<string, unknown>
      );
      if (tokenFromJson) {
        return tokenFromJson;
      }
    }
  } catch {
    // The QR code may contain a raw token or URL instead of JSON.
  }

  const queryParamMatch = trimmedData.match(
    /(?:^|[?&#])(?:api_token|token|pairing_token|pairingToken|serverToken)=([^&#]+)/i
  );
  if (queryParamMatch?.[1]) {
    try {
      return decodeURIComponent(queryParamMatch[1]).trim();
    } catch {
      return queryParamMatch[1].trim();
    }
  }

  const keyedValueMatch = trimmedData.match(
    /(?:api_token|token|pairing_token|pairingToken|serverToken)\s*[:=]\s*["']?([^"'\s,}]+)/i
  );
  if (keyedValueMatch?.[1]) {
    return keyedValueMatch[1].trim();
  }

  const firstNonEmptyLine = trimmedData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstNonEmptyLine && !/\s/.test(firstNonEmptyLine)) {
    return firstNonEmptyLine;
  }

  return null;
};

export type PairingQrConnection = {
  token: string | null;
  ip: string | null;
  apiPort: number | null;
  tlsPort: number | null;
  tlsFingerprint: string | null;
  hasTlsMetadata: boolean;
  hasValidTlsMetadata: boolean;
};

export const parsePairingQrConnection = (
  rawData: string
): PairingQrConnection => {
  const token = extractTokenFromQrData(rawData);
  let record: Record<string, unknown> | null = null;

  try {
    const parsed = JSON.parse(rawData);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      record = parsed as Record<string, unknown>;
    }
  } catch {
    // Legacy raw-token and URL formats have no transport metadata.
  }

  const ipValue = getScannableString(record?.ip);
  const ip = ipValue && isValidIpAddress(ipValue) ? ipValue : null;
  const apiPort = parsePort(record?.api_port ?? record?.port);
  const tlsPort = parsePort(record?.tls_port ?? record?.https_port);
  const rawFingerprint =
    record?.fp ?? record?.tls_fingerprint ?? record?.certificate_fingerprint;
  const tlsFingerprint =
    typeof rawFingerprint === 'string'
      ? normalizeTlsFingerprint(rawFingerprint)
      : null;
  const hasTlsMetadata =
    rawFingerprint !== undefined ||
    record?.tls_port !== undefined ||
    record?.https_port !== undefined;

  return {
    token,
    ip,
    apiPort,
    tlsPort,
    tlsFingerprint,
    hasTlsMetadata,
    hasValidTlsMetadata:
      !hasTlsMetadata || Boolean(tlsPort && tlsFingerprint),
  };
};

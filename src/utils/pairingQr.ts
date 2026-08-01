import { normalizeTlsFingerprint } from '../services/companionTransport';
import { isValidIpAddress } from './deviceNetwork';

/**
 * Hosts the companion's pairing Universal Link may use. Kept as a list (not
 * a single constant) so a future domain migration can accept both the old
 * and new host during the transition instead of breaking scans mid-rollout.
 */
const PAIRING_LINK_HOSTS = ['wakematemobile.com', 'www.wakematemobile.com'];
const PAIRING_LINK_PATH = '/pair';
/** Custom-scheme fallback for the same `/pair` flow (e.g. shared outside a
 * QR scan). Not used for the QR itself -- see companion tray.rs -- but the
 * in-app scanner and deep-link handler both accept it. */
const PAIRING_LINK_SCHEME = 'wakemate';

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

/**
 * Fields carried by the pairing Universal Link / custom-scheme link (QR
 * contract v3): `https://<domain>/pair?v=3&token=...&name=...&api_port=...
 * &tls_port=...&fp=...&ip=...&mac=...`. Replaces the raw-JSON QR (contract
 * v2) so the native iPhone Camera app can recognize and open the code; see
 * WakeMATE-Companion/src/tray.rs `pairing_qr_payload_from_parts` for the
 * producer side.
 */
export type PairingLinkPayload = {
  token: string;
  name: string | null;
  ip: string | null;
  apiPort: number | null;
  tlsPort: number | null;
  tlsFingerprint: string | null;
  mac: string | null;
  version: number | null;
};

const isPairingLinkUrl = (url: URL): boolean => {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (url.protocol === 'https:') {
    return PAIRING_LINK_HOSTS.includes(url.hostname.toLowerCase()) && path === PAIRING_LINK_PATH;
  }

  if (url.protocol === `${PAIRING_LINK_SCHEME}:`) {
    // React Native's URL parser puts a custom scheme's first path segment in
    // `hostname` (e.g. `wakemate://pair` -> hostname "pair", pathname ""),
    // so accept either that or a conventional `/pair` path.
    return url.hostname.toLowerCase() === 'pair' || path === PAIRING_LINK_PATH;
  }

  return false;
};

/**
 * Parses the pairing Universal Link / custom-scheme link. Returns null for
 * anything that is not a recognized pairing link (including plain JSON or a
 * bare token), so callers can fall back to the legacy formats.
 */
export const parsePairingLink = (rawData: string): PairingLinkPayload | null => {
  let url: URL;
  try {
    url = new URL(rawData.trim());
  } catch {
    return null;
  }

  if (!isPairingLinkUrl(url)) {
    return null;
  }

  const token = getScannableString(url.searchParams.get('token'));
  if (!token) {
    return null;
  }

  const ipValue = url.searchParams.get('ip');
  const macValue = url.searchParams.get('mac');
  const versionValue = url.searchParams.get('v');
  const parsedVersion = versionValue ? Number.parseInt(versionValue, 10) : NaN;

  return {
    token,
    name: getScannableString(url.searchParams.get('name')),
    ip: ipValue && isValidIpAddress(ipValue) ? ipValue : null,
    apiPort: parsePort(url.searchParams.get('api_port')),
    tlsPort: parsePort(url.searchParams.get('tls_port')),
    tlsFingerprint: normalizeTlsFingerprint(url.searchParams.get('fp')),
    mac: getScannableString(macValue),
    version: Number.isInteger(parsedVersion) ? parsedVersion : null,
  };
};

/** Reshapes a parsed pairing link into the plain-object form the JSON-based
 * device-metadata extractor (`extractCompanionFields`) already understands,
 * so both QR formats can share one "save this device" code path. */
export const pairingLinkToRecord = (link: PairingLinkPayload): Record<string, unknown> => ({
  token: link.token,
  name: link.name ?? undefined,
  ip: link.ip ?? undefined,
  api_port: link.apiPort ?? undefined,
  tls_port: link.tlsPort ?? undefined,
  fp: link.tlsFingerprint ?? undefined,
  mac: link.mac ?? undefined,
});

/** Reshapes a parsed pairing link into the same connection-metadata shape
 * `parsePairingQrConnection` produces from a raw string, so a link handed
 * to the app pre-parsed (e.g. Expo Router's route params for `/pair`) can
 * feed the same pairing flow as a freshly-scanned QR string. */
export const pairingLinkToConnection = (link: PairingLinkPayload): PairingQrConnection => {
  const hasTlsMetadata = link.tlsFingerprint !== null || link.tlsPort !== null;
  return {
    token: link.token,
    ip: link.ip,
    apiPort: link.apiPort,
    tlsPort: link.tlsPort,
    tlsFingerprint: link.tlsFingerprint,
    hasTlsMetadata,
    hasValidTlsMetadata: !hasTlsMetadata || Boolean(link.tlsPort && link.tlsFingerprint),
  };
};

/** Builds a {@link PairingLinkPayload} directly from Expo Router's parsed
 * route params for `/pair` (i.e. `useLocalSearchParams()`), for the
 * deep-link entry point where the URL has already been parsed by the
 * router and reconstructing then re-parsing a raw string would be lossy. */
export const pairingLinkFromParams = (
  params: Record<string, string | string[] | undefined>
): PairingLinkPayload | null => {
  const getParam = (key: string): string | null => {
    const value = params[key];
    const raw = Array.isArray(value) ? value[0] : value;
    return getScannableString(raw ?? null);
  };

  const token = getParam('token');
  if (!token) {
    return null;
  }

  const ipValue = getParam('ip');
  const versionValue = getParam('v');
  const parsedVersion = versionValue ? Number.parseInt(versionValue, 10) : NaN;

  return {
    token,
    name: getParam('name'),
    ip: ipValue && isValidIpAddress(ipValue) ? ipValue : null,
    apiPort: parsePort(getParam('api_port')),
    tlsPort: parsePort(getParam('tls_port')),
    tlsFingerprint: normalizeTlsFingerprint(getParam('fp')),
    mac: getParam('mac'),
    version: Number.isInteger(parsedVersion) ? parsedVersion : null,
  };
};

export const extractTokenFromQrData = (rawData: string): string | null => {
  const trimmedData = rawData.trim();
  if (!trimmedData) {
    return null;
  }

  const link = parsePairingLink(trimmedData);
  if (link) {
    return link.token;
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

  const link = parsePairingLink(rawData);
  if (link) {
    record = pairingLinkToRecord(link);
  } else {
    try {
      const parsed = JSON.parse(rawData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      // Legacy raw-token formats have no transport metadata.
    }
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

import { normalizeTlsFingerprint } from '../services/companionTransport';
import {
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
} from './deviceNetwork';

const PAIRING_QR_KIND = 'wakemate-pairing' as const;
const SUPPORTED_PAIRING_QR_VERSIONS = [2, 3] as const;

const SCANNABLE_TOKEN_KEYS = [
  'api_token',
  'token',
  'pairing_token',
  'pairingToken',
  'serverToken',
] as const;

export type PairingQrConnection = {
  token: string | null;
  ip: string | null;
  apiPort: number | null;
  tlsPort: number | null;
  tlsFingerprint: string | null;
  hasTlsMetadata: boolean;
  hasValidTlsMetadata: boolean;
};

const getScannableString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const parseStrictPort = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 && value <= 65535
      ? value
      : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsed = Number(trimmedValue);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : null;
};

type ParsedAliasedField<T> = {
  present: boolean;
  value: T | null;
};

const parseAliasedField = <T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  normalize: (value: unknown) => T | null
): ParsedAliasedField<T> => {
  const normalizedValues: T[] = [];
  let present = false;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }

    present = true;
    const normalized = normalize(record[key]);
    if (normalized === null) {
      return { present, value: null };
    }
    normalizedValues.push(normalized);
  }

  if (!present) {
    return { present: false, value: null };
  }

  const firstValue = normalizedValues[0];
  if (
    firstValue === undefined ||
    normalizedValues.some((value) => value !== firstValue)
  ) {
    return { present: true, value: null };
  }

  return { present: true, value: firstValue };
};

export type PairingQrVersion = (typeof SUPPORTED_PAIRING_QR_VERSIONS)[number];

export type PairingQrParseErrorCode =
  | 'malformed'
  | 'foreign_kind'
  | 'unsupported_version'
  | 'invalid_name'
  | 'missing_token'
  | 'invalid_ip'
  | 'invalid_mac'
  | 'invalid_api_port'
  | 'invalid_tls_metadata';

export type NormalizedPairingQr = {
  version: PairingQrVersion;
  deviceName: string;
  deviceMac: string | null;
  connection: PairingQrConnection & { token: string };
};

export type PairingQrParseResult =
  | { ok: true; value: NormalizedPairingQr }
  | {
      ok: false;
      error: {
        code: PairingQrParseErrorCode;
        message: string;
      };
    };

const pairingQrFailure = (
  code: PairingQrParseErrorCode,
  message: string
): PairingQrParseResult => ({
  ok: false,
  error: { code, message },
});

/**
 * Parses only WakeMATE's structured, local QR contract. Contract v2 remains
 * valid for older companions and may omit TLS entirely. Contract v3 must
 * always carry a complete TLS pin so a current pairing can never downgrade
 * to plaintext. URLs, bare tokens, foreign JSON, and ambiguous aliases are
 * intentionally rejected before any discovery, storage, or network work.
 */
export const parseStructuredPairingQr = (
  rawData: string
): PairingQrParseResult => {
  let record: Record<string, unknown>;

  try {
    const parsed = JSON.parse(rawData);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return pairingQrFailure(
        'malformed',
        'Scan the current structured device QR code from the WakeMATE companion.'
      );
    }
    record = parsed as Record<string, unknown>;
  } catch {
    return pairingQrFailure(
      'malformed',
      'Scan the current structured device QR code from the WakeMATE companion. Bare tokens and web links are not supported pairing codes.'
    );
  }

  if (record.kind !== PAIRING_QR_KIND) {
    return pairingQrFailure(
      'foreign_kind',
      'This is not a WakeMATE device pairing code. Scan the code shown by the WakeMATE companion.'
    );
  }

  if (
    typeof record.v !== 'number' ||
    !SUPPORTED_PAIRING_QR_VERSIONS.includes(record.v as PairingQrVersion)
  ) {
    return pairingQrFailure(
      'unsupported_version',
      'This WakeMATE pairing-code version is not supported. Update WakeMATE on the phone and computer, then regenerate the code.'
    );
  }
  const version = record.v as PairingQrVersion;

  const deviceName = getScannableString(record.name);
  if (!deviceName) {
    return pairingQrFailure(
      'invalid_name',
      'This WakeMATE pairing code is missing a valid computer name. Regenerate it from the companion.'
    );
  }

  const tokenField = parseAliasedField(
    record,
    SCANNABLE_TOKEN_KEYS,
    getScannableString
  );
  if (!tokenField.present || !tokenField.value) {
    return pairingQrFailure(
      'missing_token',
      'This WakeMATE pairing code is missing a valid pairing token. Regenerate it from the companion.'
    );
  }

  const ipField = parseAliasedField(record, ['ip'], (value) => {
    const ip = getScannableString(value);
    return ip && isValidIpAddress(ip) ? ip : null;
  });
  if (ipField.present && !ipField.value) {
    return pairingQrFailure(
      'invalid_ip',
      'This WakeMATE pairing code contains an invalid computer IP address. Regenerate it from the companion.'
    );
  }

  const macField = parseAliasedField(record, ['mac'], (value) => {
    const mac = getScannableString(value);
    if (!mac || !isValidMacAddress(mac)) {
      return null;
    }
    return normalizeMacAddress(mac);
  });
  if (macField.present && !macField.value) {
    return pairingQrFailure(
      'invalid_mac',
      'This WakeMATE pairing code contains an invalid computer MAC address. Regenerate it from the companion.'
    );
  }

  const apiPortField = parseAliasedField(
    record,
    ['api_port', 'port'],
    parseStrictPort
  );
  if (!apiPortField.present || !apiPortField.value) {
    return pairingQrFailure(
      'invalid_api_port',
      'This WakeMATE pairing code is missing a valid companion API port. Regenerate it from the companion.'
    );
  }

  const tlsPortField = parseAliasedField(
    record,
    ['tls_port', 'https_port'],
    parseStrictPort
  );
  const tlsFingerprintField = parseAliasedField(
    record,
    ['fp', 'tls_fingerprint', 'certificate_fingerprint'],
    (value) =>
      typeof value === 'string' ? normalizeTlsFingerprint(value) : null
  );
  const hasTlsMetadata = tlsPortField.present || tlsFingerprintField.present;
  const hasCompleteTlsMetadata = Boolean(
    tlsPortField.value && tlsFingerprintField.value
  );

  if (
    (hasTlsMetadata && !hasCompleteTlsMetadata) ||
    (version === 3 && !hasCompleteTlsMetadata)
  ) {
    return pairingQrFailure(
      'invalid_tls_metadata',
      'This QR code is missing a valid TLS port or certificate fingerprint. Regenerate it from the WakeMATE companion.'
    );
  }

  return {
    ok: true,
    value: {
      version,
      deviceName,
      deviceMac: macField.value,
      connection: {
        token: tokenField.value,
        ip: ipField.value,
        apiPort: apiPortField.value,
        tlsPort: tlsPortField.value,
        tlsFingerprint: tlsFingerprintField.value,
        hasTlsMetadata,
        hasValidTlsMetadata: !hasTlsMetadata || hasCompleteTlsMetadata,
      },
    },
  };
};

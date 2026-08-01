import {
  extractTokenFromQrData,
  pairingLinkFromParams,
  pairingLinkToConnection,
  pairingLinkToRecord,
  parsePairingLink,
  parsePairingQrConnection,
} from '../pairingQr';

// Avoids pulling in axios (via companionTransport -> axios's fetch adapter),
// which currently crashes under this repo's jest-expo + Node combination
// regardless of what it's asked to do -- unrelated to pairing/presence, but
// enough to fail module resolution for anything importing companionTransport
// transitively. pairingQr.ts only needs the pure fingerprint normalizer.
// jest.mock calls are hoisted above imports by babel-plugin-jest-hoist, so
// this still takes effect before `pairingQr` (and its companionTransport
// import) is evaluated.
jest.mock('../../services/companionTransport', () => ({
  normalizeTlsFingerprint: (value: string | null | undefined): string | null => {
    const normalized = value
      ?.trim()
      .toLowerCase()
      .replace(/^sha256:/, '')
      .replace(/:/g, '');
    return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
  },
}));

const VALID_FINGERPRINT = 'a'.repeat(64);

const buildLink = (overrides: Record<string, string> = {}): string => {
  const params = new URLSearchParams({
    v: '3',
    token: 'one-time-token-123',
    name: 'Desk Rig',
    api_port: '7777',
    tls_port: '7778',
    fp: VALID_FINGERPRINT,
    ip: '192.168.1.50',
    mac: '00:11:22:33:44:55',
    ...overrides,
  });
  return `https://wakematemobile.com/pair?${params.toString()}`;
};

describe('parsePairingLink', () => {
  it('parses a well-formed pairing Universal Link', () => {
    const link = parsePairingLink(buildLink());

    expect(link).toEqual({
      token: 'one-time-token-123',
      name: 'Desk Rig',
      ip: '192.168.1.50',
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: VALID_FINGERPRINT,
      mac: '00:11:22:33:44:55',
      version: 3,
    });
  });

  it('parses the wakemate:// custom-scheme fallback', () => {
    const link = parsePairingLink('wakemate://pair?token=abc123&name=Desk');
    expect(link?.token).toBe('abc123');
    expect(link?.name).toBe('Desk');
  });

  it('returns null for an unrelated https URL', () => {
    expect(parsePairingLink('https://example.com/pair?token=abc123')).toBeNull();
  });

  it('returns null for the pairing host on the wrong path', () => {
    expect(parsePairingLink('https://wakematemobile.com/other?token=abc123')).toBeNull();
  });

  it('returns null when the token is missing', () => {
    expect(parsePairingLink('https://wakematemobile.com/pair?name=Desk')).toBeNull();
  });

  it('returns null for a non-URL string', () => {
    expect(parsePairingLink('{"v":2,"token":"abc"}')).toBeNull();
  });

  it('returns null for a malformed IP, leaving ip null rather than throwing', () => {
    const link = parsePairingLink(buildLink({ ip: 'not-an-ip' }));
    expect(link?.ip).toBeNull();
  });
});

describe('pairingLinkFromParams', () => {
  it('builds a payload from Expo Router style params', () => {
    const link = pairingLinkFromParams({
      token: 'tok',
      name: 'Desk Rig',
      api_port: '7777',
      tls_port: '7778',
      fp: VALID_FINGERPRINT,
      ip: '10.0.0.5',
      mac: 'AA:BB:CC:DD:EE:FF',
      v: '3',
    });

    expect(link).toEqual({
      token: 'tok',
      name: 'Desk Rig',
      ip: '10.0.0.5',
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: VALID_FINGERPRINT,
      mac: 'AA:BB:CC:DD:EE:FF',
      version: 3,
    });
  });

  it('unwraps array-valued params (Expo Router can hand back string[])', () => {
    const link = pairingLinkFromParams({ token: ['tok-a', 'tok-b'] });
    expect(link?.token).toBe('tok-a');
  });

  it('returns null without a token', () => {
    expect(pairingLinkFromParams({ name: 'Desk Rig' })).toBeNull();
  });
});

describe('pairingLinkToConnection / pairingLinkToRecord', () => {
  it('round-trips a link into connection metadata with valid TLS', () => {
    const link = parsePairingLink(buildLink())!;
    const connection = pairingLinkToConnection(link);

    expect(connection.hasValidTlsMetadata).toBe(true);
    expect(connection.tlsFingerprint).toBe(VALID_FINGERPRINT);
    expect(connection.apiPort).toBe(7777);
  });

  it('flags incomplete TLS metadata (port without fingerprint) as invalid', () => {
    const link = parsePairingLink(buildLink({ fp: '' }))!;
    const connection = pairingLinkToConnection(link);
    expect(connection.hasValidTlsMetadata).toBe(false);
  });

  it('reshapes into the JSON-record shape extractCompanionFields expects', () => {
    const link = parsePairingLink(buildLink())!;
    const record = pairingLinkToRecord(link);
    expect(record).toMatchObject({
      token: 'one-time-token-123',
      name: 'Desk Rig',
      ip: '192.168.1.50',
      api_port: 7777,
      tls_port: 7778,
      fp: VALID_FINGERPRINT,
      mac: '00:11:22:33:44:55',
    });
  });
});

describe('extractTokenFromQrData with the Universal Link format', () => {
  it('extracts the token from a pairing link', () => {
    expect(extractTokenFromQrData(buildLink())).toBe('one-time-token-123');
  });

  it('still extracts a token from the legacy raw-JSON QR (contract v2)', () => {
    const legacyPayload = JSON.stringify({
      v: 2,
      kind: 'wakemate-pairing',
      token: 'legacy-token',
      name: 'Desk Rig',
      api_port: 7777,
      tls_port: 7778,
      fp: VALID_FINGERPRINT,
    });
    expect(extractTokenFromQrData(legacyPayload)).toBe('legacy-token');
  });
});

describe('parsePairingQrConnection with the Universal Link format', () => {
  it('produces the same connection shape as the legacy JSON QR', () => {
    const connection = parsePairingQrConnection(buildLink());
    expect(connection).toEqual({
      token: 'one-time-token-123',
      ip: '192.168.1.50',
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: VALID_FINGERPRINT,
      hasTlsMetadata: true,
      hasValidTlsMetadata: true,
    });
  });
});

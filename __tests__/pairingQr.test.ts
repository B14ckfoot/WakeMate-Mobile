import { parseStructuredPairingQr } from '../src/utils/pairingQr';

const fingerprint = 'AB:'.repeat(31) + 'AB';
const normalizedFingerprint = 'ab'.repeat(32);

const v3Payload = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 3,
    kind: 'wakemate-pairing',
    name: 'Desk PC',
    ip: '192.168.1.25',
    mac: '00-11-22-33-44-55',
    api_port: 7777,
    tls_port: '7778',
    fp: `sha256:${fingerprint}`,
    token: 'one-time-pairing-token',
    protocol_version: 4,
    ...overrides,
  });

describe('parseStructuredPairingQr', () => {
  it('normalizes a valid secure v3 contract', () => {
    const result = parseStructuredPairingQr(v3Payload());

    expect(result).toEqual({
      ok: true,
      value: {
        version: 3,
        deviceName: 'Desk PC',
        deviceMac: '00:11:22:33:44:55',
        connection: {
          token: 'one-time-pairing-token',
          ip: '192.168.1.25',
          apiPort: 7777,
          tlsPort: 7778,
          tlsFingerprint: normalizedFingerprint,
          hasTlsMetadata: true,
          hasValidTlsMetadata: true,
        },
      },
    });
  });

  it('keeps IP and MAC optional so discovery can recover them', () => {
    const result = parseStructuredPairingQr(
      v3Payload({ ip: undefined, mac: undefined })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        deviceName: 'Desk PC',
        deviceMac: null,
        connection: {
          ip: null,
          tlsPort: 7778,
          tlsFingerprint: normalizedFingerprint,
        },
      },
    });
  });

  it('keeps a legacy v2 JSON contract without TLS compatible', () => {
    const result = parseStructuredPairingQr(
      JSON.stringify({
        v: 2,
        kind: 'wakemate-pairing',
        name: 'Legacy PC',
        ip: '10.0.0.8',
        mac: '001122334455',
        port: '7777',
        api_token: 'legacy-token',
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        version: 2,
        deviceName: 'Legacy PC',
        deviceMac: '00:11:22:33:44:55',
        connection: {
          token: 'legacy-token',
          apiPort: 7777,
          tlsPort: null,
          tlsFingerprint: null,
          hasTlsMetadata: false,
          hasValidTlsMetadata: true,
        },
      },
    });
  });

  it.each([
    ['a bare token', 'legacy-token', 'malformed'],
    ['a web link', 'https://wakematemobile.com/pair?token=abc', 'malformed'],
    ['an array', JSON.stringify([{ token: 'abc' }]), 'malformed'],
    [
      'foreign JSON',
      JSON.stringify({
        v: 3,
        kind: 'another-product',
        name: 'Desk PC',
        api_port: 7777,
        tls_port: 7778,
        fp: normalizedFingerprint,
        token: 'abc',
      }),
      'foreign_kind',
    ],
    [
      'an unsupported contract version',
      v3Payload({ v: 4 }),
      'unsupported_version',
    ],
    [
      'a string contract version',
      v3Payload({ v: '3' }),
      'unsupported_version',
    ],
    ['a missing token', v3Payload({ token: undefined }), 'missing_token'],
    [
      'conflicting token aliases',
      v3Payload({ api_token: 'different-token' }),
      'missing_token',
    ],
    ['an invalid IP', v3Payload({ ip: '999.1.2.3' }), 'invalid_ip'],
    ['an invalid MAC', v3Payload({ mac: '00:11:22:33:44' }), 'invalid_mac'],
    ['a missing API port', v3Payload({ api_port: undefined }), 'invalid_api_port'],
    [
      'a partially parsed API port',
      v3Payload({ api_port: '7777junk' }),
      'invalid_api_port',
    ],
    [
      'conflicting API port aliases',
      v3Payload({ port: 8888 }),
      'invalid_api_port',
    ],
  ])('rejects %s before pairing', (_label, rawData, expectedCode) => {
    const result = parseStructuredPairingQr(rawData);

    expect(result).toMatchObject({
      ok: false,
      error: { code: expectedCode },
    });
  });

  it.each([
    ['v3 with no TLS fields', v3Payload({ tls_port: undefined, fp: undefined })],
    ['v3 with only a TLS port', v3Payload({ fp: undefined })],
    ['v3 with an invalid TLS port', v3Payload({ tls_port: '7778junk' })],
    ['v3 with an invalid fingerprint', v3Payload({ fp: 'not-a-fingerprint' })],
    ['v3 with conflicting TLS port aliases', v3Payload({ https_port: 8888 })],
    [
      'v2 with only a fingerprint',
      JSON.stringify({
        v: 2,
        kind: 'wakemate-pairing',
        name: 'Legacy PC',
        api_port: 7777,
        fp: normalizedFingerprint,
        token: 'legacy-token',
      }),
    ],
  ])('rejects incomplete TLS metadata: %s', (_label, rawData) => {
    expect(parseStructuredPairingQr(rawData)).toMatchObject({
      ok: false,
      error: { code: 'invalid_tls_metadata' },
    });
  });
});

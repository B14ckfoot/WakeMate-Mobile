---
paths:
  - "src/services/**/*.ts"
  - "src/context/**/*.tsx"
  - "src/utils/pairingQr.ts"
  - "src/utils/deviceNetwork.ts"
  - "src/utils/deviceMetadata.ts"
  - "src/utils/checkDeviceStatus.ts"
  - "src/utils/serverStatusChecker.ts"
  - "src/types/device.ts"
  - "modules/wakemate-tls/**/*"
  - "app/devices/scan-qr.tsx"
  - "__tests__/multiCompanion.test.ts"
  - "__tests__/scanQrPairing.test.tsx"
  - "__tests__/securityScreen.test.ts"
---

# Mobile network and security

- Treat QR contents, Universal Links, discovery replies, LAN responses, device records, and stored migrations as untrusted input.
- Validate supported contract/kind/version, required fields, IP addresses, ports (1-65535 where zero is not meaningful), tokens, normalized 64-hex SHA-256 fingerprints, and cross-source identity conflicts before persistence or use.
- A scanned visual QR is the trust channel for the TLS fingerprint. Discovery metadata is informational and must not replace or contradict that pin.
- Preserve exact-leaf-certificate pinned HTTPS. Reject partial or invalid TLS metadata; never silently downgrade a pinned device to HTTP.
- Never transmit a token until the intended certificate check has succeeded. Keep tokens and fingerprints per device in SecureStore; preserve write-before-delete migration behavior and never put them in AsyncStorage/widget records.
- Pairing is not approved until the companion reports approval. Keep denied, pending, timeout, unauthorized, offline, unsupported, and transport failures truthful and distinct.
- Search the full QR -> storage -> enrollment/activation -> desktop approval -> polling -> status chain for pairing changes.
- When a transport or protocol contract changes, update focused mobile tests and review all matching producers, parsers, and authorization behavior in `B14ckfoot/WakeMATE-Companion`.

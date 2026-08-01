import deviceService from '../services/deviceService';
import { resetDevicePresence } from '../services/presence';
import { Device } from '../types/device';
import { getThisPhoneDisplayName } from './deviceIdentity';
import { buildScannedDevice, extractCompanionFields } from './deviceMetadata';
import {
  PairingLinkPayload,
  pairingLinkToConnection,
  pairingLinkToRecord,
  parsePairingLink,
  parsePairingQrConnection,
  PairingQrConnection,
} from './pairingQr';

/**
 * Shared "finish pairing" logic used by both the in-app QR scanner
 * (app/devices/scan-qr.tsx) and the Universal Link / custom-scheme deep-link
 * handler (app/pair.tsx), so a scan and a tapped link behave identically
 * instead of drifting into two slightly different pairing paths.
 */

export class PairingFlowError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unrecognized'
      | 'invalid_tls_metadata'
      | 'incomplete_device_info'
  ) {
    super(message);
    this.name = 'PairingFlowError';
  }
}

export type PairingApproval = 'approved' | 'denied' | 'timeout' | 'unsupported';

export type PairingFlowOutcome = {
  device: Device;
  existingDevice: boolean;
  approval: PairingApproval | null;
  /** Human-readable sentence describing the approval outcome, suitable for
   * appending to a "device saved" message. Null when no token was present
   * (device metadata only, nothing to pair). */
  approvalSummary: string | null;
};

export type PartialPairingOutcome = {
  /** True when a pairing token was saved even though the QR/link had no
   * complete device details (name/MAC/IP) to save as a device. */
  tokenSaved: boolean;
};

const summarizeApproval = (approval: PairingApproval): string => {
  switch (approval) {
    case 'approved':
    case 'unsupported':
      return 'Remote controls are enabled.';
    case 'denied':
      return 'The pairing request was denied on the computer; remote controls stay off.';
    case 'timeout':
    default:
      return 'Approve the pairing dialog on the computer to enable remote controls.';
  }
};

type ParsedPairingPayload = { connection: PairingQrConnection; scannedDevice: Device | null };

const finalizePairingPayload = (
  connection: PairingQrConnection,
  record: unknown
): ParsedPairingPayload => {
  if (!connection.hasValidTlsMetadata) {
    throw new PairingFlowError(
      'This QR code advertises secure transport but is missing a valid TLS port or certificate fingerprint. Regenerate it from the WakeMATE companion.',
      'invalid_tls_metadata'
    );
  }

  const fields = extractCompanionFields(record, connection.ip ?? '');
  const scannedDevice = buildScannedDevice(fields);

  if (!scannedDevice && !connection.token) {
    throw new PairingFlowError(
      "This doesn't look like a WakeMATE pairing code. Make sure you're scanning the code shown by the companion app.",
      'unrecognized'
    );
  }

  return { connection, scannedDevice };
};

/**
 * Parses a scanned QR payload -- a Universal Link, the `wakemate://`
 * custom-scheme fallback, or the legacy raw-JSON QR (contract v2) -- into
 * connection metadata and a device-shaped record. Throws a typed
 * `PairingFlowError` for anything the app cannot act on, so callers show a
 * specific, honest error instead of a false "paired" state.
 */
export const parsePairingPayload = (rawData: string): ParsedPairingPayload => {
  const link = parsePairingLink(rawData);
  let record: unknown = null;

  if (link) {
    record = pairingLinkToRecord(link);
  } else {
    try {
      record = JSON.parse(rawData);
    } catch {
      throw new PairingFlowError(
        "This doesn't look like a WakeMATE pairing code. Make sure you're scanning the code shown by the companion app.",
        'unrecognized'
      );
    }
  }

  return finalizePairingPayload(parsePairingQrConnection(rawData), record);
};

/**
 * Same as {@link parsePairingPayload}, but for a pairing link the app
 * already received pre-parsed -- i.e. Expo Router's route params for the
 * `/pair` Universal Link / custom-scheme deep link (see app/pair.tsx).
 */
export const parsePairingPayloadFromLink = (link: PairingLinkPayload): ParsedPairingPayload =>
  finalizePairingPayload(pairingLinkToConnection(link), pairingLinkToRecord(link));

/**
 * Saves the pairing token (and connection metadata) without a complete
 * device record. Used when a code carries a token but not enough device
 * detail to add a saved device -- the user finishes setup in Settings.
 */
export const savePartialPairing = async (connection: PairingQrConnection): Promise<PartialPairingOutcome> => {
  if (!connection.token) {
    throw new PairingFlowError(
      'This QR code is missing required details (device name, MAC address, or IP address). Ask the companion app to regenerate its QR code.',
      'incomplete_device_info'
    );
  }

  if (connection.ip) {
    await deviceService.setServerConnection(
      connection.ip,
      connection.tlsFingerprint && connection.tlsPort ? connection.tlsPort : connection.apiPort
    );
    await deviceService.setServerTlsFingerprint(connection.tlsFingerprint);
  }
  await deviceService.setServerToken(connection.token);

  return { tokenSaved: true };
};

/**
 * Saves the scanned device, exchanges the pairing token for a per-device
 * token (protocol v3) or falls back to the legacy shared-token activation,
 * and waits for the desktop approval prompt. Never reports success until
 * the companion has actually answered -- `approval` reflects the real
 * outcome, not an assumption.
 */
export const completeDevicePairing = async (
  scannedDevice: Device,
  connection: PairingQrConnection
): Promise<PairingFlowOutcome> => {
  const existingDevices = await deviceService.getDevices();
  const existingDevice = existingDevices.find(
    (device) => device.mac === scannedDevice.mac || device.ip === scannedDevice.ip
  );

  const savedDevice = existingDevice
    ? { ...existingDevice, ...scannedDevice, id: existingDevice.id }
    : scannedDevice;

  const nextDevices = existingDevice
    ? existingDevices.map((device) => (device.id === existingDevice.id ? savedDevice : device))
    : [...existingDevices, savedDevice];

  await deviceService.saveDevices(nextDevices);
  // A device saved from a fresh pairing has no connectivity history yet;
  // start the presence engine clean so it reads "Connecting", not a stale
  // failure streak left over from a previous IP reuse.
  resetDevicePresence(savedDevice.ip);

  if (!connection.token) {
    return {
      device: savedDevice,
      existingDevice: Boolean(existingDevice),
      approval: null,
      approvalSummary: null,
    };
  }

  const connectionPort =
    connection.tlsFingerprint && connection.tlsPort ? connection.tlsPort : connection.apiPort;

  await deviceService.setServerConnection(savedDevice.ip, connectionPort);
  await deviceService.setServerTlsFingerprint(connection.tlsFingerprint);
  await deviceService.setServerToken(connection.token);

  let approval: PairingApproval;
  try {
    // Protocol v3: swap the QR/link token for a per-device token so this
    // phone can be revoked individually from the companion tray. Older
    // companions (404/405) fall back to the shared-token activation.
    const enrollment = await deviceService.enrollDevice(savedDevice.ip, getThisPhoneDisplayName());

    if (enrollment) {
      approval = await deviceService.waitForPairingApproval(savedDevice.ip, {
        timeoutMs: 30000,
        deviceId: enrollment.deviceId,
      });
      if (approval === 'approved') {
        await deviceService.setServerToken(enrollment.deviceToken);
      }
    } else {
      await deviceService.activatePairedControls(savedDevice.ip, connection.token);
      approval = await deviceService.waitForPairingApproval(savedDevice.ip, { timeoutMs: 30000 });
    }
  } catch (error) {
    console.error('Error completing device pairing:', error);
    return {
      device: savedDevice,
      existingDevice: Boolean(existingDevice),
      approval: null,
      approvalSummary:
        'The pairing token was saved, but pairing could not be completed yet — finish it in Settings.',
    };
  }

  return {
    device: savedDevice,
    existingDevice: Boolean(existingDevice),
    approval,
    approvalSummary: summarizeApproval(approval),
  };
};

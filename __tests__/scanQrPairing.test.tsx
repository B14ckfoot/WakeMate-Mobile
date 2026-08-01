import React from 'react';
import { Alert } from 'react-native';

import ScanDeviceQrScreen from '../app/devices/scan-qr';

type ScannerRenderer = {
  root: {
    findByProps: (props: Record<string, unknown>) => {
      props: {
        onBarcodeScanned: (event: { data: string }) => Promise<void>;
      };
    };
  };
  unmount: () => void;
};

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => ScannerRenderer;
};

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDiscoverCompanions = jest.fn();
const mockGetDevices = jest.fn();
const mockPairDeviceFromQr = jest.fn();
const mockSaveDevices = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }),
}));

jest.mock('expo-camera', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');

  return {
    CameraView: (props: Record<string, unknown>) =>
      ReactModule.createElement(View, {
        ...props,
        testID: 'pairing-camera',
      }),
    useCameraPermissions: () => [
      { granted: true, canAskAgain: true },
      jest.fn(async () => ({ granted: true, canAskAgain: true })),
    ],
  };
});

jest.mock('lucide-react-native', () => ({
  ArrowLeft: () => null,
}));

jest.mock('../app/services/deviceService', () => ({
  __esModule: true,
  default: {
    discoverCompanions: () => mockDiscoverCompanions(),
    getDevices: () => mockGetDevices(),
    pairDeviceFromQr: (deviceId: string, options: unknown) =>
      mockPairDeviceFromQr(deviceId, options),
    saveDevices: (devices: unknown) => mockSaveDevices(devices),
  },
}));

jest.mock('../src/utils/deviceIdentity', () => ({
  getThisPhoneDisplayName: () => 'Test iPhone',
}));

const scannedFingerprint = 'b'.repeat(64);

const currentQrWithoutMac = JSON.stringify({
  v: 3,
  kind: 'wakemate-pairing',
  name: 'Desk PC',
  ip: '192.168.1.25',
  api_port: 7777,
  tls_port: 7778,
  fp: scannedFingerprint,
  token: 'current-pairing-token',
});

const renderScanner = async () => {
  let renderer: ScannerRenderer;
  await act(async () => {
    renderer = create(<ScanDeviceQrScreen />);
  });
  return renderer!;
};

const scan = async (
  renderer: ScannerRenderer,
  data: string
) => {
  const camera = renderer.root.findByProps({ testID: 'pairing-camera' });
  await act(async () => {
    await camera.props.onBarcodeScanned({ data });
  });
};

const unmountScanner = async (renderer: ScannerRenderer) => {
  await act(async () => {
    renderer.unmount();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockGetDevices.mockResolvedValue([]);
  mockSaveDevices.mockResolvedValue(undefined);
  mockPairDeviceFromQr.mockResolvedValue({
    status: 'approved',
    detail: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('rejects a bare token instead of guessing which computer owns it', async () => {
  const renderer = await renderScanner();

  await scan(renderer, 'legacy-pairing-token');

  expect(Alert.alert).toHaveBeenCalledWith(
    'Unsupported Pairing Code',
    expect.stringContaining('structured device QR code'),
    expect.any(Array)
  );
  expect(mockDiscoverCompanions).not.toHaveBeenCalled();
  expect(mockSaveDevices).not.toHaveBeenCalled();
  expect(mockPairDeviceFromQr).not.toHaveBeenCalled();

  await unmountScanner(renderer);
});

it('rejects a v3 code with only half of its TLS metadata', async () => {
  const renderer = await renderScanner();
  const incompleteTlsQr = JSON.stringify({
    v: 3,
    kind: 'wakemate-pairing',
    name: 'Desk PC',
    ip: '192.168.1.25',
    api_port: 7777,
    tls_port: 7778,
    token: 'current-pairing-token',
  });

  await scan(renderer, incompleteTlsQr);

  expect(Alert.alert).toHaveBeenCalledWith(
    'Invalid Secure Pairing Code',
    expect.stringContaining('certificate fingerprint'),
    expect.any(Array)
  );
  expect(mockDiscoverCompanions).not.toHaveBeenCalled();
  expect(mockSaveDevices).not.toHaveBeenCalled();
  expect(mockPairDeviceFromQr).not.toHaveBeenCalled();

  await unmountScanner(renderer);
});

it('pairs a valid v3 code and fills a missing MAC by exact IP', async () => {
  mockDiscoverCompanions.mockResolvedValue([
    {
      serverIp: '192.168.1.25',
      deviceName: 'Desk PC',
      macAddress: '00:11:22:33:44:55',
      wakeAddress: '192.168.1.255',
      wakePort: 9,
      apiPort: 9000,
      tlsPort: 9001,
      tlsFingerprint: scannedFingerprint,
      version: '1.0.0',
      platform: 'windows',
    },
  ]);
  const renderer = await renderScanner();

  await scan(renderer, currentQrWithoutMac);

  expect(mockPairDeviceFromQr).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      ip: '192.168.1.25',
      token: 'current-pairing-token',
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: scannedFingerprint,
    })
  );

  await unmountScanner(renderer);
});

it('does not claim remote controls are enabled when a legacy companion cannot report approval', async () => {
  mockDiscoverCompanions.mockResolvedValue([
    {
      serverIp: '192.168.1.25',
      deviceName: 'Desk PC',
      macAddress: '00:11:22:33:44:55',
      wakeAddress: '192.168.1.255',
      wakePort: 9,
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: scannedFingerprint,
      version: '1.0.0',
      platform: 'windows',
    },
  ]);
  mockPairDeviceFromQr.mockResolvedValue({
    status: 'unsupported',
    detail: null,
  });
  const renderer = await renderScanner();

  await scan(renderer, currentQrWithoutMac);

  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Device Saved',
    expect.stringContaining('This older Companion cannot confirm approval'),
    expect.any(Array)
  );
  expect(Alert.alert).not.toHaveBeenLastCalledWith(
    expect.any(String),
    expect.stringContaining('Remote controls are enabled'),
    expect.any(Array)
  );

  await unmountScanner(renderer);
});

it('does not combine an explicit QR IP with another discovered computer', async () => {
  mockDiscoverCompanions.mockResolvedValue([
    {
      serverIp: '192.168.1.99',
      deviceName: 'Desk PC',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      wakeAddress: '192.168.1.255',
      wakePort: 9,
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: scannedFingerprint,
      version: '1.0.0',
      platform: 'windows',
    },
  ]);
  const renderer = await renderScanner();

  await scan(renderer, currentQrWithoutMac);

  expect(Alert.alert).toHaveBeenCalledWith(
    'Incomplete Device Info',
    expect.any(String),
    expect.any(Array)
  );
  expect(mockSaveDevices).not.toHaveBeenCalled();
  expect(mockPairDeviceFromQr).not.toHaveBeenCalled();

  await unmountScanner(renderer);
});

it('rejects discovery metadata that conflicts with the scanned TLS pin', async () => {
  mockDiscoverCompanions.mockResolvedValue([
    {
      serverIp: '192.168.1.25',
      deviceName: 'Desk PC',
      macAddress: '00:11:22:33:44:55',
      wakeAddress: '192.168.1.255',
      wakePort: 9,
      apiPort: 7777,
      tlsPort: 7778,
      tlsFingerprint: 'c'.repeat(64),
      version: '1.0.0',
      platform: 'windows',
    },
  ]);
  const renderer = await renderScanner();

  await scan(renderer, currentQrWithoutMac);

  expect(Alert.alert).toHaveBeenCalledWith(
    'Secure Pairing Mismatch',
    expect.any(String),
    expect.any(Array)
  );
  expect(mockSaveDevices).not.toHaveBeenCalled();
  expect(mockPairDeviceFromQr).not.toHaveBeenCalled();

  await unmountScanner(renderer);
});

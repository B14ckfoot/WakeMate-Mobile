import React from 'react';

import DevicesScreen from '../app/devices';
import { FocusedPollReason } from '../src/hooks/useFocusedPolling';
import { Device } from '../src/types/device';

type TestRenderer = {
  root: {
    findByProps: (props: Record<string, unknown>) => {
      props: { onPress: () => void };
    };
  };
  unmount: () => void;
};

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => TestRenderer;
};

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
const mockGetDevices = jest.fn();
const mockCheckDeviceStatus = jest.fn();
const mockSaveDevices = jest.fn();
const mockUpdateDeviceStatuses = jest.fn();
let mockPoll: ((reason: FocusedPollReason) => Promise<void>) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(effect, [effect]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('lucide-react-native', () => ({
  Plus: () => null,
  RefreshCw: () => null,
  ScanQrCode: () => null,
  Search: () => null,
  Settings: () => null,
}));

jest.mock('../app/services/deviceService', () => ({
  __esModule: true,
  default: {
    getDevices: () => mockGetDevices(),
    checkDeviceStatus: (ip: string, id: string) => mockCheckDeviceStatus(ip, id),
    saveDevices: (devices: Device[]) => mockSaveDevices(devices),
    updateDeviceStatuses: (updates: Pick<Device, 'id' | 'status'>[]) =>
      mockUpdateDeviceStatuses(updates),
  },
}));

jest.mock('../src/hooks/useFocusedPolling', () => ({
  useFocusedPolling: (poll: (reason: FocusedPollReason) => Promise<void>) => {
    mockPoll = poll;
  },
}));

jest.mock('../src/components/SwipeableDeviceItem', () => {
  const ReactModule = require('react');
  const { TouchableOpacity } = require('react-native');

  return function MockSwipeableDeviceItem({
    device,
    onPress,
  }: {
    device: Device;
    onPress: (selectedDevice: Device) => void;
  }) {
    return ReactModule.createElement(TouchableOpacity, {
      testID: `device-row-${device.id}`,
      onPress: () => onPress(device),
    });
  };
});

const FIRST_PC: Device = {
  id: 'first-pc',
  name: 'First PC',
  mac: '00:11:22:33:44:55',
  ip: '192.168.1.20',
  wakeAddress: '192.168.1.255',
  wakePort: 9,
  status: 'offline',
  type: 'wifi',
  platform: 'windows',
  apiPort: 7777,
  tlsPort: null,
};

const SECOND_PC: Device = {
  ...FIRST_PC,
  id: 'second-pc',
  name: 'Second PC',
  ip: '192.168.1.21',
};

const renderLoadedScreen = async (): Promise<TestRenderer> => {
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DevicesScreen />);
  });
  await act(async () => {
    await mockPoll?.('focus');
  });
  mockCheckDeviceStatus.mockClear();
  mockPush.mockClear();
  return renderer!;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPoll = null;
  mockGetDevices.mockResolvedValue([FIRST_PC, SECOND_PC]);
  mockCheckDeviceStatus.mockResolvedValue(false);
  mockSaveDevices.mockResolvedValue(undefined);
  mockUpdateDeviceStatuses.mockResolvedValue([FIRST_PC, SECOND_PC]);
});

it('ignores a duplicate tap while the same device health check is in flight', async () => {
  const renderer = await renderLoadedScreen();
  let resolveStatus: ((online: boolean) => void) | null = null;
  mockCheckDeviceStatus.mockReturnValueOnce(new Promise<boolean>((resolve) => {
    resolveStatus = resolve;
  }));

  await act(async () => {
    const row = renderer.root.findByProps({ testID: 'device-row-first-pc' });
    row.props.onPress();
    row.props.onPress();
    await Promise.resolve();
  });
  expect(mockCheckDeviceStatus).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveStatus?.(true);
    await Promise.resolve();
  });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/devices/control/first-pc');

  await act(async () => {
    renderer.unmount();
  });
});

it('lets the latest tapped device win when health checks finish out of order', async () => {
  const renderer = await renderLoadedScreen();
  let resolveFirst: ((online: boolean) => void) | null = null;
  let resolveSecond: ((online: boolean) => void) | null = null;
  mockCheckDeviceStatus
    .mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    }))
    .mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolveSecond = resolve;
    }));

  await act(async () => {
    renderer.root.findByProps({ testID: 'device-row-first-pc' }).props.onPress();
    renderer.root.findByProps({ testID: 'device-row-second-pc' }).props.onPress();
    await Promise.resolve();
  });

  await act(async () => {
    resolveSecond?.(true);
    await Promise.resolve();
  });
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/devices/control/second-pc');

  await act(async () => {
    resolveFirst?.(false);
    await Promise.resolve();
  });
  expect(mockPush).toHaveBeenCalledTimes(1);

  await act(async () => {
    renderer.unmount();
  });
});

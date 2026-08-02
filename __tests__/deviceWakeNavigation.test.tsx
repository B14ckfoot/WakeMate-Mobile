import React from 'react';
import { Alert } from 'react-native';

import DeviceDetailScreen from '../app/devices/[id]';
import { Device } from '../src/types/device';
import { FocusedPollReason } from '../src/hooks/useFocusedPolling';

type TestRenderer = {
  root: {
    findByProps: (props: Record<string, unknown>) => {
      props: { onPress: () => Promise<void>; disabled?: boolean };
    };
  };
  unmount: () => void;
};

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => TestRenderer;
};

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = {
  back: mockBack,
  push: mockPush,
  replace: mockReplace,
};
const mockGetDevices = jest.fn();
const mockCheckDeviceStatus = jest.fn();
const mockSaveDevices = jest.fn();
const mockUpdateDeviceStatuses = jest.fn();
const mockWakeMachine = jest.fn();
let mockPoll: ((reason: FocusedPollReason) => Promise<void>) | null = null;
let mockPollInterval = 0;
let mockBlurScreen: (() => void) | null = null;
let mockFocusScreen: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'desk-pc' }),
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => {
      let cleanup = effect();
      mockBlurScreen = () => {
        cleanup?.();
        cleanup = undefined;
      };
      mockFocusScreen = () => {
        cleanup = effect();
      };

      return () => {
        cleanup?.();
        mockBlurScreen = null;
        mockFocusScreen = null;
      };
    }, [effect]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('lucide-react-native', () => ({
  ArrowLeft: () => null,
  Edit: () => null,
  Monitor: () => null,
  Power: () => null,
  RefreshCw: () => null,
  Settings: () => null,
  Trash2: () => null,
}));

jest.mock('../app/services/deviceService', () => ({
  __esModule: true,
  default: {
    getDevices: () => mockGetDevices(),
    checkDeviceStatus: (ip: string, id: string) => mockCheckDeviceStatus(ip, id),
    saveDevices: (devices: Device[]) => mockSaveDevices(devices),
    updateDeviceStatuses: (updates: Pick<Device, 'id' | 'status'>[]) =>
      mockUpdateDeviceStatuses(updates),
    wakeMachine: (device: Device) => mockWakeMachine(device),
  },
}));

jest.mock('../src/hooks/useFocusedPolling', () => {
  const ReactModule = require('react');
  return {
    useFocusedPolling: (
      poll: (reason: FocusedPollReason) => Promise<void>,
      intervalMs: number
    ) => {
      mockPoll = poll;
      mockPollInterval = intervalMs;
      ReactModule.useEffect(() => {
        void poll('focus');
      }, [poll]);
    },
  };
});

const OFFLINE_PC: Device = {
  id: 'desk-pc',
  name: 'PixelPunisher',
  mac: '00:11:22:33:44:55',
  ip: '192.168.1.25',
  wakeAddress: '192.168.1.255',
  wakePort: 9,
  status: 'offline',
  type: 'wifi',
  platform: 'windows',
  apiPort: 7777,
  tlsPort: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPoll = null;
  mockPollInterval = 0;
  mockBlurScreen = null;
  mockFocusScreen = null;
  mockGetDevices.mockResolvedValue([OFFLINE_PC]);
  mockCheckDeviceStatus.mockResolvedValue(false);
  mockSaveDevices.mockResolvedValue(undefined);
  mockUpdateDeviceStatuses.mockResolvedValue([{ ...OFFLINE_PC, status: 'online' }]);
  mockWakeMachine.mockResolvedValue({ message: 'sent' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('polls quickly after Wake-on-LAN and opens controls once the PC answers', async () => {
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DeviceDetailScreen />);
  });

  expect(mockCheckDeviceStatus).toHaveBeenCalledWith(OFFLINE_PC.ip, OFFLINE_PC.id);
  expect(mockPollInterval).toBe(5000);

  await act(async () => {
    await renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
  });

  expect(mockWakeMachine).toHaveBeenCalledWith(OFFLINE_PC);
  expect(mockPollInterval).toBe(2000);
  expect(renderer!.root.findByProps({ testID: 'device-primary-action' }).props.disabled).toBe(false);

  mockCheckDeviceStatus.mockResolvedValueOnce(true);
  await act(async () => {
    await mockPoll?.('interval');
  });

  expect(mockReplace).toHaveBeenCalledWith('/devices/control/desk-pc');

  await act(async () => {
    renderer!.unmount();
  });
});

it('does not open controls when an in-flight wake check finishes after leaving', async () => {
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DeviceDetailScreen />);
  });

  await act(async () => {
    await renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
  });

  let resolveStatus: ((online: boolean) => void) | null = null;
  const deferredStatus = new Promise<boolean>((resolve) => {
    resolveStatus = resolve;
  });
  mockCheckDeviceStatus.mockReturnValueOnce(deferredStatus);

  let pendingPoll: Promise<void> | undefined;
  await act(async () => {
    pendingPoll = mockPoll?.('interval');
    await Promise.resolve();
  });

  await act(async () => {
    renderer!.unmount();
  });
  await act(async () => {
    resolveStatus?.(true);
    await pendingPoll;
  });

  expect(mockReplace).not.toHaveBeenCalled();
});

it('ignores a Wake-on-LAN completion from an earlier focus generation', async () => {
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DeviceDetailScreen />);
  });

  let resolveWake: ((result: { message: string }) => void) | null = null;
  const deferredWake = new Promise<{ message: string }>((resolve) => {
    resolveWake = resolve;
  });
  mockWakeMachine.mockReturnValueOnce(deferredWake);

  let pendingWake: Promise<void> | undefined;
  await act(async () => {
    pendingWake = renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
    await Promise.resolve();
  });

  await act(async () => {
    mockBlurScreen?.();
    mockFocusScreen?.();
  });
  await act(async () => {
    resolveWake?.({ message: 'sent' });
    await pendingWake;
  });

  expect(mockPollInterval).toBe(5000);
  expect(renderer!.root.findByProps({ testID: 'device-primary-action' }).props.disabled).toBe(false);

  await act(async () => {
    renderer!.unmount();
  });
});

it('does not show a stale Wake failure after the detail screen loses focus', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DeviceDetailScreen />);
  });

  let rejectWake: ((error: Error) => void) | null = null;
  const deferredWake = new Promise<never>((_resolve, reject) => {
    rejectWake = reject;
  });
  mockWakeMachine.mockReturnValueOnce(deferredWake);

  let pendingWake: Promise<void> | undefined;
  await act(async () => {
    pendingWake = renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
    await Promise.resolve();
  });

  await act(async () => {
    mockBlurScreen?.();
    mockFocusScreen?.();
  });
  await act(async () => {
    rejectWake?.(new Error('late failure'));
    await pendingWake;
  });

  expect(alert).not.toHaveBeenCalledWith('Wake Failed', expect.any(String));

  await act(async () => {
    renderer!.unmount();
  });
});

it('stops accelerated wake polling after two minutes so Wake can be retried', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  let renderer: TestRenderer;
  await act(async () => {
    renderer = create(<DeviceDetailScreen />);
  });

  await act(async () => {
    await renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
  });
  expect(mockPollInterval).toBe(2000);

  now.mockReturnValue(121001);
  await act(async () => {
    await mockPoll?.('interval');
  });

  expect(mockPollInterval).toBe(5000);
  expect(renderer!.root.findByProps({ testID: 'device-primary-action' }).props.disabled).toBe(false);
  expect(mockWakeMachine).toHaveBeenCalledTimes(1);

  await act(async () => {
    await renderer!.root.findByProps({ testID: 'device-primary-action' }).props.onPress();
  });
  expect(mockWakeMachine).toHaveBeenCalledTimes(2);

  await act(async () => {
    renderer!.unmount();
  });
});

import React from 'react';
import { AppState, AppStateStatus, View } from 'react-native';
import { useMouseHoldLease } from '../src/hooks/useMouseHoldLease';
import deviceService from '../src/services/deviceService';

type Controls = ReturnType<typeof useMouseHoldLease>;
type Renderer = { unmount: () => void; update: (element: React.ReactElement) => void };
const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => Renderer;
};

let mockRouteFocused = true;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => mockRouteFocused ? effect() : undefined, [effect, mockRouteFocused]);
  },
}));
jest.mock('../src/services/deviceService', () => ({
  __esModule: true,
  default: {
    sendMouseButtonDown: jest.fn(async () => {}),
    sendMouseButtonUp: jest.fn(async () => {}),
  },
}));

describe('remote mouse hold route lifecycle', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let controls: Controls;
  const onRelease = jest.fn();
  const onError = jest.fn();
  const Harness = ({ enabled = true, deviceId = 'pc-a' }: { enabled?: boolean; deviceId?: string }) => {
    controls = useMouseHoldLease({ deviceId, deviceIp: '10.0.0.2', enabled, onRelease, onError });
    return <View />;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRouteFocused = true;
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['background', 'inactive'] as AppStateStatus[])(
    'releases on %s and requires a new gesture after returning', async (state) => {
      let renderer!: Renderer;
      await act(async () => { renderer = create(<Harness />); });
      expect(controls!.start()).toBe(true);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(500);
        appStateListener?.(state);
        await jest.advanceTimersByTimeAsync(3000);
      });
      expect(deviceService.sendMouseButtonUp).toHaveBeenCalledWith('pc-a', '10.0.0.2', 'left');
      expect(controls!.start()).toBe(false);
      const calls = jest.mocked(deviceService.sendMouseButtonDown).mock.calls.length;
      await act(async () => {
        appStateListener?.('active');
        await jest.advanceTimersByTimeAsync(3000);
      });
      expect(deviceService.sendMouseButtonDown).toHaveBeenCalledTimes(calls);
      await act(async () => { renderer.unmount(); });
    }
  );

  it.each(['offline', 'blur', 'unmount'])('releases on %s', async (reason) => {
    let renderer!: Renderer;
    await act(async () => { renderer = create(<Harness />); });
    controls!.start();
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    await act(async () => {
      if (reason === 'unmount') {
        renderer.unmount();
      } else {
        if (reason === 'blur') mockRouteFocused = false;
        renderer.update(<Harness enabled={reason !== 'offline'} />);
      }
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(deviceService.sendMouseButtonDown).toHaveBeenCalledTimes(1);
    expect(deviceService.sendMouseButtonUp).toHaveBeenCalledTimes(1);
    expect(controls!.start()).toBe(false);
    if (reason !== 'unmount') await act(async () => { renderer.unmount(); });
  });

  it('keeps late releases scoped to the original computer after a selection change', async () => {
    let resolveDown!: () => void;
    jest.mocked(deviceService.sendMouseButtonDown).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveDown = resolve; })
    );
    let renderer!: Renderer;
    await act(async () => { renderer = create(<Harness />); });
    controls!.start();
    await act(async () => { renderer.update(<Harness deviceId="pc-b" />); });
    expect(deviceService.sendMouseButtonUp).not.toHaveBeenCalled();
    await act(async () => {
      resolveDown();
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(deviceService.sendMouseButtonUp).toHaveBeenCalledTimes(1);
    expect(deviceService.sendMouseButtonUp).toHaveBeenCalledWith('pc-a', '10.0.0.2', 'left');
    expect(deviceService.sendMouseButtonDown).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.unmount(); });
  });

  it('does not cancel a new computer hold when the old computer request fails late', async () => {
    let rejectDown!: (error: Error) => void;
    jest.mocked(deviceService.sendMouseButtonDown).mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectDown = reject; })
    );
    let renderer!: Renderer;
    await act(async () => { renderer = create(<Harness />); });
    controls!.start();
    await act(async () => { renderer.update(<Harness deviceId="pc-b" />); });
    controls!.start();
    await act(async () => {
      rejectDown(new Error('old pc offline'));
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(onError).not.toHaveBeenCalled();
    expect(deviceService.sendMouseButtonUp).toHaveBeenCalledTimes(1);
    expect(deviceService.sendMouseButtonUp).toHaveBeenCalledWith('pc-a', '10.0.0.2', 'left');
    expect(deviceService.sendMouseButtonDown).toHaveBeenLastCalledWith('pc-b', '10.0.0.2', 'left');
    expect(deviceService.sendMouseButtonDown).toHaveBeenCalledTimes(4);
    await act(async () => { renderer.unmount(); });
  });
});

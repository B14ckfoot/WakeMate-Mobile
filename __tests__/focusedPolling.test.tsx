import React from 'react';
import { AppState, AppStateStatus, View } from 'react-native';

import { FocusedPollReason, useFocusedPolling } from '../src/hooks/useFocusedPolling';

type TestRenderer = {
  unmount: () => void;
};

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => TestRenderer;
};

jest.mock('expo-router', () => {
  const ReactModule = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactModule.useEffect(effect, [effect]);
    },
  };
});

const PollingHarness = ({
  poll,
  intervalMs = 1000,
}: {
  poll: (reason: FocusedPollReason) => Promise<void>;
  intervalMs?: number;
}) => {
  useFocusedPolling(poll, intervalMs);
  return <View />;
};

describe('focused status polling', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;

  beforeEach(() => {
    jest.useFakeTimers();
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'change') {
        appStateListener = listener;
      }
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('checks immediately, repeats while visible, and refreshes on foreground', async () => {
    const poll = jest.fn(async () => {});
    let renderer: TestRenderer;

    await act(async () => {
      renderer = create(<PollingHarness poll={poll} />);
    });

    expect(poll).toHaveBeenCalledWith('focus');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(poll).toHaveBeenLastCalledWith('interval');
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      appStateListener?.('background');
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(poll).toHaveBeenCalledTimes(2);

    await act(async () => {
      appStateListener?.('active');
    });
    expect(poll).toHaveBeenLastCalledWith('foreground');
    expect(poll).toHaveBeenCalledTimes(3);

    await act(async () => {
      renderer!.unmount();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('queues a foreground refresh instead of overlapping an in-flight check', async () => {
    let releaseFirstPoll: (() => void) | null = null;
    const firstPoll = new Promise<void>((resolve) => {
      releaseFirstPoll = resolve;
    });
    const poll = jest
      .fn<Promise<void>, [FocusedPollReason]>()
      .mockReturnValueOnce(firstPoll)
      .mockResolvedValue(undefined);
    let renderer: TestRenderer;

    await act(async () => {
      renderer = create(<PollingHarness poll={poll} />);
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      appStateListener?.('active');
    });
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirstPoll?.();
      await firstPoll;
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenLastCalledWith('foreground');

    await act(async () => {
      renderer!.unmount();
    });
  });
});

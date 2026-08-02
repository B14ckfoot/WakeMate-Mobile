import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

export type FocusedPollReason = 'focus' | 'interval' | 'foreground';

const appStateAllowsPolling = (state: typeof AppState.currentState): boolean =>
  state !== 'background' && state !== 'inactive';

/**
 * Runs one async poll at a time while the current route is visible and the app
 * is active. A recursive timeout avoids overlapping slow network requests,
 * and returning to the foreground triggers a check immediately instead of
 * waiting for the next interval.
 */
export const useFocusedPolling = (
  poll: (reason: FocusedPollReason) => Promise<void>,
  intervalMs: number
): void => {
  const pollRef = useRef(poll);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useFocusEffect(
    useCallback(() => {
      let isFocused = true;
      // React Native can briefly report `unknown`/null during launch. A
      // focused screen should still perform its first check; only explicit
      // background states pause network work.
      let isAppActive = appStateAllowsPolling(AppState.currentState);
      let isPolling = false;
      let queuedReason: FocusedPollReason | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const clearScheduledPoll = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const scheduleNextPoll = () => {
        clearScheduledPoll();
        if (!isFocused || !isAppActive) {
          return;
        }

        timeoutId = setTimeout(() => {
          timeoutId = null;
          void runPoll('interval');
        }, intervalMs);
      };

      const runPoll = async (reason: FocusedPollReason) => {
        if (!isFocused || !isAppActive) {
          return;
        }

        if (isPolling) {
          queuedReason = reason;
          return;
        }

        isPolling = true;
        clearScheduledPoll();

        try {
          await pollRef.current(reason);
        } finally {
          isPolling = false;

          if (!isFocused || !isAppActive) {
            return;
          }

          if (queuedReason) {
            const nextReason = queuedReason;
            queuedReason = null;
            void runPoll(nextReason);
            return;
          }

          scheduleNextPoll();
        }
      };

      if (isAppActive) {
        void runPoll('focus');
      }

      const appStateSubscription = AppState.addEventListener('change', (nextState) => {
        isAppActive = appStateAllowsPolling(nextState);

        if (!isAppActive) {
          clearScheduledPoll();
          return;
        }

        void runPoll('foreground');
      });

      return () => {
        isFocused = false;
        queuedReason = null;
        clearScheduledPoll();
        appStateSubscription.remove();
      };
    }, [intervalMs])
  );
};

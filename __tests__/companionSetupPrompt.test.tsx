import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Text } from 'react-native';

import CompanionSetupPrompt, {
  COMPANION_DOWNLOAD_URL,
  COMPANION_SETUP_DISMISSED_KEY,
} from '../src/components/CompanionSetupPrompt';

type PromptRenderer = {
  root: {
    findAllByType: (type: typeof Text) => Array<{ props: { children?: unknown } }>;
    findByProps: (props: Record<string, unknown>) => {
      props: {
        onPress?: () => void;
        visible?: boolean;
      };
    };
  };
  unmount: () => void;
};

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => PromptRenderer;
};

const mockOpenBrowserAsync = jest.fn();

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (url: string) => mockOpenBrowserAsync(url),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  }),
}));

jest.mock('lucide-react-native', () => ({
  ExternalLink: () => null,
  MonitorDown: () => null,
  QrCode: () => null,
  ShieldCheck: () => null,
}));

const renderPrompt = async () => {
  let renderer: PromptRenderer;
  await act(async () => {
    renderer = create(<CompanionSetupPrompt />);
  });
  return renderer!;
};

const readCopy = (renderer: PromptRenderer) =>
  renderer.root
    .findAllByType(Text)
    .flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]))
    .filter((child): child is string => typeof child === 'string')
    .join(' ');

beforeEach(async () => {
  jest.clearAllMocks();
  mockOpenBrowserAsync.mockResolvedValue({ type: 'dismiss' });
  await AsyncStorage.clear();
});

it('explains the download and in-app tray QR flow on first open', async () => {
  const renderer = await renderPrompt();

  expect(renderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(true);
  expect(readCopy(renderer)).toContain('Install the free WakeMATE Companion');
  expect(readCopy(renderer)).toContain('Scan the tray QR code');
  expect(readCopy(renderer)).toContain('scan it here in WakeMATE');
  expect(readCopy(renderer)).toContain('Windows system tray');
  expect(readCopy(renderer)).toContain('The website is only for the download');

  await act(async () => {
    renderer.unmount();
  });
});

it('remembers Maybe Later so the one-time prompt stays dismissed', async () => {
  const firstRenderer = await renderPrompt();

  await act(async () => {
    firstRenderer.root.findByProps({ testID: 'dismiss-companion-setup' }).props.onPress?.();
  });

  expect(await AsyncStorage.getItem(COMPANION_SETUP_DISMISSED_KEY)).toBe('dismissed');
  expect(firstRenderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(false);

  await act(async () => {
    firstRenderer.unmount();
  });

  const nextRenderer = await renderPrompt();
  expect(nextRenderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(false);

  await act(async () => {
    nextRenderer.unmount();
  });
});

it('does not interrupt an existing user who already has a saved computer', async () => {
  await AsyncStorage.setItem(
    'devices',
    JSON.stringify([{ id: 'existing-pc', name: 'Desk PC' }])
  );

  const renderer = await renderPrompt();

  expect(renderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(false);

  await act(async () => {
    renderer.unmount();
  });
});

it('opens the official Companion section and also remembers the choice', async () => {
  const renderer = await renderPrompt();

  await act(async () => {
    renderer.root.findByProps({ testID: 'view-companion-download' }).props.onPress?.();
  });

  expect(mockOpenBrowserAsync).toHaveBeenCalledWith(COMPANION_DOWNLOAD_URL);
  expect(await AsyncStorage.getItem(COMPANION_SETUP_DISMISSED_KEY)).toBe('dismissed');
  expect(renderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(false);

  await act(async () => {
    renderer.unmount();
  });
});

it('stays available when the website cannot be opened', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockOpenBrowserAsync.mockRejectedValueOnce(new Error('browser unavailable'));
  const renderer = await renderPrompt();

  await act(async () => {
    renderer.root.findByProps({ testID: 'view-companion-download' }).props.onPress?.();
  });

  expect(await AsyncStorage.getItem(COMPANION_SETUP_DISMISSED_KEY)).toBeNull();
  expect(renderer.root.findByProps({ testID: 'companion-setup-prompt' }).props.visible).toBe(true);

  await act(async () => {
    renderer.unmount();
  });
  warnSpy.mockRestore();
});

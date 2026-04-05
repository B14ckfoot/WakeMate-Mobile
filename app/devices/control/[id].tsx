import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Command,
  Keyboard as KeyboardIcon,
  LogOut,
  Minus,
  Monitor,
  Moon,
  MousePointer,
  Music,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Settings,
  SkipBack,
  SkipForward,
  VolumeX,
} from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../../src/types/device';
import deviceService from '../../../src/services/deviceService';

type ControlTab = 'mouse' | 'keyboard' | 'keys' | 'media' | 'power';
type FeedbackTone = 'info' | 'success' | 'warning';
type ActionFeedback = { message: string; tone: FeedbackTone };
type LoadOptions = { showLoader?: boolean; refreshStatus?: boolean };
type QuickKey = { label: string; keyValue: string; wide?: boolean };

const TOUCHPAD_SENSITIVITY = 1.2;
const TOUCHPAD_NOISE_THRESHOLD = 0.1;

const TAB_ITEMS = [
  { key: 'mouse' as const, label: 'Trackpad', icon: MousePointer },
  { key: 'keyboard' as const, label: 'Keyboard', icon: KeyboardIcon },
  { key: 'keys' as const, label: 'Keys', icon: Command },
  { key: 'media' as const, label: 'Media', icon: Music },
  { key: 'power' as const, label: 'Power', icon: Power },
];

const KEYBOARD_QUICK_KEYS: QuickKey[] = [
  { label: 'Esc', keyValue: 'esc' },
  { label: 'Tab', keyValue: 'tab' },
  { label: 'Enter', keyValue: 'enter' },
  { label: 'Backspace', keyValue: 'backspace', wide: true },
  { label: 'Space', keyValue: 'space' },
];

const MODIFIER_KEYS: QuickKey[] = [
  { label: 'Shift', keyValue: 'shift' },
  { label: 'Ctrl', keyValue: 'ctrl' },
  { label: 'Win', keyValue: 'win' },
  { label: 'Alt', keyValue: 'alt' },
];

const NAVIGATION_KEYS: QuickKey[] = [
  { label: 'Esc', keyValue: 'esc' },
  { label: 'Tab', keyValue: 'tab' },
  { label: 'Enter', keyValue: 'enter' },
  { label: 'Delete', keyValue: 'delete' },
  { label: 'Home', keyValue: 'home' },
  { label: 'End', keyValue: 'end' },
  { label: 'PgUp', keyValue: 'pageup' },
  { label: 'PgDn', keyValue: 'pagedown' },
  { label: 'Up', keyValue: 'up' },
  { label: 'Left', keyValue: 'left' },
  { label: 'Down', keyValue: 'down' },
  { label: 'Right', keyValue: 'right' },
];

const FUNCTION_KEYS: QuickKey[] = Array.from({ length: 12 }, (_, index) => ({
  label: `F${index + 1}`,
  keyValue: `f${index + 1}`,
}));

const PRODUCTIVITY_SHORTCUTS: QuickKey[] = [
  { label: 'Ctrl+C', keyValue: 'ctrl+c' },
  { label: 'Ctrl+V', keyValue: 'ctrl+v' },
  { label: 'Ctrl+Z', keyValue: 'ctrl+z' },
  { label: 'Alt+Tab', keyValue: 'alt+tab' },
  { label: 'Win+D', keyValue: 'win+d' },
  { label: 'Ctrl+Alt+Delete', keyValue: 'ctrl+alt+delete', wide: true },
];

export default function DeviceControlScreen() {
  useKeepAwake();

  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [device, setDevice] = useState<Device | null>(null);
  const [savedDevices, setSavedDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ControlTab>('mouse');
  const [isPlaying, setIsPlaying] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const [isSendingKeyboard, setIsSendingKeyboard] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  const keyboardInputRef = useRef<TextInput>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMouseMoveErrorRef = useRef<string | null>(null);
  const lastTouchpadTranslationRef = useRef({ x: 0, y: 0 });
  const pendingMouseMoveRef = useRef({ x: 0, y: 0 });
  const mouseMoveRequestInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const triggerHaptic = useCallback((type: 'selection' | 'light' | 'success' | 'error') => {
    if (type === 'light') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (type === 'success') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (type === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    void Haptics.selectionAsync();
  }, []);

  const showFeedback = useCallback((message: string, tone: FeedbackTone = 'info') => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    setFeedback({ message, tone });
    feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 2200);
  }, []);

  const loadDevice = useCallback(async (options?: LoadOptions) => {
    const showLoader = options?.showLoader ?? true;
    const refreshStatus = options?.refreshStatus ?? true;

    try {
      if (showLoader) {
        setLoading(true);
      }
      if (refreshStatus) {
        setIsRefreshingStatus(true);
      }

      const [devices, companionSetupError] = await Promise.all([
        deviceService.getDevices(),
        deviceService.getCompanionSetupError(),
      ]);
      setSavedDevices(devices);
      const foundDevice = devices.find((entry) => entry.id === id);
      if (!foundDevice) {
        Alert.alert('Error', 'Device not found');
        router.back();
        return;
      }

      let nextDevice = foundDevice;
      if (refreshStatus) {
        const isOnline = await deviceService.checkDeviceStatus(foundDevice.ip);
        const nextStatus = isOnline ? 'online' : 'offline';
        if (nextStatus !== foundDevice.status) {
          nextDevice = { ...foundDevice, status: nextStatus };
          await deviceService.saveDevices(
            devices.map((entry) => (entry.id === foundDevice.id ? nextDevice : entry))
          );
        }
      }

      setDevice(nextDevice);
      setStatus(nextDevice.status);
      setSetupMessage(companionSetupError);
    } catch (error) {
      console.error('Error loading device:', error);
      Alert.alert('Error', 'Failed to load device');
    } finally {
      setLoading(false);
      setIsRefreshingStatus(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      loadDevice({ showLoader: true, refreshStatus: true });
    }, [loadDevice])
  );

  useEffect(() => {
    setIsDevicePickerOpen(false);
  }, [id]);

  const runCommand = useCallback(
    async (
      action: () => Promise<unknown>,
      options: {
        errorTitle: string;
        successMessage?: string;
        successHaptic?: 'selection' | 'light' | 'success';
        onSuccess?: () => void;
      }
    ) => {
      try {
        await action();
        options.onSuccess?.();
        triggerHaptic(options.successHaptic ?? 'selection');
        if (options.successMessage) {
          showFeedback(options.successMessage, 'success');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Something went wrong';
        triggerHaptic('error');
        showFeedback(message, 'warning');
        Alert.alert(options.errorTitle, message);
      }
    },
    [showFeedback, triggerHaptic]
  );

  const handleMouseMoveError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Failed to move the cursor';

    if (lastMouseMoveErrorRef.current === message) {
      return;
    }

    lastMouseMoveErrorRef.current = message;
    triggerHaptic('error');
    showFeedback(message, 'warning');
  }, [showFeedback, triggerHaptic]);

  const resetTouchpadTracking = useCallback(() => {
    lastTouchpadTranslationRef.current = { x: 0, y: 0 };
  }, []);

  const flushPendingMouseMove = useCallback(() => {
    if (!device || status !== 'online' || setupMessage || mouseMoveRequestInFlightRef.current) {
      return;
    }

    const dx = Math.trunc(pendingMouseMoveRef.current.x);
    const dy = Math.trunc(pendingMouseMoveRef.current.y);

    if (dx === 0 && dy === 0) {
      return;
    }

    pendingMouseMoveRef.current.x -= dx;
    pendingMouseMoveRef.current.y -= dy;
    mouseMoveRequestInFlightRef.current = true;

    deviceService
      .sendMouseMove(device.id, device.ip, dx, dy)
      .then(() => {
        lastMouseMoveErrorRef.current = null;
      })
      .catch(handleMouseMoveError)
      .finally(() => {
        mouseMoveRequestInFlightRef.current = false;
        if (
          Math.trunc(pendingMouseMoveRef.current.x) !== 0 ||
          Math.trunc(pendingMouseMoveRef.current.y) !== 0
        ) {
          flushPendingMouseMove();
        }
      });
  }, [device, handleMouseMoveError, setupMessage, status]);

  const handleTouchpadGesture = useCallback((event: PanGestureHandlerGestureEvent) => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    const { translationX, translationY } = event.nativeEvent;
    const deltaX = translationX - lastTouchpadTranslationRef.current.x;
    const deltaY = translationY - lastTouchpadTranslationRef.current.y;

    lastTouchpadTranslationRef.current = { x: translationX, y: translationY };

    if (Math.abs(deltaX) < TOUCHPAD_NOISE_THRESHOLD && Math.abs(deltaY) < TOUCHPAD_NOISE_THRESHOLD) {
      return;
    }

    pendingMouseMoveRef.current.x += deltaX * TOUCHPAD_SENSITIVITY;
    pendingMouseMoveRef.current.y += deltaY * TOUCHPAD_SENSITIVITY;
    flushPendingMouseMove();
  }, [device, flushPendingMouseMove, setupMessage, status]);

  const handleTouchpadStateChange = useCallback((event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      resetTouchpadTracking();
      return;
    }

    if (event.nativeEvent.oldState !== State.ACTIVE) {
      return;
    }

    resetTouchpadTracking();
    flushPendingMouseMove();
  }, [flushPendingMouseMove, resetTouchpadTracking]);

  const handleTabChange = useCallback((tab: ControlTab) => {
    setActiveTab(tab);
    setIsDevicePickerOpen(false);
    triggerHaptic('selection');

    if (tab === 'keyboard') {
      setTimeout(() => keyboardInputRef.current?.focus(), 100);
      return;
    }

    Keyboard.dismiss();
  }, [triggerHaptic]);

  const handleDevicePickerToggle = useCallback(() => {
    if (savedDevices.length < 2) {
      return;
    }

    triggerHaptic('selection');
    setIsDevicePickerOpen((current) => !current);
  }, [savedDevices.length, triggerHaptic]);

  const handleDeviceSwitch = useCallback((nextId: string) => {
    setIsDevicePickerOpen(false);
    Keyboard.dismiss();

    if (nextId === id) {
      return;
    }

    router.replace(`/devices/control/${nextId}`);
  }, [id, router]);

  const handleRefreshStatus = useCallback(() => {
    triggerHaptic('selection');
    void loadDevice({ showLoader: false, refreshStatus: true });
  }, [loadDevice, triggerHaptic]);

  const handleMouseClick = useCallback((button: 'left' | 'middle' | 'right') => {
    if (!device || status !== 'online') {
      return;
    }

    const label = button === 'left' ? 'Left click' : button === 'middle' ? 'Middle click' : 'Right click';
    void runCommand(() => deviceService.sendMouseClick(device.id, device.ip, button), {
      errorTitle: `${label} failed`,
      successHaptic: 'light',
    });
  }, [device, runCommand, status]);

  const handleScroll = useCallback((amount: number) => {
    if (!device || status !== 'online') {
      return;
    }
    void runCommand(() => deviceService.sendScroll(device.id, device.ip, amount), {
      errorTitle: 'Scroll failed',
      successHaptic: 'light',
    });
  }, [device, runCommand, status]);

  const handleSpecialKey = useCallback((keyValue: string, label: string) => {
    if (!device || status !== 'online') {
      return;
    }

    void runCommand(() => deviceService.sendSpecialKey(device.id, device.ip, keyValue), {
      errorTitle: `${label} failed`,
      successMessage: `${label} sent`,
      successHaptic: 'light',
    });
  }, [device, runCommand, status]);

  const handleKeyboardSubmit = useCallback(async () => {
    if (!device || status !== 'online' || !keyboardText.trim() || isSendingKeyboard) {
      return;
    }

    try {
      setIsSendingKeyboard(true);
      await deviceService.sendKeyboardInput(device.id, device.ip, keyboardText);
      triggerHaptic('success');
      showFeedback('Text sent', 'success');
      setKeyboardText('');
      keyboardInputRef.current?.focus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      triggerHaptic('error');
      showFeedback(message, 'warning');
      Alert.alert('Keyboard send failed', message);
    } finally {
      setIsSendingKeyboard(false);
    }
  }, [device, isSendingKeyboard, keyboardText, showFeedback, status, triggerHaptic]);

  const handleMediaCommand = useCallback((
    command: 'play_pause' | 'next' | 'previous' | 'volume_up' | 'volume_down' | 'mute'
  ) => {
    if (!device || status !== 'online') {
      return;
    }

    if (command === 'play_pause') {
      void runCommand(() => deviceService.sendMediaPlayPause(device.id, device.ip), {
        errorTitle: 'Play or pause failed',
        successMessage: isPlaying ? 'Paused' : 'Playing',
        successHaptic: 'light',
        onSuccess: () => setIsPlaying((current) => !current),
      });
      return;
    }

    const actionMap = {
      next: () => deviceService.sendMediaNext(device.id, device.ip),
      previous: () => deviceService.sendMediaPrevious(device.id, device.ip),
      volume_up: () => deviceService.sendVolumeUp(device.id, device.ip),
      volume_down: () => deviceService.sendVolumeDown(device.id, device.ip),
      mute: () => deviceService.sendVolumeMute(device.id, device.ip),
    };
    const labelMap = {
      next: 'Next track',
      previous: 'Previous track',
      volume_up: 'Volume up',
      volume_down: 'Volume down',
      mute: 'Mute toggled',
    };

    void runCommand(actionMap[command], {
      errorTitle: `${labelMap[command]} failed`,
      successMessage: labelMap[command],
      successHaptic: 'light',
    });
  }, [device, isPlaying, runCommand, status]);

  const confirmPowerCommand = useCallback((
    title: string,
    message: string,
    action: () => Promise<unknown>,
    errorTitle: string,
    successMessage: string
  ) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () => {
          void runCommand(action, { errorTitle, successMessage, successHaptic: 'success' });
        },
      },
    ]);
  }, [runCommand]);

  const handlePowerCommand = useCallback((command: 'sleep' | 'restart' | 'shutdown' | 'logoff') => {
    if (!device || status !== 'online') {
      return;
    }

    if (command === 'sleep') {
      void runCommand(() => deviceService.sendSleep(device.id, device.ip), {
        errorTitle: 'Sleep command failed',
        successMessage: 'Sleep command sent',
        successHaptic: 'success',
      });
      return;
    }

    if (command === 'restart') {
      confirmPowerCommand(
        'Restart Device',
        'This will restart the computer immediately.',
        () => deviceService.sendRestart(device.id, device.ip),
        'Restart command failed',
        'Restart command sent'
      );
      return;
    }

    if (command === 'shutdown') {
      confirmPowerCommand(
        'Shut Down Device',
        'This will turn the computer off immediately.',
        () => deviceService.sendShutdown(device.id, device.ip),
        'Shutdown command failed',
        'Shutdown command sent'
      );
      return;
    }

    confirmPowerCommand(
      'Log Off User',
      'This will sign out the current desktop session.',
      () => deviceService.sendLogoff(device.id, device.ip),
      'Log off command failed',
      'Log off command sent'
    );
  }, [confirmPowerCommand, device, runCommand, status]);

  const renderKeyboardPanel = () => (
    <View style={styles.keyboardMiniDock}>
      <View style={styles.keyboardComposer}>
        <TextInput
          ref={keyboardInputRef}
          style={styles.keyboardMiniInput}
          value={keyboardText}
          onChangeText={setKeyboardText}
          placeholder="Type, then tap send"
          placeholderTextColor="#8f92a8"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          blurOnSubmit={false}
          enablesReturnKeyAutomatically
          onSubmitEditing={() => void handleKeyboardSubmit()}
        />
        <TouchableOpacity
          style={[styles.keyboardMiniSend, isSendingKeyboard && styles.primaryActionDisabled]}
          onPress={() => void handleKeyboardSubmit()}
          disabled={isSendingKeyboard}
        >
          {isSendingKeyboard ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.keyboardMiniSendText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keyboardMiniQuickRow}
        keyboardShouldPersistTaps="handled"
      >
        {KEYBOARD_QUICK_KEYS.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.keyboardMiniQuickKey, item.wide && styles.keyboardMiniQuickKeyWide]}
            onPress={() => handleSpecialKey(item.keyValue, item.label)}
          >
            <Text style={styles.keyboardMiniQuickKeyText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderKeysPanel = () => (
    <View style={[styles.panelCard, styles.keysPanelCard]}>
      <Text style={styles.panelEyebrow}>Shortcuts</Text>
      <Text style={styles.panelTitle}>Quick Keys</Text>

      <ScrollView
        style={styles.keysScroll}
        contentContainerStyle={styles.keysScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.keySection}>
          <Text style={styles.keySectionTitle}>Modifiers</Text>
          <View style={styles.modifierRow}>
            {MODIFIER_KEYS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.modifierKey}
                onPress={() => handleSpecialKey(item.keyValue, item.label)}
              >
                <Text style={styles.modifierKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.keySection}>
          <Text style={styles.keySectionTitle}>Navigation</Text>
          <View style={styles.keyGrid}>
            {NAVIGATION_KEYS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.gridKey}
                onPress={() => handleSpecialKey(item.keyValue, item.label)}
              >
                <Text style={styles.gridKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.keySection}>
          <Text style={styles.keySectionTitle}>Combos</Text>
          <View style={styles.comboWrap}>
            {PRODUCTIVITY_SHORTCUTS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.comboKey, item.wide && styles.comboKeyWide]}
                onPress={() => handleSpecialKey(item.keyValue, item.label)}
              >
                <Text style={styles.comboKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.keySection}>
          <Text style={styles.keySectionTitle}>Function Row</Text>
          <View style={styles.functionGrid}>
            {FUNCTION_KEYS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.functionKey}
                onPress={() => handleSpecialKey(item.keyValue, item.label)}
              >
                <Text style={styles.functionKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );

  const renderMediaPanel = () => (
    <View style={[styles.panelCard, styles.mediaPanelCard]}>
      <View style={styles.mediaDeck}>
        <View style={styles.mediaWheel}>
          <View style={styles.mediaTransportRow}>
            <TouchableOpacity style={styles.mediaButton} onPress={() => handleMediaCommand('previous')}>
              <SkipBack size={22} color="#f5f6fb" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.mediaButton, styles.mediaButtonPrimary]}
              onPress={() => handleMediaCommand('play_pause')}
            >
              {isPlaying ? <Pause size={26} color="#ffffff" /> : <Play size={26} color="#ffffff" />}
            </TouchableOpacity>

            <TouchableOpacity style={styles.mediaButton} onPress={() => handleMediaCommand('next')}>
              <SkipForward size={22} color="#f5f6fb" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.mediaStack}>
          <TouchableOpacity style={styles.mediaStackButton} onPress={() => handleMediaCommand('volume_up')}>
            <Plus size={20} color="#f5f6fb" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.mediaStackButton} onPress={() => handleMediaCommand('mute')}>
            <VolumeX size={20} color="#f5f6fb" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.mediaStackButton} onPress={() => handleMediaCommand('volume_down')}>
            <Minus size={20} color="#f5f6fb" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderPowerPanel = () => (
    <View style={[styles.panelCard, styles.powerPanelCard]}>
      <View style={styles.powerGrid}>
        <TouchableOpacity style={styles.powerButton} onPress={() => handlePowerCommand('shutdown')}>
          <Power size={22} color="#ffffff" />
          <Text style={styles.powerButtonText}>Shutdown</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.powerButton} onPress={() => handlePowerCommand('sleep')}>
          <Moon size={22} color="#ffffff" />
          <Text style={styles.powerButtonText}>Sleep</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.powerButton} onPress={() => handlePowerCommand('restart')}>
          <RefreshCw size={22} color="#ffffff" />
          <Text style={styles.powerButtonText}>Restart</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.powerButton} onPress={() => handlePowerCommand('logoff')}>
          <LogOut size={22} color="#ffffff" />
          <Text style={styles.powerButtonText}>Logoff</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderDockPanel = () => {
    switch (activeTab) {
      case 'keyboard':
        return renderKeyboardPanel();
      case 'keys':
        return renderKeysPanel();
      case 'media':
        return renderMediaPanel();
      case 'power':
        return renderPowerPanel();
      default:
        return null;
    }
  };

  if (loading || !device) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient colors={['#08070e', '#130f22', '#0b0a12']} style={StyleSheet.absoluteFillObject} />
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>{loading ? 'Loading control panel...' : 'Device not found'}</Text>
      </View>
    );
  }

  const deviceIsOnline = status === 'online';
  const isKeyboardDockActive = isKeyboardVisible && activeTab === 'keyboard';
  const showInteractiveConsole = deviceIsOnline && !setupMessage;
  const hasMultipleDevices = savedDevices.length > 1;
  const feedbackStyle =
    feedback?.tone === 'success'
      ? styles.feedbackSuccess
      : feedback?.tone === 'warning'
        ? styles.feedbackWarning
        : styles.feedbackInfo;

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['#08070e', '#130f22', '#0b0a12']} style={StyleSheet.absoluteFillObject} />
      <View style={styles.glowOrbOne} />
      <View style={styles.glowOrbTwo} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={styles.container}
      >
        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + 8,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
              <ArrowLeft size={22} color="#c4b5fd" />
            </TouchableOpacity>

            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerEyebrow}>WakeMate Remote</Text>
              <Text style={styles.headerTitle}>Control Device</Text>
            </View>

            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerButton}>
              <Settings size={20} color="#c4b5fd" />
            </TouchableOpacity>
          </View>

          {feedback ? (
            <View style={[styles.feedback, feedbackStyle]}>
              <Text style={styles.feedbackText}>{feedback.message}</Text>
            </View>
          ) : null}
          {showInteractiveConsole ? (
            <View style={styles.console}>
              <View style={[styles.remoteStage, isKeyboardDockActive && styles.remoteStageKeyboardVisible]}>
                <LinearGradient
                  colors={['rgba(77, 43, 140, 0.92)', 'rgba(24, 19, 41, 0.98)', 'rgba(8, 7, 14, 1)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={styles.stageTextureOne} />
                <View style={styles.stageTextureTwo} />

                <View style={styles.stageTopOverlay}>
                  <View style={styles.devicePickerWrap}>
                    <TouchableOpacity
                      style={styles.deviceSwitcher}
                      onPress={handleDevicePickerToggle}
                      activeOpacity={hasMultipleDevices ? 0.88 : 1}
                    >
                      <View style={styles.deviceSwitcherStatus}>
                        <View style={[styles.connectionDot, !deviceIsOnline && styles.connectionDotOffline]} />
                      </View>
                      <View style={styles.deviceSwitcherCopy}>
                        <Text style={styles.deviceSwitcherLabel}>Current PC</Text>
                        <Text style={styles.deviceSwitcherName} numberOfLines={1}>{device.name}</Text>
                      </View>
                      {hasMultipleDevices ? <ChevronDown size={18} color="#f5f6fb" /> : null}
                    </TouchableOpacity>

                    {isDevicePickerOpen ? (
                      <View style={styles.devicePickerMenu}>
                        {savedDevices.map((entry) => {
                          const selected = entry.id === device.id;

                          return (
                            <TouchableOpacity
                              key={entry.id}
                              style={[styles.devicePickerItem, selected && styles.devicePickerItemActive]}
                              onPress={() => handleDeviceSwitch(entry.id)}
                            >
                              <Monitor size={16} color={selected ? '#ffffff' : '#cfd2df'} />
                              <View style={styles.devicePickerItemCopy}>
                                <Text style={[styles.devicePickerItemTitle, selected && styles.devicePickerItemTitleActive]} numberOfLines={1}>
                                  {entry.name}
                                </Text>
                                <Text style={styles.devicePickerItemSubtitle} numberOfLines={1}>{entry.ip}</Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity style={styles.stageRefreshButton} onPress={handleRefreshStatus}>
                    {isRefreshingStatus ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <RefreshCw size={16} color="#f5f6fb" />
                    )}
                  </TouchableOpacity>
                </View>

                <GestureHandlerRootView style={styles.touchpadGestureRoot}>
                  <PanGestureHandler
                    onGestureEvent={handleTouchpadGesture}
                    onHandlerStateChange={handleTouchpadStateChange}
                  >
                    <View style={styles.touchpadSurface}>
                      <View style={styles.touchpadHalo} />
                      <View style={styles.touchpadCenter}>
                        <MousePointer size={30} color="#e9ddff" />
                        <Text style={styles.touchpadHint}>Trackpad</Text>
                      </View>
                    </View>
                  </PanGestureHandler>
                </GestureHandlerRootView>

                <View style={[styles.scrollRailOverlay, isKeyboardDockActive && styles.scrollRailOverlayKeyboard]}>
                  <TouchableOpacity style={styles.scrollButtonCompact} onPress={() => handleScroll(4)}>
                    <ChevronUp size={16} color="#f5f6fb" />
                  </TouchableOpacity>

                  <View style={styles.scrollTrack}>
                    <View style={styles.scrollThumb} />
                  </View>

                  <TouchableOpacity style={styles.scrollButtonCompact} onPress={() => handleScroll(-4)}>
                    <ChevronDown size={16} color="#f5f6fb" />
                  </TouchableOpacity>
                </View>

                <View style={[styles.clickRailOverlay, isKeyboardDockActive && styles.clickRailOverlayKeyboard]}>
                  <TouchableOpacity
                    style={[styles.clickKey, styles.clickKeyWide]}
                    onPress={() => handleMouseClick('left')}
                    accessibilityLabel="Left click"
                  >
                    <Text style={styles.clickKeyText}>L</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.clickKey}
                    onPress={() => handleMouseClick('middle')}
                    accessibilityLabel="Middle click"
                  >
                    <Text style={styles.clickKeyText}>M</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.clickKey, styles.clickKeyWide]}
                    onPress={() => handleMouseClick('right')}
                    accessibilityLabel="Right click"
                  >
                    <Text style={styles.clickKeyText}>R</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[styles.bottomDock, isKeyboardDockActive && styles.bottomDockKeyboardVisible]}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabRailContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
                    const active = activeTab === key;

                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.tabButton, active && styles.activeTabButton]}
                        onPress={() => handleTabChange(key)}
                        accessibilityLabel={`Open ${label} panel`}
                      >
                        <Icon size={17} color={active ? '#f7f2ff' : '#a8a8ba'} />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {renderDockPanel()}
              </View>
            </View>
          ) : (
            <View style={styles.fallbackCard}>
              <Text style={styles.panelEyebrow}>{deviceIsOnline ? 'Companion setup' : 'Device offline'}</Text>
              <Text style={styles.panelTitle}>
                {deviceIsOnline ? 'Finish Companion Setup' : 'Remote controls are paused'}
              </Text>
              <Text style={styles.panelDescription}>
                {deviceIsOnline
                  ? setupMessage
                  : 'WakeMate needs to confirm the computer is online again before it enables the control dock.'}
              </Text>

              <View style={styles.fallbackActions}>
                <TouchableOpacity style={styles.secondaryAction} onPress={handleRefreshStatus}>
                  <Text style={styles.secondaryActionText}>Refresh Status</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={() => (deviceIsOnline ? router.push('/settings') : router.replace(`/devices/${device.id}`))}
                >
                  <Text style={styles.primaryActionText}>
                    {deviceIsOnline ? 'Open Settings' : 'Back to Device'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#08070e',
  },
  container: {
    flex: 1,
  },
  glowOrbOne: {
    position: 'absolute',
    top: -90,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.16)',
  },
  glowOrbTwo: {
    position: 'absolute',
    bottom: 120,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(76, 29, 149, 0.18)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#f5f6fb',
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 12,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(18, 16, 28, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(196, 181, 253, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerEyebrow: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 28,
    backgroundColor: 'rgba(17, 16, 25, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(196, 181, 253, 0.1)',
  },
  sessionCopy: {
    flex: 1,
  },
  sessionDevice: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  sessionIp: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 4,
  },
  sessionActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeOnline: {
    backgroundColor: 'rgba(52, 211, 153, 0.16)',
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(244, 114, 182, 0.14)',
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  refreshPill: {
    minWidth: 102,
    borderRadius: 999,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshPillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  feedback: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  feedbackInfo: {
    backgroundColor: 'rgba(30, 41, 59, 0.96)',
  },
  feedbackSuccess: {
    backgroundColor: 'rgba(20, 83, 45, 0.96)',
  },
  feedbackWarning: {
    backgroundColor: 'rgba(127, 29, 29, 0.96)',
  },
  feedbackText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  console: {
    flex: 1,
    minHeight: 0,
    gap: 10,
  },
  remoteStage: {
    flex: 1,
    minHeight: 340,
    borderRadius: 34,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(233, 221, 255, 0.12)',
  },
  remoteStageKeyboardVisible: {
    minHeight: 212,
  },
  stageTextureOne: {
    position: 'absolute',
    top: -30,
    left: -10,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  stageTextureTwo: {
    position: 'absolute',
    right: -40,
    bottom: 20,
    width: 180,
    height: 260,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  stageTopOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  devicePickerWrap: {
    flex: 1,
    maxWidth: '82%',
  },
  deviceSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(15, 16, 25, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  deviceSwitcherStatus: {
    width: 14,
    alignItems: 'center',
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#4ade80',
  },
  connectionDotOffline: {
    backgroundColor: '#f472b6',
  },
  deviceSwitcherCopy: {
    flex: 1,
    minWidth: 0,
  },
  deviceSwitcherLabel: {
    color: '#d8d2e8',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  deviceSwitcherName: {
    color: '#f5f6fb',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  devicePickerMenu: {
    marginTop: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 18, 27, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 8,
    gap: 6,
  },
  devicePickerItem: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  devicePickerItemActive: {
    backgroundColor: '#7c3aed',
  },
  devicePickerItemCopy: {
    flex: 1,
    minWidth: 0,
  },
  devicePickerItemTitle: {
    color: '#f5f6fb',
    fontSize: 13,
    fontWeight: '700',
  },
  devicePickerItemTitleActive: {
    color: '#ffffff',
  },
  devicePickerItemSubtitle: {
    color: '#b5b9ca',
    fontSize: 11,
    marginTop: 2,
  },
  stageRefreshButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 16, 25, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchpadGestureRoot: {
    flex: 1,
  },
  touchpadSurface: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: 'rgba(15, 16, 25, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 26,
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 240,
  },
  touchpadHalo: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.16)',
  },
  touchpadCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  touchpadHint: {
    color: '#ece7f8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  scrollRailOverlay: {
    position: 'absolute',
    top: 76,
    right: 12,
    bottom: 78,
    width: 38,
    alignItems: 'center',
    gap: 8,
  },
  scrollRailOverlayKeyboard: {
    top: 62,
    bottom: 58,
  },
  scrollButtonCompact: {
    width: 34,
    height: 34,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 16, 25, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollTrack: {
    flex: 1,
    width: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 16, 25, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  scrollThumb: {
    width: 4,
    height: 78,
    borderRadius: 999,
    backgroundColor: 'rgba(243, 232, 255, 0.72)',
  },
  clickRailOverlay: {
    position: 'absolute',
    left: 12,
    right: 58,
    bottom: 12,
    flexDirection: 'row',
    gap: 4,
  },
  clickRailOverlayKeyboard: {
    bottom: 8,
  },
  bottomDock: {
    borderRadius: 24,
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 0,
  },
  bottomDockKeyboardVisible: {
    paddingBottom: 4,
  },
  clickKey: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: '#2b2e36',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  clickKeyWide: {
    flex: 1,
  },
  clickKeyText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },
  tabRailContent: {
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  tabButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(37, 39, 48, 0.64)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeTabButton: {
    backgroundColor: '#7c3aed',
  },
  tabLabel: {
    color: '#a8a8ba',
    fontSize: 12,
    fontWeight: '700',
  },
  activeTabLabel: {
    color: '#ffffff',
  },
  panelCard: {
    borderRadius: 24,
    backgroundColor: '#191c24',
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  panelEyebrow: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  panelTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  panelDescription: {
    color: '#a6abbc',
    fontSize: 13,
    lineHeight: 19,
  },
  keyboardMiniDock: {
    borderRadius: 18,
    backgroundColor: '#191c24',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 10,
    gap: 8,
  },
  keyboardComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  keyboardMiniInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: '#252934',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryAction: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionDisabled: {
    opacity: 0.72,
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  keyboardMiniSend: {
    minWidth: 58,
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  keyboardMiniSendText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  keyboardMiniQuickRow: {
    gap: 8,
    paddingRight: 2,
  },
  keyboardMiniQuickKey: {
    minHeight: 32,
    borderRadius: 12,
    backgroundColor: '#272b35',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardMiniQuickKeyWide: {
    paddingHorizontal: 15,
  },
  keyboardMiniQuickKeyText: {
    color: '#f5f6fb',
    fontSize: 11,
    fontWeight: '700',
  },
  keysPanelCard: {
    maxHeight: 300,
    paddingTop: 14,
    gap: 10,
  },
  keysScroll: {
    maxHeight: 214,
  },
  keysScrollContent: {
    gap: 12,
    paddingBottom: 2,
  },
  keySection: {
    gap: 8,
  },
  keySectionTitle: {
    color: '#d6bcfa',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  modifierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modifierKey: {
    minWidth: 64,
    minHeight: 38,
    borderRadius: 14,
    backgroundColor: '#272b35',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modifierKeyText: {
    color: '#f5f6fb',
    fontSize: 12,
    fontWeight: '700',
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridKey: {
    width: '21.5%',
    minWidth: 60,
    minHeight: 40,
    borderRadius: 14,
    backgroundColor: '#272b35',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  gridKeyText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  comboWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  comboKey: {
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: '#2d2243',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboKeyWide: {
    width: '100%',
  },
  comboKeyText: {
    color: '#f7f2ff',
    fontSize: 13,
    fontWeight: '700',
  },
  functionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  functionKey: {
    width: '22%',
    minWidth: 68,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: '#252934',
    alignItems: 'center',
    justifyContent: 'center',
  },
  functionKeyText: {
    color: '#f5f6fb',
    fontSize: 12,
    fontWeight: '700',
  },
  mediaPanelCard: {
    gap: 10,
    padding: 12,
  },
  mediaDeck: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mediaWheel: {
    flex: 1,
    minHeight: 120,
    borderRadius: 22,
    backgroundColor: '#12151d',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  mediaTransportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mediaButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2a2e38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaButtonPrimary: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7c3aed',
  },
  mediaStack: {
    gap: 8,
  },
  mediaStackButton: {
    width: 64,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#252934',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  powerPanelCard: {
    padding: 12,
  },
  powerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  powerButton: {
    width: '47.8%',
    minHeight: 84,
    borderRadius: 18,
    backgroundColor: '#252934',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 6,
  },
  powerButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  fallbackCard: {
    borderRadius: 30,
    backgroundColor: 'rgba(17, 16, 25, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(196, 181, 253, 0.1)',
    padding: 20,
    gap: 12,
  },
  fallbackActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: '#252934',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryActionText: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '700',
  },
});

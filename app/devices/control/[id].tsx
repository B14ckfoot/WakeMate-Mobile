import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
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
  X,
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
import { VolumeManager } from 'react-native-volume-manager';
import { Device, DevicePlatform } from '../../../src/types/device';
import deviceService from '../../../src/services/deviceService';
import {
  getPrimaryShortcutModifier,
  inferDevicePlatformFromMetadata,
  normalizeDevicePlatform,
} from '../../../src/utils/devicePlatform';

type ControlTab = 'mouse' | 'keyboard' | 'keys' | 'media' | 'power';
type FeedbackTone = 'info' | 'success' | 'warning';
type ActionFeedback = { message: string; tone: FeedbackTone };
type LoadOptions = { showLoader?: boolean; refreshStatus?: boolean };
type QuickKey = { label: string; keyValue: string; wide?: boolean };
type KeyboardAccessoryMode = 'modifiers' | 'functions' | null;
type ControlSettings = {
  trackingSpeed: number;
  scrollingSpeed: number;
  disableSleep: boolean;
  useVolumeButtons: boolean;
};

const TOUCHPAD_SENSITIVITY = 1.2;
const TOUCHPAD_NOISE_THRESHOLD = 0.1;
const TOUCHPAD_SCROLL_STEP_PX = 18;
const TOUCHPAD_DRAG_HOLD_MS = 220;
const TOUCHPAD_TAP_MAX_DURATION_MS = 250;
const TOUCHPAD_TAP_MAX_DISTANCE = 10;
const SCROLL_TRACK_PADDING_Y = 10;
const SCROLL_THUMB_HEIGHT = 78;
const TRACKING_SPEED_MIN = 0.45;
const TRACKING_SPEED_MAX = 2.6;
const SCROLL_SPEED_MIN = 0.45;
const SCROLL_SPEED_MAX = 2.4;
const CONTROL_SETTINGS_STORAGE_KEY = 'deviceControlRemoteSettings';
const CONTROL_KEEP_AWAKE_TAG = 'DeviceControlRemote';

type TouchpadMode = 'pointer' | 'scroll';
type TwoFingerTapCandidate = {
  startedAt: number;
  maxDistance: number;
};

const TAB_ITEMS = [
  { key: 'keyboard' as const, label: 'Keyboard', icon: KeyboardIcon },
  { key: 'keys' as const, label: 'Keys', icon: Command },
  { key: 'media' as const, label: 'Media', icon: Music },
  { key: 'power' as const, label: 'Power', icon: Power },
];

const KEYBOARD_QUICK_KEYS: QuickKey[] = [
  { label: 'Esc', keyValue: 'esc' },
  { label: 'Tab', keyValue: 'tab' },
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

const DEFAULT_CONTROL_SETTINGS: ControlSettings = {
  trackingSpeed: 0.52,
  scrollingSpeed: 0.48,
  disableSleep: true,
  useVolumeButtons: false,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const scaleSetting = (value: number, min: number, max: number) => min + clamp(value, 0, 1) * (max - min);

type SettingsSliderProps = {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
};

const SettingsSlider: React.FC<SettingsSliderProps> = ({ label, description, value, onChange }) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbSize = 22;
  const clampedValue = clamp(value, 0, 1);
  const thumbLeft = trackWidth > thumbSize ? clampedValue * (trackWidth - thumbSize) : 0;

  const updateValueFromLocation = (locationX: number) => {
    if (trackWidth <= 0) {
      return;
    }

    onChange(clamp(locationX / trackWidth, 0, 1));
  };

  return (
    <View style={styles.settingBlock}>
      <View style={styles.settingBlockHeader}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{Math.round(clampedValue * 100)}%</Text>
      </View>
      <Text style={styles.settingDescription}>{description}</Text>
      <View
        style={styles.sliderTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => updateValueFromLocation(event.nativeEvent.locationX)}
        onResponderMove={(event) => updateValueFromLocation(event.nativeEvent.locationX)}
      >
        <View pointerEvents="none" style={[styles.sliderFill, { width: `${clampedValue * 100}%` }]} />
        <View pointerEvents="none" style={[styles.sliderThumb, { left: thumbLeft }]} />
      </View>
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabelText}>Slow</Text>
        <Text style={styles.sliderLabelText}>Fast</Text>
      </View>
    </View>
  );
};

const getModifierKeys = (platform: DevicePlatform): QuickKey[] =>
  platform === 'mac'
    ? [
        { label: 'Shift', keyValue: 'shift' },
        { label: 'Command', keyValue: 'command' },
        { label: 'Option', keyValue: 'option' },
        { label: 'Control', keyValue: 'control' },
      ]
    : [
        { label: 'Shift', keyValue: 'shift' },
        { label: 'Ctrl', keyValue: 'ctrl' },
        { label: 'Win', keyValue: 'win' },
        { label: 'Alt', keyValue: 'alt' },
      ];

const getProductivityShortcuts = (platform: DevicePlatform): QuickKey[] =>
  platform === 'mac'
    ? [
        { label: 'Command+C', keyValue: 'command+c' },
        { label: 'Command+V', keyValue: 'command+v' },
        { label: 'Command+Z', keyValue: 'command+z' },
        { label: 'Command+Tab', keyValue: 'command+tab' },
        { label: 'Command+Space', keyValue: 'command+space' },
        { label: 'Option+Shift', keyValue: 'option+shift', wide: true },
      ]
    : [
        { label: 'Ctrl+C', keyValue: 'ctrl+c' },
        { label: 'Ctrl+V', keyValue: 'ctrl+v' },
        { label: 'Ctrl+Z', keyValue: 'ctrl+z' },
        { label: 'Alt+Tab', keyValue: 'alt+tab' },
        { label: 'Win+D', keyValue: 'win+d' },
        { label: 'Ctrl+Alt+Delete', keyValue: 'ctrl+alt+delete', wide: true },
      ];

export default function DeviceControlScreen() {
  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [device, setDevice] = useState<Device | null>(null);
  const [savedDevices, setSavedDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ControlTab>('mouse');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const [isSendingKeyboard, setIsSendingKeyboard] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardAccessoryMode, setKeyboardAccessoryMode] = useState<KeyboardAccessoryMode>(null);
  const [controlSettings, setControlSettings] = useState<ControlSettings>(DEFAULT_CONTROL_SETTINGS);
  const [hasLoadedControlSettings, setHasLoadedControlSettings] = useState(false);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [scrollThumbOffset, setScrollThumbOffset] = useState(0);

  const keyboardInputRef = useRef<TextInput>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTouchpadCommandErrorRef = useRef<string | null>(null);
  const lastTouchpadTranslationRef = useRef({ x: 0, y: 0 });
  const pendingMouseMoveRef = useRef({ x: 0, y: 0 });
  const pendingScrollRef = useRef(0);
  const mouseMoveRequestInFlightRef = useRef(false);
  const dragHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActivationPendingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const gestureModeRef = useRef<TouchpadMode>('pointer');
  const twoFingerTapCandidateRef = useRef<TwoFingerTapCandidate | null>(null);
  const touchpadHeightRef = useRef(0);
  const scrollTrackHeightRef = useRef(0);
  const lastScrollRailLocationYRef = useRef<number | null>(null);
  const volumeListenerRef = useRef<{ remove: () => void } | null>(null);
  const baselineVolumeRef = useRef(0.5);
  const lastVolumeRef = useRef(0.5);
  const isResettingVolumeRef = useRef(false);

  const trackingSpeedMultiplier = scaleSetting(controlSettings.trackingSpeed, TRACKING_SPEED_MIN, TRACKING_SPEED_MAX);
  const scrollingSpeedMultiplier = scaleSetting(controlSettings.scrollingSpeed, SCROLL_SPEED_MIN, SCROLL_SPEED_MAX);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      if (dragHoldTimeoutRef.current) {
        clearTimeout(dragHoldTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadControlSettings = async () => {
      try {
        const stored = await AsyncStorage.getItem(CONTROL_SETTINGS_STORAGE_KEY);
        if (!stored || !isMounted) {
          return;
        }

        const parsed = JSON.parse(stored) as Partial<ControlSettings>;
        setControlSettings((current) => ({
          trackingSpeed:
            typeof parsed.trackingSpeed === 'number' ? clamp(parsed.trackingSpeed, 0, 1) : current.trackingSpeed,
          scrollingSpeed:
            typeof parsed.scrollingSpeed === 'number' ? clamp(parsed.scrollingSpeed, 0, 1) : current.scrollingSpeed,
          disableSleep: typeof parsed.disableSleep === 'boolean' ? parsed.disableSleep : current.disableSleep,
          useVolumeButtons:
            typeof parsed.useVolumeButtons === 'boolean' ? parsed.useVolumeButtons : current.useVolumeButtons,
        }));
      } catch (error) {
        console.warn('Failed to load device control settings:', error);
      } finally {
        if (isMounted) {
          setHasLoadedControlSettings(true);
        }
      }
    };

    void loadControlSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedControlSettings) {
      return;
    }

    void AsyncStorage.setItem(CONTROL_SETTINGS_STORAGE_KEY, JSON.stringify(controlSettings)).catch((error) => {
      console.warn('Failed to save device control settings:', error);
    });
  }, [controlSettings, hasLoadedControlSettings]);

  useEffect(() => {
    const syncKeepAwake = async () => {
      try {
        if (controlSettings.disableSleep) {
          await activateKeepAwakeAsync(CONTROL_KEEP_AWAKE_TAG);
          return;
        }

        await deactivateKeepAwake(CONTROL_KEEP_AWAKE_TAG);
      } catch (error) {
        console.warn('Failed to update device control keep-awake state:', error);
      }
    };

    void syncKeepAwake();

    return () => {
      void deactivateKeepAwake(CONTROL_KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [controlSettings.disableSleep]);

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

      const devices = await deviceService.getDevices();
      setSavedDevices(devices);
      const foundDevice = devices.find((entry) => entry.id === id);
      if (!foundDevice) {
        Alert.alert('Error', 'Device not found');
        router.back();
        return;
      }

      setDevice(foundDevice);
      setStatus(foundDevice.status);

      if (showLoader) {
        setLoading(false);
      }

      const [companionSetupError, isOnline] = await Promise.all([
        deviceService.getCompanionSetupError({ validateToken: true }),
        refreshStatus ? deviceService.checkDeviceStatus(foundDevice.ip) : Promise.resolve(foundDevice.status === 'online'),
      ]);

      let nextDevice = foundDevice;
      const nextStatus = isOnline ? 'online' : 'offline';
      if (nextStatus !== foundDevice.status) {
        nextDevice = { ...foundDevice, status: nextStatus };
        setDevice(nextDevice);
        setStatus(nextStatus);
        await deviceService.saveDevices(
          devices.map((entry) => (entry.id === foundDevice.id ? nextDevice : entry))
        );
      }

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

  const handleTouchpadCommandError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Trackpad command failed';

    if (lastTouchpadCommandErrorRef.current === message) {
      return;
    }

    lastTouchpadCommandErrorRef.current = message;
    triggerHaptic('error');
    showFeedback(message, 'warning');
  }, [showFeedback, triggerHaptic]);

  const resetTouchpadTracking = useCallback(() => {
    lastTouchpadTranslationRef.current = { x: 0, y: 0 };
  }, []);

  const clearDragHoldTimeout = useCallback(() => {
    if (dragHoldTimeoutRef.current) {
      clearTimeout(dragHoldTimeoutRef.current);
      dragHoldTimeoutRef.current = null;
    }
  }, []);

  const determineTouchpadMode = useCallback((y: number): TouchpadMode => {
    void y;
    return 'pointer';
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
        lastTouchpadCommandErrorRef.current = null;
      })
      .catch(handleTouchpadCommandError)
      .finally(() => {
        mouseMoveRequestInFlightRef.current = false;
        if (
          Math.trunc(pendingMouseMoveRef.current.x) !== 0 ||
          Math.trunc(pendingMouseMoveRef.current.y) !== 0
        ) {
          flushPendingMouseMove();
        }
      });
  }, [device, handleTouchpadCommandError, setupMessage, status]);

  const flushPendingScroll = useCallback(() => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    const pendingScroll = pendingScrollRef.current;
    const steps = Math.trunc(Math.abs(pendingScroll) / TOUCHPAD_SCROLL_STEP_PX);

    if (steps === 0) {
      return;
    }

    pendingScrollRef.current -= Math.sign(pendingScroll) * steps * TOUCHPAD_SCROLL_STEP_PX;

    void deviceService
      .sendScroll(device.id, device.ip, pendingScroll < 0 ? steps : -steps)
      .then(() => {
        lastTouchpadCommandErrorRef.current = null;
      })
      .catch(handleTouchpadCommandError);
  }, [device, handleTouchpadCommandError, setupMessage, status]);

  const getScrollThumbTravel = useCallback(() => {
    const travel = scrollTrackHeightRef.current - SCROLL_TRACK_PADDING_Y * 2 - SCROLL_THUMB_HEIGHT;
    return Math.max(0, travel);
  }, []);

  const updateScrollThumbOffset = useCallback((deltaY: number) => {
    const maxTravel = getScrollThumbTravel() / 2;

    if (maxTravel <= 0) {
      return;
    }

    setScrollThumbOffset((current) => {
      const next = current + deltaY;
      return Math.max(-maxTravel, Math.min(maxTravel, next));
    });
  }, [getScrollThumbTravel]);

  const handleScrollRailDelta = useCallback((deltaY: number) => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    if (Math.abs(deltaY) < TOUCHPAD_NOISE_THRESHOLD) {
      return;
    }

    pendingScrollRef.current += deltaY * scrollingSpeedMultiplier;
    updateScrollThumbOffset(deltaY);
    flushPendingScroll();
  }, [device, flushPendingScroll, scrollingSpeedMultiplier, setupMessage, status, updateScrollThumbOffset]);

  const resetScrollRailDrag = useCallback(() => {
    lastScrollRailLocationYRef.current = null;
    setScrollThumbOffset(0);
  }, []);

  const handleTwoFingerTap = useCallback(() => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    triggerHaptic('light');
    void deviceService
      .sendMouseClick(device.id, device.ip, 'left')
      .then(() => {
        lastTouchpadCommandErrorRef.current = null;
      })
      .catch(handleTouchpadCommandError);
  }, [device, handleTouchpadCommandError, setupMessage, status, triggerHaptic]);

  const beginDragGesture = useCallback(() => {
    if (!device || status !== 'online' || setupMessage || gestureModeRef.current === 'scroll' || isDraggingRef.current) {
      return;
    }

    isDraggingRef.current = true;
    dragActivationPendingRef.current = true;
    triggerHaptic('light');

    void deviceService
      .sendMouseButtonDown(device.id, device.ip, 'left')
      .then(() => {
        lastTouchpadCommandErrorRef.current = null;
      })
      .catch((error) => {
        isDraggingRef.current = false;
        handleTouchpadCommandError(error);
      })
      .finally(() => {
        dragActivationPendingRef.current = false;
      });
  }, [device, handleTouchpadCommandError, setupMessage, status, triggerHaptic]);

  const releaseDragGesture = useCallback(() => {
    clearDragHoldTimeout();

    if (!device || status !== 'online' || setupMessage) {
      isDraggingRef.current = false;
      dragActivationPendingRef.current = false;
      return;
    }

    if (!isDraggingRef.current && !dragActivationPendingRef.current) {
      return;
    }

    isDraggingRef.current = false;
    dragActivationPendingRef.current = false;

    void deviceService
      .sendMouseButtonUp(device.id, device.ip, 'left')
      .then(() => {
        lastTouchpadCommandErrorRef.current = null;
      })
      .catch(handleTouchpadCommandError);
  }, [clearDragHoldTimeout, device, handleTouchpadCommandError, setupMessage, status]);

  const finishTouchpadGesture = useCallback(() => {
    clearDragHoldTimeout();

    const tapCandidate = twoFingerTapCandidateRef.current;
    twoFingerTapCandidateRef.current = null;

    if (
      tapCandidate &&
      Date.now() - tapCandidate.startedAt <= TOUCHPAD_TAP_MAX_DURATION_MS &&
      tapCandidate.maxDistance <= TOUCHPAD_TAP_MAX_DISTANCE
    ) {
      handleTwoFingerTap();
    }

    pendingScrollRef.current = 0;
    resetTouchpadTracking();
    flushPendingMouseMove();
    releaseDragGesture();
  }, [clearDragHoldTimeout, flushPendingMouseMove, handleTwoFingerTap, releaseDragGesture, resetTouchpadTracking]);

  const handleTouchpadGesture = useCallback((event: PanGestureHandlerGestureEvent) => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    const { numberOfPointers, translationX, translationY } = event.nativeEvent;

    if (numberOfPointers === 2) {
      clearDragHoldTimeout();

      if (twoFingerTapCandidateRef.current) {
        twoFingerTapCandidateRef.current.maxDistance = Math.max(
          twoFingerTapCandidateRef.current.maxDistance,
          Math.abs(translationX),
          Math.abs(translationY)
        );
      }
      return;
    }

    if (numberOfPointers !== 1) {
      clearDragHoldTimeout();
      return;
    }

    const deltaX = translationX - lastTouchpadTranslationRef.current.x;
    const deltaY = translationY - lastTouchpadTranslationRef.current.y;

    lastTouchpadTranslationRef.current = { x: translationX, y: translationY };

    if (
      gestureModeRef.current === 'scroll' ||
      Math.abs(translationX) > TOUCHPAD_TAP_MAX_DISTANCE ||
      Math.abs(translationY) > TOUCHPAD_TAP_MAX_DISTANCE
    ) {
      clearDragHoldTimeout();
    }

    if (Math.abs(deltaX) < TOUCHPAD_NOISE_THRESHOLD && Math.abs(deltaY) < TOUCHPAD_NOISE_THRESHOLD) {
      return;
    }

    if (gestureModeRef.current === 'scroll') {
    pendingScrollRef.current += deltaY * scrollingSpeedMultiplier;
      flushPendingScroll();
      return;
    }

    pendingMouseMoveRef.current.x += deltaX * TOUCHPAD_SENSITIVITY * trackingSpeedMultiplier;
    pendingMouseMoveRef.current.y += deltaY * TOUCHPAD_SENSITIVITY * trackingSpeedMultiplier;
    flushPendingMouseMove();
  }, [
    clearDragHoldTimeout,
    device,
    flushPendingMouseMove,
    flushPendingScroll,
    scrollingSpeedMultiplier,
    setupMessage,
    status,
    trackingSpeedMultiplier,
  ]);

  const handleTouchpadStateChange = useCallback((event: PanGestureHandlerStateChangeEvent) => {
    const { numberOfPointers, state, y } = event.nativeEvent;

    if (state === State.BEGAN) {
      resetTouchpadTracking();
      pendingScrollRef.current = 0;
      clearDragHoldTimeout();
      gestureModeRef.current = determineTouchpadMode(y);
      twoFingerTapCandidateRef.current = numberOfPointers === 2
        ? { startedAt: Date.now(), maxDistance: 0 }
        : null;

      if (numberOfPointers === 1 && gestureModeRef.current === 'pointer') {
        dragHoldTimeoutRef.current = setTimeout(() => {
          dragHoldTimeoutRef.current = null;
          beginDragGesture();
        }, TOUCHPAD_DRAG_HOLD_MS);
      }

      return;
    }

    if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      finishTouchpadGesture();
      return;
    }

    if (event.nativeEvent.oldState === State.ACTIVE) {
      finishTouchpadGesture();
    }
  }, [
    beginDragGesture,
    clearDragHoldTimeout,
    determineTouchpadMode,
    finishTouchpadGesture,
    resetTouchpadTracking,
  ]);

  const refocusKeyboardInput = useCallback((delay = 80) => {
    setTimeout(() => keyboardInputRef.current?.focus(), delay);
  }, []);

  const handleTabChange = useCallback((tab: ControlTab) => {
    setIsDevicePickerOpen(false);
    triggerHaptic('selection');

    if (tab === activeTab && tab !== 'keys') {
      setKeyboardAccessoryMode(null);
      setActiveTab('mouse');
      Keyboard.dismiss();
      return;
    }

    if (tab === 'keyboard') {
      setKeyboardAccessoryMode(null);
      setActiveTab('keyboard');
      refocusKeyboardInput(100);
      return;
    }

    if (tab === 'keys' && activeTab === 'keyboard') {
      setKeyboardAccessoryMode((current) => (current ? null : 'modifiers'));
      refocusKeyboardInput(60);
      return;
    }

    setKeyboardAccessoryMode(null);
    setActiveTab(tab);
    Keyboard.dismiss();
  }, [activeTab, refocusKeyboardInput, triggerHaptic]);

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

  const handleScrollRailGrant = useCallback((locationY: number) => {
    lastScrollRailLocationYRef.current = locationY;
    triggerHaptic('selection');
  }, [triggerHaptic]);

  const handleScrollRailMove = useCallback((locationY: number) => {
    const previousLocationY = lastScrollRailLocationYRef.current;
    lastScrollRailLocationYRef.current = locationY;

    if (previousLocationY === null) {
      return;
    }

    handleScrollRailDelta(locationY - previousLocationY);
  }, [handleScrollRailDelta]);

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
      refocusKeyboardInput(40);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      triggerHaptic('error');
      showFeedback(message, 'warning');
      Alert.alert('Keyboard send failed', message);
    } finally {
      setIsSendingKeyboard(false);
    }
  }, [device, isSendingKeyboard, keyboardText, refocusKeyboardInput, showFeedback, status, triggerHaptic]);

  const handleKeyboardQuickKey = useCallback((keyValue: string, label: string) => {
    handleSpecialKey(keyValue, label);
    refocusKeyboardInput(40);
  }, [handleSpecialKey, refocusKeyboardInput]);

  const devicePlatform = normalizeDevicePlatform(
    inferDevicePlatformFromMetadata(
      {
        platform: device?.platform,
        name: device?.name,
      },
      device?.name
    )
  );
  const primaryShortcutModifier = getPrimaryShortcutModifier(devicePlatform);
  const modifierKeys = getModifierKeys(devicePlatform);
  const productivityShortcuts = getProductivityShortcuts(devicePlatform);
  const keyboardAccessoryTitle =
    keyboardAccessoryMode === 'functions' ? 'Fn Keys' : `${primaryShortcutModifier.label} Keys`;

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

  const handleHardwareVolumeRemoteStep = useCallback((direction: 'up' | 'down') => {
    if (!device || status !== 'online' || setupMessage) {
      return;
    }

    const action = direction === 'up'
      ? deviceService.sendVolumeUp(device.id, device.ip)
      : deviceService.sendVolumeDown(device.id, device.ip);

    void action.catch((error) => {
      const message = error instanceof Error ? error.message : 'Hardware volume remote failed';
      showFeedback(message, 'warning');
    });
  }, [device, setupMessage, showFeedback, status]);

  const handleHardwareVolumeChange = useCallback((nextVolume: number) => {
    if (isResettingVolumeRef.current) {
      isResettingVolumeRef.current = false;
      lastVolumeRef.current = baselineVolumeRef.current;
      return;
    }

    const volumeDelta = nextVolume - lastVolumeRef.current;
    lastVolumeRef.current = nextVolume;

    if (Math.abs(volumeDelta) < 0.01) {
      return;
    }

    handleHardwareVolumeRemoteStep(volumeDelta > 0 ? 'up' : 'down');
    isResettingVolumeRef.current = true;

    void VolumeManager.setVolume(baselineVolumeRef.current, {
      playSound: false,
      showUI: false,
    })
      .then(() => {
        lastVolumeRef.current = baselineVolumeRef.current;
      })
      .catch((error) => {
        isResettingVolumeRef.current = false;
        console.warn('Failed to restore hardware volume baseline:', error);
      });
  }, [handleHardwareVolumeRemoteStep]);

  useEffect(() => {
    let isCancelled = false;

    const teardownVolumeListener = () => {
      volumeListenerRef.current?.remove();
      volumeListenerRef.current = null;
      isResettingVolumeRef.current = false;
    };

    if (!controlSettings.useVolumeButtons) {
      teardownVolumeListener();
      void VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
      return;
    }

    const enableHardwareVolumeRemote = async () => {
      try {
        teardownVolumeListener();
        await VolumeManager.showNativeVolumeUI({ enabled: false });

        const { volume } = await VolumeManager.getVolume();
        if (isCancelled) {
          return;
        }

        baselineVolumeRef.current = volume;
        lastVolumeRef.current = volume;
        volumeListenerRef.current = VolumeManager.addVolumeListener(({ volume: changedVolume }) => {
          handleHardwareVolumeChange(changedVolume);
        });
      } catch (error) {
        teardownVolumeListener();

        if (!isCancelled) {
          console.warn('Failed to enable hardware volume remote:', error);
          Alert.alert(
            'Volume button remote unavailable',
            'This option needs a development build on a physical device so WakeMate can listen for hardware volume presses.'
          );
          setControlSettings((current) => ({ ...current, useVolumeButtons: false }));
        }
      }
    };

    void enableHardwareVolumeRemote();

    return () => {
      isCancelled = true;
      teardownVolumeListener();
      void VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
    };
  }, [controlSettings.useVolumeButtons, handleHardwareVolumeChange]);

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
            onPress={() => handleKeyboardQuickKey(item.keyValue, item.label)}
          >
            <Text style={styles.keyboardMiniQuickKeyText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderKeyboardQuickKeysOverlay = () => (
    <View style={styles.keyboardAccessoryCard}>
      <View style={styles.keyboardAccessoryHeader}>
        <Text style={styles.keyboardAccessoryTitle}>{keyboardAccessoryTitle}</Text>
        <Text style={styles.keyboardAccessoryHint}>Keyboard stays open</Text>
      </View>

      <View style={styles.keyboardAccessoryToggleRow}>
        <TouchableOpacity
          style={[
            styles.keyboardAccessoryToggle,
            keyboardAccessoryMode === 'modifiers' && styles.keyboardAccessoryToggleActive,
          ]}
          onPress={() => {
            setKeyboardAccessoryMode('modifiers');
            refocusKeyboardInput(40);
          }}
        >
          <Text
            style={[
              styles.keyboardAccessoryToggleText,
              keyboardAccessoryMode === 'modifiers' && styles.keyboardAccessoryToggleTextActive,
            ]}
          >
            {primaryShortcutModifier.label}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.keyboardAccessoryToggle,
            keyboardAccessoryMode === 'functions' && styles.keyboardAccessoryToggleActive,
          ]}
          onPress={() => {
            setKeyboardAccessoryMode('functions');
            refocusKeyboardInput(40);
          }}
        >
          <Text
            style={[
              styles.keyboardAccessoryToggleText,
              keyboardAccessoryMode === 'functions' && styles.keyboardAccessoryToggleTextActive,
            ]}
          >
            Fn
          </Text>
        </TouchableOpacity>
      </View>

      {keyboardAccessoryMode === 'functions' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keyboardAccessoryRow}
            keyboardShouldPersistTaps="handled"
          >
            {FUNCTION_KEYS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.keyboardAccessoryKey}
                onPress={() => handleKeyboardQuickKey(item.keyValue, item.label)}
              >
                <Text style={styles.keyboardAccessoryKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keyboardAccessoryRow}
            keyboardShouldPersistTaps="handled"
          >
            {[...KEYBOARD_QUICK_KEYS, { label: 'Delete', keyValue: 'delete' }].map((item) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.keyboardAccessoryKey, item.wide && styles.keyboardAccessoryKeyWide]}
                onPress={() => handleKeyboardQuickKey(item.keyValue, item.label)}
              >
                <Text style={styles.keyboardAccessoryKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keyboardAccessoryRow}
            keyboardShouldPersistTaps="handled"
          >
            {modifierKeys.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.keyboardAccessoryKey}
                onPress={() => handleKeyboardQuickKey(item.keyValue, item.label)}
              >
                <Text style={styles.keyboardAccessoryKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keyboardAccessoryRow}
            keyboardShouldPersistTaps="handled"
          >
            {productivityShortcuts.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.keyboardAccessoryKey, item.wide && styles.keyboardAccessoryKeyWide]}
                onPress={() => handleKeyboardQuickKey(item.keyValue, item.label)}
              >
                <Text style={styles.keyboardAccessoryKeyText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );

  const renderKeysPanel = () => {
    const directionalLabels = new Set(['Up', 'Left', 'Down', 'Right']);
    const navigationUtilityKeys = NAVIGATION_KEYS.filter((item) => !directionalLabels.has(item.label));
    const upKey = NAVIGATION_KEYS.find((item) => item.label === 'Up');
    const leftKey = NAVIGATION_KEYS.find((item) => item.label === 'Left');
    const downKey = NAVIGATION_KEYS.find((item) => item.label === 'Down');
    const rightKey = NAVIGATION_KEYS.find((item) => item.label === 'Right');

    return (
      <View style={[styles.panelCard, styles.keysPanelCard]}>
          <View style={styles.keysHeader}>
            <View style={styles.keysHeaderCopy}>
              <Text style={styles.panelEyebrow}>Shortcuts</Text>
              <Text style={styles.panelTitle}>Quick Keys</Text>
            </View>
            <Text style={styles.keysHeaderHint}>Tap once</Text>
          </View>

          <ScrollView
            style={styles.keysScroll}
            contentContainerStyle={styles.keysScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.keySection, styles.keySurfaceCard]}>
              <View style={styles.keySectionHeader}>
                <Text style={styles.keySectionTitle}>Modifiers</Text>
                <Text style={styles.keySectionMeta}>System</Text>
              </View>
              <View style={styles.modifierRow}>
                {modifierKeys.map((item) => (
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

            <View style={[styles.keySection, styles.keySurfaceCard]}>
              <View style={styles.keySectionHeader}>
                <Text style={styles.keySectionTitle}>Navigation</Text>
                <Text style={styles.keySectionMeta}>Cursor + editing</Text>
              </View>
              <View style={styles.navigationLayout}>
                <View style={styles.navigationGrid}>
                  {navigationUtilityKeys.map((item) => (
                    <TouchableOpacity
                      key={item.label}
                      style={styles.gridKey}
                      onPress={() => handleSpecialKey(item.keyValue, item.label)}
                    >
                      <Text style={styles.gridKeyText}>{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.navPad}>
                  <View style={styles.navPadTopRow}>
                    {upKey ? (
                      <TouchableOpacity
                        style={styles.navPadKey}
                        onPress={() => handleSpecialKey(upKey.keyValue, upKey.label)}
                      >
                        <Text style={styles.navPadKeyText}>{upKey.label}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={styles.navPadBottomRow}>
                    {leftKey ? (
                      <TouchableOpacity
                        style={styles.navPadKey}
                        onPress={() => handleSpecialKey(leftKey.keyValue, leftKey.label)}
                      >
                        <Text style={styles.navPadKeyText}>{leftKey.label}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {downKey ? (
                      <TouchableOpacity
                        style={[styles.navPadKey, styles.navPadKeyAccent]}
                        onPress={() => handleSpecialKey(downKey.keyValue, downKey.label)}
                      >
                        <Text style={styles.navPadKeyText}>{downKey.label}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {rightKey ? (
                      <TouchableOpacity
                        style={styles.navPadKey}
                        onPress={() => handleSpecialKey(rightKey.keyValue, rightKey.label)}
                      >
                        <Text style={styles.navPadKeyText}>{rightKey.label}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.keySection, styles.keySurfaceCard]}>
              <View style={styles.keySectionHeader}>
                <Text style={styles.keySectionTitle}>Combos</Text>
                <Text style={styles.keySectionMeta}>Workflow</Text>
              </View>
              <View style={styles.comboWrap}>
                {productivityShortcuts.map((item) => (
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

            <View style={[styles.keySection, styles.keySurfaceCard]}>
              <View style={styles.keySectionHeader}>
                <Text style={styles.keySectionTitle}>Function Row</Text>
                <Text style={styles.keySectionMeta}>F1-F12</Text>
              </View>
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
  };

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
        <LinearGradient colors={['#05090c', '#09141a', '#060b0e']} style={StyleSheet.absoluteFillObject} />
        <ActivityIndicator size="large" color="#22d3ee" />
        <Text style={styles.loadingText}>{loading ? 'Loading control panel...' : 'Device not found'}</Text>
      </View>
    );
  }

  const deviceIsOnline = status === 'online';
  const isKeyboardQuickKeysVisible = activeTab === 'keyboard' && keyboardAccessoryMode !== null;
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
      <LinearGradient colors={['#05090c', '#09141a', '#060b0e']} style={StyleSheet.absoluteFillObject} />
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
              <ArrowLeft size={22} color="#67e8f9" />
            </TouchableOpacity>

            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerEyebrow}>WakeMate Remote</Text>
              <Text style={styles.headerTitle}>Control Device</Text>
            </View>

            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.headerButton}>
              <Settings size={20} color="#67e8f9" />
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
                  colors={['rgba(8, 145, 178, 0.28)', 'rgba(9, 20, 26, 0.98)', 'rgba(5, 9, 12, 1)']}
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

                <View style={styles.touchpadShell}>
                  <GestureHandlerRootView style={styles.touchpadGestureRoot}>
                    <PanGestureHandler
                      onGestureEvent={handleTouchpadGesture}
                      onHandlerStateChange={handleTouchpadStateChange}
                    >
                      <View
                        style={styles.touchpadSurface}
                        onLayout={(event) => {
                          touchpadHeightRef.current = event.nativeEvent.layout.height;
                        }}
                      >
                        <View style={styles.touchpadHalo} />
                        <View style={styles.touchpadCenter}>
                          <MousePointer size={30} color="#d8fbff" />
                          <Text style={styles.touchpadHint}>Touchpad</Text>
                        </View>
                      </View>
                    </PanGestureHandler>
                  </GestureHandlerRootView>

                  <View
                    pointerEvents="box-none"
                    style={[styles.scrollRailOverlay, isKeyboardDockActive && styles.scrollRailOverlayKeyboard]}
                  >
                    <TouchableOpacity style={styles.scrollButtonCompact} onPress={() => handleScroll(4)}>
                      <ChevronUp size={16} color="#f5f6fb" />
                    </TouchableOpacity>

                    <View
                      style={styles.scrollTrack}
                      onLayout={(event) => {
                        scrollTrackHeightRef.current = event.nativeEvent.layout.height;
                      }}
                      onStartShouldSetResponder={() => true}
                      onMoveShouldSetResponder={() => true}
                      onResponderGrant={(event) => {
                        handleScrollRailGrant(event.nativeEvent.locationY);
                      }}
                      onResponderMove={(event) => {
                        handleScrollRailMove(event.nativeEvent.locationY);
                      }}
                      onResponderRelease={resetScrollRailDrag}
                      onResponderTerminate={resetScrollRailDrag}
                    >
                      <View
                        style={[
                          styles.scrollThumb,
                          {
                            transform: [{ translateY: scrollThumbOffset }],
                          },
                        ]}
                      />
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
              </View>

              <View style={[styles.bottomDock, isKeyboardDockActive && styles.bottomDockKeyboardVisible]}>
                <View style={styles.dockControlsRow}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabRailContent}
                    keyboardShouldPersistTaps="handled"
                    style={styles.tabRail}
                  >
                    {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
                      const active =
                        activeTab === key ||
                        (key === 'keys' && isKeyboardQuickKeysVisible);

                      return (
                        <TouchableOpacity
                          key={key}
                          style={[styles.tabButton, active && styles.activeTabButton]}
                          onPress={() => handleTabChange(key)}
                          accessibilityLabel={`Open ${label} panel`}
                        >
                          <Icon size={17} color={active ? '#ecfeff' : '#a8a8ba'} />
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <TouchableOpacity
                    style={[styles.tabButton, styles.settingsDockButton, isSettingsVisible && styles.activeTabButton]}
                    onPress={() => setIsSettingsVisible(true)}
                    accessibilityLabel="Open control settings"
                  >
                    <Settings size={17} color={isSettingsVisible ? '#ecfeff' : '#a8a8ba'} />
                  </TouchableOpacity>
                </View>

                {isKeyboardQuickKeysVisible ? renderKeyboardQuickKeysOverlay() : null}
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

      <Modal visible={isSettingsVisible} transparent animationType="slide" onRequestClose={() => setIsSettingsVisible(false)}>
        <View style={styles.settingsModalOverlay}>
          <View style={[styles.settingsModalSheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.settingsModalHeader}>
              <View>
                <Text style={styles.settingsModalTitle}>Control Settings</Text>
                <Text style={styles.settingsModalSubtitle}>Tune touchpad feel and remote behavior.</Text>
              </View>

              <TouchableOpacity
                style={styles.settingsModalCloseButton}
                onPress={() => setIsSettingsVisible(false)}
                accessibilityLabel="Close control settings"
              >
                <X size={18} color="#d7eef7" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.settingsModalContent} showsVerticalScrollIndicator={false}>
              <SettingsSlider
                label="Tracking Speed"
                description="Lower values make short glides more precise. Higher values move the cursor farther with the same swipe."
                value={controlSettings.trackingSpeed}
                onChange={(value) => setControlSettings((current) => ({ ...current, trackingSpeed: value }))}
              />

              <SettingsSlider
                label="Scrolling Speed"
                description="Lower values keep scrolling gentle. Higher values turn the same glide into faster page movement."
                value={controlSettings.scrollingSpeed}
                onChange={(value) => setControlSettings((current) => ({ ...current, scrollingSpeed: value }))}
              />

              <View style={styles.settingsToggleCard}>
                <View style={styles.settingsToggleCopy}>
                  <Text style={styles.settingsToggleTitle}>Disable Sleep</Text>
                  <Text style={styles.settingsToggleDescription}>
                    Keeps your phone awake while you are using the remote so the controls stay ready.
                  </Text>
                </View>
                <Switch
                  value={controlSettings.disableSleep}
                  onValueChange={(value) => setControlSettings((current) => ({ ...current, disableSleep: value }))}
                  trackColor={{ false: '#203640', true: '#0ea5c7' }}
                  thumbColor={controlSettings.disableSleep ? '#f8fdff' : '#c0d5dd'}
                />
              </View>

              <View style={styles.settingsToggleCard}>
                <View style={styles.settingsToggleCopy}>
                  <Text style={styles.settingsToggleTitle}>Volume Button Remote</Text>
                  <Text style={styles.settingsToggleDescription}>
                    Uses your phone&apos;s physical volume buttons for PC volume up and down while this screen is open.
                  </Text>
                </View>
                <Switch
                  value={controlSettings.useVolumeButtons}
                  onValueChange={(value) => setControlSettings((current) => ({ ...current, useVolumeButtons: value }))}
                  trackColor={{ false: '#203640', true: '#0ea5c7' }}
                  thumbColor={controlSettings.useVolumeButtons ? '#f8fdff' : '#c0d5dd'}
                />
              </View>

              <Text style={styles.settingsFootnote}>
                Hardware volume capture works best in a development build on a real device.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
  },
  glowOrbTwo: {
    position: 'absolute',
    bottom: 120,
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 145, 178, 0.18)',
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
    backgroundColor: 'rgba(9, 14, 18, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.12)',
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
    backgroundColor: 'rgba(8, 12, 16, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.1)',
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
    backgroundColor: '#0891b2',
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
    minHeight: 360,
    borderRadius: 34,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.14)',
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
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  devicePickerWrap: {
    flex: 1,
    maxWidth: '76%',
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
    color: '#b7ecf5',
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
    backgroundColor: '#0891b2',
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
    marginRight: 8,
  },
  touchpadShell: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
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
    paddingLeft: 26,
    paddingRight: 50,
    paddingTop: 24,
    paddingBottom: 58,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 256,
  },
  touchpadHalo: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
  },
  touchpadCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  touchpadHint: {
    color: '#d8fbff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  scrollRailOverlay: {
    position: 'absolute',
    top: 76,
    right: 16,
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
    backgroundColor: 'rgba(165, 243, 252, 0.72)',
  },
  clickRailOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    gap: 6,
  },
  clickRailOverlayKeyboard: {
    bottom: 12,
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
  dockControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tabRail: {
    flex: 1,
  },
  clickKey: {
    minHeight: 38,
    minWidth: 52,
    borderRadius: 10,
    backgroundColor: '#2b2e36',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    flexShrink: 0,
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
  settingsDockButton: {
    flexShrink: 0,
  },
  activeTabButton: {
    backgroundColor: '#0891b2',
  },
  tabLabel: {
    color: '#a8a8ba',
    fontSize: 12,
    fontWeight: '700',
  },
  activeTabLabel: {
    color: '#ffffff',
  },
  settingsModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 10, 0.74)',
  },
  settingsModalSheet: {
    maxHeight: '82%',
    backgroundColor: '#0b1017',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.14)',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  settingsModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  settingsModalTitle: {
    color: '#f5fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  settingsModalSubtitle: {
    color: '#8da8b2',
    fontSize: 13,
    marginTop: 4,
  },
  settingsModalCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#15212b',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsModalContent: {
    paddingBottom: 6,
  },
  settingBlock: {
    marginBottom: 20,
  },
  settingBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  settingLabel: {
    color: '#f5fbff',
    fontSize: 16,
    fontWeight: '700',
  },
  settingValue: {
    color: '#67e8f9',
    fontSize: 13,
    fontWeight: '800',
  },
  settingDescription: {
    color: '#90a8b3',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  sliderTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#16232b',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.12)',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#0891b2',
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f8fdff',
    borderWidth: 3,
    borderColor: '#0891b2',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderLabelText: {
    color: '#6f8a96',
    fontSize: 12,
    fontWeight: '600',
  },
  settingsToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#141b23',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  settingsToggleCopy: {
    flex: 1,
  },
  settingsToggleTitle: {
    color: '#f5fbff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  settingsToggleDescription: {
    color: '#8da6b0',
    fontSize: 12,
    lineHeight: 18,
  },
  settingsFootnote: {
    color: '#6f8a96',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
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
    color: '#67e8f9',
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
    backgroundColor: '#0891b2',
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
    backgroundColor: '#0891b2',
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
  keyboardAccessoryCard: {
    borderRadius: 20,
    backgroundColor: '#151922',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.12)',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
    marginBottom: 8,
  },
  keyboardAccessoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 2,
  },
  keyboardAccessoryTitle: {
    color: '#f5f6fb',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  keyboardAccessoryHint: {
    color: '#7dd3fc',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  keyboardAccessoryToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  keyboardAccessoryToggle: {
    minHeight: 32,
    borderRadius: 12,
    backgroundColor: '#202530',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardAccessoryToggleActive: {
    backgroundColor: '#8ac926',
  },
  keyboardAccessoryToggleText: {
    color: '#d4d7e3',
    fontSize: 11,
    fontWeight: '800',
  },
  keyboardAccessoryToggleTextActive: {
    color: '#11151c',
  },
  keyboardAccessoryRow: {
    gap: 8,
    paddingRight: 2,
  },
  keyboardAccessoryKey: {
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: '#272b35',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardAccessoryKeyWide: {
    paddingHorizontal: 15,
  },
  keyboardAccessoryKeyText: {
    color: '#f5f6fb',
    fontSize: 11,
    fontWeight: '700',
  },
  keysPanelCard: {
    maxHeight: 286,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  keysHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  keysHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  keysHeaderHint: {
    color: '#89a8b3',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    paddingTop: 16,
  },
  keysScroll: {
    maxHeight: 206,
  },
  keysScrollContent: {
    gap: 10,
    paddingBottom: 2,
  },
  keySection: {
    gap: 7,
  },
  keySurfaceCard: {
    backgroundColor: '#131820',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    padding: 10,
  },
  keySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  keySectionTitle: {
    color: '#a5f3fc',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.3,
  },
  keySectionMeta: {
    color: '#748895',
    fontSize: 10,
    fontWeight: '700',
  },
  modifierRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  modifierKey: {
    flexBasis: '23%',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: '#272b35',
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modifierKeyText: {
    color: '#f5f6fb',
    fontSize: 11,
    fontWeight: '700',
  },
  keyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  navigationLayout: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  navigationGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  gridKey: {
    flexBasis: '31.5%',
    minWidth: 0,
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: '#272b35',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  gridKeyText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  navPad: {
    width: 104,
    borderRadius: 16,
    backgroundColor: '#10171d',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.08)',
    padding: 8,
    justifyContent: 'space-between',
    gap: 6,
  },
  navPadTopRow: {
    alignItems: 'center',
  },
  navPadBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  navPadKey: {
    flex: 1,
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: '#22313b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navPadKeyAccent: {
    backgroundColor: '#155e75',
  },
  navPadKeyText: {
    color: '#ecfeff',
    fontSize: 10,
    fontWeight: '800',
  },
  comboWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  comboKey: {
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: '#16313c',
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboKeyWide: {
    width: '100%',
  },
  comboKeyText: {
    color: '#ecfeff',
    fontSize: 11,
    fontWeight: '700',
  },
  functionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  functionKey: {
    flexBasis: '23%',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 12,
    backgroundColor: '#252934',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  functionKeyText: {
    color: '#f5f6fb',
    fontSize: 10,
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
    backgroundColor: '#0891b2',
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
    backgroundColor: 'rgba(8, 12, 16, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(103, 232, 249, 0.1)',
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

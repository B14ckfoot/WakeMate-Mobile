import React, { useEffect, useEffectEvent, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  MousePointer,
  Play,
  Pause,
  Settings,
  SkipBack,
  SkipForward,
  Volume,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import { VolumeManager } from 'react-native-volume-manager';
import deviceService from '../services/deviceService';
import { Device } from '../types/device';

const SETTINGS_STORAGE_KEY = 'mouseKeyboardRemoteSettings';
const KEEP_AWAKE_TAG = 'MouseKeyboardRemote';
const DEFAULT_TOUCHPAD_HEIGHT = Dimensions.get('window').height * 0.4;
const TOUCHPAD_SCROLL_ZONE_START = 0.33;
const TOUCHPAD_SCROLL_ZONE_END = 0.66;
const TOUCHPAD_SCROLL_STEP_PX = 18;
const TOUCHPAD_TAP_MAX_DISTANCE = 8;
const TOUCHPAD_TAP_MAX_DURATION_MS = 220;
const TRACKING_SPEED_MIN = 0.45;
const TRACKING_SPEED_MAX = 2.6;
const SCROLL_SPEED_MIN = 0.45;
const SCROLL_SPEED_MAX = 2.4;

type RemoteSettings = {
  trackingSpeed: number;
  scrollingSpeed: number;
  disableSleep: boolean;
  useVolumeButtons: boolean;
};

type ActivePanel = 'mouse' | 'keyboard' | 'media';

const DEFAULT_SETTINGS: RemoteSettings = {
  trackingSpeed: 0.52,
  scrollingSpeed: 0.48,
  disableSleep: false,
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

const MouseKeyboardScreen: React.FC = () => {
  const params = useLocalSearchParams<{ id?: string }>();
  const [activePanel, setActivePanel] = useState<ActivePanel>('mouse');
  const [device, setDevice] = useState<Device | null>(null);
  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [remoteSettings, setRemoteSettings] = useState<RemoteSettings>(DEFAULT_SETTINGS);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const isScrolling = false;

  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const mediaHeight = useRef(new Animated.Value(0)).current;
  const touchpadRef = useRef<View>(null);
  const touchpadHeightRef = useRef(DEFAULT_TOUCHPAD_HEIGHT);
  const lastTranslationRef = useRef({ x: 0, y: 0 });
  const pendingMoveRef = useRef({ x: 0, y: 0 });
  const pendingScrollRef = useRef(0);
  const gestureStartTimeRef = useRef(0);
  const mouseMoveRequestInFlightRef = useRef(false);
  const scrollRequestInFlightRef = useRef(false);
  const volumeListenerRef = useRef<{ remove: () => void } | null>(null);
  const baselineVolumeRef = useRef(0.5);
  const lastVolumeRef = useRef(0.5);
  const isResettingVolumeRef = useRef(false);

  const trackingMultiplier = scaleSetting(remoteSettings.trackingSpeed, TRACKING_SPEED_MIN, TRACKING_SPEED_MAX);
  const scrollMultiplier = scaleSetting(remoteSettings.scrollingSpeed, SCROLL_SPEED_MIN, SCROLL_SPEED_MAX);
  const deviceId = typeof params.id === 'string' ? params.id : undefined;

  useEffect(() => {
    let isMounted = true;

    const loadDevice = async () => {
      if (!deviceId) {
        setDevice(null);
        return;
      }

      try {
        const devices = await deviceService.getDevices();
        if (isMounted) {
          setDevice(devices.find((entry) => entry.id === deviceId) ?? null);
        }
      } catch (error) {
        console.warn('Failed to load device for mouse keyboard remote:', error);
      }
    };

    void loadDevice();

    return () => {
      isMounted = false;
    };
  }, [deviceId]);

  useEffect(() => {
    let isMounted = true;

    const loadRemoteSettings = async () => {
      try {
        const storedSettings = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!storedSettings || !isMounted) {
          return;
        }

        const parsed = JSON.parse(storedSettings) as Partial<RemoteSettings>;
        setRemoteSettings((current) => ({
          trackingSpeed: typeof parsed.trackingSpeed === 'number' ? clamp(parsed.trackingSpeed, 0, 1) : current.trackingSpeed,
          scrollingSpeed:
            typeof parsed.scrollingSpeed === 'number' ? clamp(parsed.scrollingSpeed, 0, 1) : current.scrollingSpeed,
          disableSleep: typeof parsed.disableSleep === 'boolean' ? parsed.disableSleep : current.disableSleep,
          useVolumeButtons:
            typeof parsed.useVolumeButtons === 'boolean' ? parsed.useVolumeButtons : current.useVolumeButtons,
        }));
      } catch (error) {
        console.warn('Failed to load mouse keyboard settings:', error);
      } finally {
        if (isMounted) {
          setHasLoadedSettings(true);
        }
      }
    };

    void loadRemoteSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSettings) {
      return;
    }

    void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(remoteSettings)).catch((error) => {
      console.warn('Failed to save mouse keyboard settings:', error);
    });
  }, [hasLoadedSettings, remoteSettings]);

  useEffect(() => {
    const syncWakeLock = async () => {
      try {
        if (remoteSettings.disableSleep) {
          await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
          return;
        }

        await deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch (error) {
        console.warn('Failed to update keep-awake state:', error);
      }
    };

    void syncWakeLock();

    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [remoteSettings.disableSleep]);

  const sendMediaCommand = useEffectEvent(
    (command: 'previous' | 'play_pause' | 'next' | 'mute' | 'volume_down' | 'volume_up') => {
      if (!device) {
        return;
      }

      if (command === 'play_pause') {
        void deviceService.sendMediaPlayPause(device.id, device.ip).catch((error) => {
          console.warn('Failed to send play pause command:', error);
        });
        setIsPlaying((current) => !current);
        return;
      }

      const actionMap = {
        previous: () => deviceService.sendMediaPrevious(device.id, device.ip),
        next: () => deviceService.sendMediaNext(device.id, device.ip),
        mute: () => deviceService.sendVolumeMute(device.id, device.ip),
        volume_down: () => deviceService.sendVolumeDown(device.id, device.ip),
        volume_up: () => deviceService.sendVolumeUp(device.id, device.ip),
      };

      void actionMap[command]().catch((error) => {
        console.warn(`Failed to send ${command} command:`, error);
      });
    }
  );

  const handleHardwareVolumeChange = useEffectEvent((nextVolume: number) => {
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

    sendMediaCommand(volumeDelta > 0 ? 'volume_up' : 'volume_down');
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
  });

  useEffect(() => {
    let isCancelled = false;

    const teardownVolumeListener = () => {
      volumeListenerRef.current?.remove();
      volumeListenerRef.current = null;
      isResettingVolumeRef.current = false;
    };

    if (!remoteSettings.useVolumeButtons) {
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
            'This needs a development build on a physical device so WakeMATE can listen for hardware volume presses.'
          );
          setRemoteSettings((current) => ({ ...current, useVolumeButtons: false }));
        }
      }
    };

    void enableHardwareVolumeRemote();

    return () => {
      isCancelled = true;
      teardownVolumeListener();
      void VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => {});
    };
  }, [handleHardwareVolumeChange, remoteSettings.useVolumeButtons]);

  const toggleKeyboard = () => {
    if (activePanel !== 'keyboard') {
      setActivePanel('keyboard');
      Animated.timing(keyboardHeight, {
        toValue: 250,
        duration: 300,
        useNativeDriver: false,
      }).start();

      Animated.timing(mediaHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
      return;
    }

    setActivePanel('mouse');
    Animated.timing(keyboardHeight, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const toggleMedia = () => {
    if (activePanel !== 'media') {
      setActivePanel('media');
      Animated.timing(mediaHeight, {
        toValue: 150,
        duration: 300,
        useNativeDriver: false,
      }).start();

      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
      return;
    }

    setActivePanel('mouse');
    Animated.timing(mediaHeight, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const flushPendingMouseMove = () => {
    if (!device || mouseMoveRequestInFlightRef.current) {
      return;
    }

    const dx = Math.trunc(pendingMoveRef.current.x);
    const dy = Math.trunc(pendingMoveRef.current.y);

    if (dx === 0 && dy === 0) {
      return;
    }

    pendingMoveRef.current.x -= dx;
    pendingMoveRef.current.y -= dy;
    mouseMoveRequestInFlightRef.current = true;

    void deviceService
      .sendMouseMove(device.id, device.ip, dx, dy)
      .catch((error) => {
        console.warn('Failed to send mouse move:', error);
      })
      .finally(() => {
        mouseMoveRequestInFlightRef.current = false;

        if (Math.trunc(pendingMoveRef.current.x) !== 0 || Math.trunc(pendingMoveRef.current.y) !== 0) {
          flushPendingMouseMove();
        }
      });
  };

  const sendMouseClick = (button: 'left' | 'right' | 'middle') => {
    if (!device) {
      return;
    }

    void deviceService.sendMouseClick(device.id, device.ip, button).catch((error) => {
      console.warn(`Failed to send ${button} click:`, error);
    });
  };

  const flushPendingScroll = () => {
    if (!device || scrollRequestInFlightRef.current) {
      return;
    }

    const steps = Math.trunc(Math.abs(pendingScrollRef.current) / TOUCHPAD_SCROLL_STEP_PX);
    if (steps === 0) {
      return;
    }

    const amount = pendingScrollRef.current < 0 ? steps : -steps;
    pendingScrollRef.current -= Math.sign(pendingScrollRef.current) * steps * TOUCHPAD_SCROLL_STEP_PX;
    scrollRequestInFlightRef.current = true;

    void deviceService
      .sendScroll(device.id, device.ip, amount)
      .catch((error) => {
        console.warn('Failed to send scroll:', error);
      })
      .finally(() => {
        scrollRequestInFlightRef.current = false;

        if (Math.trunc(Math.abs(pendingScrollRef.current) / TOUCHPAD_SCROLL_STEP_PX) > 0) {
          flushPendingScroll();
        }
      });
  };

  const sendKeyboardInput = () => {
    if (!device || !text.trim()) {
      return;
    }

    void deviceService.sendKeyboardInput(device.id, device.ip, text).catch((error) => {
      console.warn('Failed to send keyboard input:', error);
    });
    setText('');
  };

  const sendSpecialKey = (key: string) => {
    if (!device) {
      return;
    }

    void deviceService.sendSpecialKey(device.id, device.ip, key).catch((error) => {
      console.warn(`Failed to send special key ${key}:`, error);
    });
  };

  const handlePanGesture = (event: PanGestureHandlerGestureEvent) => {
    const { translationX, translationY, y } = event.nativeEvent;
    const deltaX = translationX - lastTranslationRef.current.x;
    const deltaY = translationY - lastTranslationRef.current.y;

    lastTranslationRef.current = { x: translationX, y: translationY };

    const touchpadHeight = touchpadHeightRef.current || DEFAULT_TOUCHPAD_HEIGHT;
    const middleStart = touchpadHeight * TOUCHPAD_SCROLL_ZONE_START;
    const middleEnd = touchpadHeight * TOUCHPAD_SCROLL_ZONE_END;
    const isInMiddle = y >= middleStart && y <= middleEnd;

    if (isInMiddle) {
      pendingScrollRef.current += deltaY * scrollMultiplier;
      flushPendingScroll();
      return;
    }

    pendingMoveRef.current.x += deltaX * trackingMultiplier;
    pendingMoveRef.current.y += deltaY * trackingMultiplier;

    const moveX = Math.trunc(pendingMoveRef.current.x);
    const moveY = Math.trunc(pendingMoveRef.current.y);

    if (moveX === 0 && moveY === 0) {
      return;
    }

    flushPendingMouseMove();
  };

  const resetGestureTracking = () => {
    lastTranslationRef.current = { x: 0, y: 0 };
    pendingMoveRef.current = { x: 0, y: 0 };
    pendingScrollRef.current = 0;
  };

  const handlePanStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.state === State.BEGAN) {
      gestureStartTimeRef.current = Date.now();
      resetGestureTracking();
      return;
    }

    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.FAILED) {
      const { translationX, translationY } = event.nativeEvent;
      const gestureDuration = Date.now() - gestureStartTimeRef.current;
      const gestureDistance = Math.hypot(translationX, translationY);
      const isTap =
        gestureDuration <= TOUCHPAD_TAP_MAX_DURATION_MS && gestureDistance <= TOUCHPAD_TAP_MAX_DISTANCE;

      if (isTap) {
        sendMouseClick('left');
        resetGestureTracking();
        return;
      }
    }

    if (event.nativeEvent.state === State.END || event.nativeEvent.state === State.CANCELLED || event.nativeEvent.state === State.FAILED) {
      flushPendingMouseMove();
      flushPendingScroll();
      resetGestureTracking();
    }
  };

  return (
    <View style={styles.container}>
      <GestureHandlerRootView style={styles.touchPadContainer}>
        <PanGestureHandler onGestureEvent={handlePanGesture} onHandlerStateChange={handlePanStateChange}>
          <Animated.View
            ref={touchpadRef}
            style={styles.touchPad}
            onLayout={(event) => {
              touchpadHeightRef.current = event.nativeEvent.layout.height;
            }}
          >
            {isScrolling ? (
              <Text style={styles.scrollingText}>Scrolling...</Text>
            ) : (
              <>
                <MousePointer size={32} color="#0891b2" style={styles.pointerIcon} />
                <Text style={styles.touchPadText}>Tap to click</Text>
              </>
            )}
          </Animated.View>
        </PanGestureHandler>
      </GestureHandlerRootView>

      <View style={styles.mouseButtonsContainer}>
        <TouchableOpacity style={styles.mouseButton} onPress={() => sendMouseClick('left')} activeOpacity={0.6}>
          <Text style={styles.mouseButtonText}>Left Click</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.mouseButton} onPress={() => sendMouseClick('right')} activeOpacity={0.6}>
          <Text style={styles.mouseButtonText}>Right Click</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.panelToggles}>
        <View style={styles.panelToggleGroup}>
          <TouchableOpacity
            style={[styles.panelToggle, activePanel === 'keyboard' && styles.activeToggle]}
            onPress={toggleKeyboard}
          >
            <Text style={[styles.panelToggleText, activePanel === 'keyboard' && styles.activeToggleText]}>
              Keyboard
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.panelToggle, activePanel === 'media' && styles.activeToggle]}
            onPress={toggleMedia}
          >
            <Text style={[styles.panelToggleText, activePanel === 'media' && styles.activeToggleText]}>Media</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setIsSettingsVisible(true)}
          activeOpacity={0.75}
          accessibilityLabel="Open control settings"
        >
          <Settings size={20} color="#d9f7ff" />
        </TouchableOpacity>
      </View>

      <Animated.View style={[styles.keyboardPanel, { height: keyboardHeight }]}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type here..."
            placeholderTextColor="#6b7280"
            onSubmitEditing={sendKeyboardInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendKeyboardInput}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.specialKeysContainer}
          keyboardShouldPersistTaps="handled"
        >
          {['Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].map((key) => (
            <TouchableOpacity key={key} style={styles.specialKey} onPress={() => sendSpecialKey(key)}>
              <Text style={styles.specialKeyText}>{key}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>

      <Animated.View style={[styles.mediaPanel, { height: mediaHeight }]}>
        <View style={styles.mediaControls}>
          <TouchableOpacity style={styles.mediaButton} onPress={() => sendMediaCommand('previous')}>
            <SkipBack size={32} color="#ffffff" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.mediaButton, styles.playButton]} onPress={() => sendMediaCommand('play_pause')}>
            {isPlaying ? <Pause size={32} color="#ffffff" /> : <Play size={32} color="#ffffff" />}
          </TouchableOpacity>

          <TouchableOpacity style={styles.mediaButton} onPress={() => sendMediaCommand('next')}>
            <SkipForward size={32} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.volumeControls}>
          <TouchableOpacity style={styles.volumeButton} onPress={() => sendMediaCommand('mute')}>
            <VolumeX size={24} color="#ffffff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.volumeButton} onPress={() => sendMediaCommand('volume_down')}>
            <Volume size={24} color="#ffffff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.volumeButton} onPress={() => sendMediaCommand('volume_up')}>
            <Volume2 size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Modal visible={isSettingsVisible} transparent animationType="slide" onRequestClose={() => setIsSettingsVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Control Settings</Text>
                <Text style={styles.modalSubtitle}>Tune the touchpad feel and remote behavior.</Text>
              </View>

              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setIsSettingsVisible(false)}
                accessibilityLabel="Close control settings"
              >
                <X size={20} color="#d7eaf0" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <SettingsSlider
                label="Tracking Speed"
                description="Lower values make short glides more precise. Higher values move the cursor farther with the same swipe."
                value={remoteSettings.trackingSpeed}
                onChange={(value) => setRemoteSettings((current) => ({ ...current, trackingSpeed: value }))}
              />

              <SettingsSlider
                label="Scrolling Speed"
                description="Lower values keep scrolling gentle. Higher values turn the same glide into faster page movement."
                value={remoteSettings.scrollingSpeed}
                onChange={(value) => setRemoteSettings((current) => ({ ...current, scrollingSpeed: value }))}
              />

              <View style={styles.toggleCard}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Disable Sleep</Text>
                  <Text style={styles.toggleDescription}>
                    Keeps your phone awake while you are using the remote so the controls stay ready.
                  </Text>
                </View>
                <Switch
                  value={remoteSettings.disableSleep}
                  onValueChange={(value) => setRemoteSettings((current) => ({ ...current, disableSleep: value }))}
                  trackColor={{ false: '#203640', true: '#0ea5c7' }}
                  thumbColor={remoteSettings.disableSleep ? '#f8fdff' : '#c0d5dd'}
                />
              </View>

              <View style={styles.toggleCard}>
                <View style={styles.toggleCopy}>
                  <Text style={styles.toggleTitle}>Volume Button Remote</Text>
                  <Text style={styles.toggleDescription}>
                    Uses your phone’s physical volume buttons for PC volume up and down. WakeMATE keeps the phone volume
                    centered so you can keep clicking.
                  </Text>
                </View>
                <Switch
                  value={remoteSettings.useVolumeButtons}
                  onValueChange={(value) => setRemoteSettings((current) => ({ ...current, useVolumeButtons: value }))}
                  trackColor={{ false: '#203640', true: '#0ea5c7' }}
                  thumbColor={remoteSettings.useVolumeButtons ? '#f8fdff' : '#c0d5dd'}
                />
              </View>

              <Text style={styles.settingsFootnote}>
                Hardware volume capture works best in a development build on a real device.
              </Text>

              <TouchableOpacity
                style={[styles.sleepActionButton, !device && styles.sleepActionButtonDisabled]}
                onPress={() => {
                  if (!device) {
                    return;
                  }

                  Alert.alert(
                    'Put computer to sleep?',
                    'This sends the sleep command to the connected computer immediately.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Sleep',
                        style: 'destructive',
                        onPress: () => {
                          void deviceService.sendSleep(device.id, device.ip).catch((error) => {
                            console.warn('Failed to send sleep command:', error);
                          });
                        },
                      },
                    ]
                  );
                }}
                disabled={!device}
              >
                <Text style={styles.sleepActionText}>Sleep Computer</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  touchPadContainer: {
    flex: 1,
    marginBottom: 16,
    padding: 16,
  },
  touchPad: {
    flex: 1,
    backgroundColor: '#0b1217',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#16313a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerIcon: {
    marginBottom: 16,
    opacity: 0.5,
  },
  touchPadText: {
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  scrollingText: {
    color: '#0891b2',
    fontSize: 18,
    fontWeight: '600',
  },
  mouseButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  mouseButton: {
    backgroundColor: '#0f171c',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#17323b',
    paddingVertical: 12,
    width: '48%',
    alignItems: 'center',
  },
  mouseButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  panelToggles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  panelToggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  panelToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
    paddingVertical: 8,
  },
  activeToggle: {
    borderBottomWidth: 2,
    borderBottomColor: '#0891b2',
  },
  panelToggleText: {
    color: '#7f97a1',
    fontSize: 16,
  },
  activeToggleText: {
    color: '#0891b2',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#102028',
    borderWidth: 1,
    borderColor: '#1d4450',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardPanel: {
    backgroundColor: '#0b1217',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#16313a',
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#0f171c',
    borderRadius: 12,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#17323b',
  },
  sendButton: {
    backgroundColor: '#0891b2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  specialKeysContainer: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  specialKey: {
    backgroundColor: '#0f171c',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#17323b',
    marginRight: 8,
  },
  specialKeyText: {
    color: '#ffffff',
  },
  mediaPanel: {
    backgroundColor: '#0b1217',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#16313a',
    overflow: 'hidden',
  },
  mediaControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  mediaButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0891b2',
  },
  volumeControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 20,
  },
  volumeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3, 8, 12, 0.72)',
  },
  modalSheet: {
    maxHeight: '86%',
    backgroundColor: '#091117',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: '#16313a',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#f5fbff',
    fontSize: 22,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#86a7b3',
    fontSize: 14,
    marginTop: 4,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#112029',
    borderWidth: 1,
    borderColor: '#1a3642',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    paddingBottom: 10,
  },
  settingBlock: {
    marginBottom: 22,
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
    fontWeight: '600',
  },
  settingValue: {
    color: '#73d6eb',
    fontSize: 14,
    fontWeight: '700',
  },
  settingDescription: {
    color: '#89a7b3',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  sliderTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#12232b',
    borderWidth: 1,
    borderColor: '#193944',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: '#0ea5c7',
  },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f4fdff',
    borderWidth: 3,
    borderColor: '#0ea5c7',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderLabelText: {
    color: '#678591',
    fontSize: 12,
    fontWeight: '500',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0d1a20',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#17313b',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
  },
  toggleCopy: {
    flex: 1,
    paddingRight: 16,
  },
  toggleTitle: {
    color: '#f5fbff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  toggleDescription: {
    color: '#8ba6b0',
    fontSize: 13,
    lineHeight: 19,
  },
  settingsFootnote: {
    color: '#6f8a96',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 18,
  },
  sleepActionButton: {
    backgroundColor: '#12303a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1d5969',
    paddingVertical: 14,
    alignItems: 'center',
    opacity: 1,
  },
  sleepActionButtonDisabled: {
    opacity: 0.45,
  },
  sleepActionText: {
    color: '#e9fbff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default MouseKeyboardScreen;

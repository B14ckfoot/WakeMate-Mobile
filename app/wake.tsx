import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Power, TriangleAlert } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import deviceService from '../src/services/deviceService';
import { Device } from '../src/types/device';

type WakeState =
  | { status: 'loading'; message: string; device: Device | null }
  | { status: 'success'; message: string; device: Device }
  | { status: 'error'; message: string; device: Device | null };

const getParamValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

export default function WakeShortcutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ deviceId?: string | string[] }>();
  const deviceId = useMemo(() => getParamValue(params.deviceId), [params.deviceId]);
  const [wakeState, setWakeState] = useState<WakeState>({
    status: 'loading',
    message: 'Preparing your wake shortcut...',
    device: null,
  });

  useEffect(() => {
    let isActive = true;

    const runWakeFlow = async () => {
      let selectedDevice: Device | null = null;

      if (!deviceId) {
        if (isActive) {
          setWakeState({
            status: 'error',
            message: 'No device was attached to this shortcut. Open WakeMATE and choose a saved device for the widget or control.',
            device: null,
          });
        }
        return;
      }

      try {
        const devices = await deviceService.getDevices();
        const device = devices.find((entry) => entry.id === deviceId) ?? null;
        selectedDevice = device;

        if (!device) {
          if (isActive) {
            setWakeState({
              status: 'error',
              message: 'That device is no longer saved in WakeMATE. Re-add it or update the widget configuration.',
              device: null,
            });
          }
          return;
        }

        if (isActive) {
          setWakeState({
            status: 'loading',
            message: `Sending a magic packet to ${device.name}...`,
            device,
          });
        }

        const result = await deviceService.wakeMachine(device);

        if (isActive) {
          setWakeState({
            status: 'success',
            message:
              typeof result?.message === 'string' && result.message.trim().length > 0
                ? result.message
                : `Wake signal sent to ${device.name}.`,
            device,
          });
        }
      } catch (error) {
        if (isActive) {
          setWakeState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'WakeMATE could not send the wake signal.',
            device: selectedDevice,
          });
        }
      }
    };

    void runWakeFlow();

    return () => {
      isActive = false;
    };
  }, [deviceId]);

  const title =
    wakeState.status === 'loading'
      ? 'Waking Your PC'
      : wakeState.status === 'success'
        ? 'Wake Signal Sent'
        : 'Wake Shortcut Needs Attention';

  const accentColor = wakeState.status === 'success' ? '#34d399' : wakeState.status === 'error' ? '#fb7185' : '#0891b2';

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: `${accentColor}22` }]}>
          {wakeState.status === 'error' ? (
            <TriangleAlert size={32} color={accentColor} />
          ) : wakeState.status === 'loading' ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <Power size={32} color={accentColor} />
          )}
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{wakeState.message}</Text>

        {wakeState.device ? (
          <View style={styles.deviceCard}>
            <Text style={styles.deviceLabel}>Device</Text>
            <Text style={styles.deviceName}>{wakeState.device.name}</Text>
            <Text style={styles.deviceMeta}>
              {wakeState.device.mac} • {wakeState.device.ip}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: accentColor }]}
          onPress={() =>
            wakeState.device
              ? router.replace(`/devices/${wakeState.device.id}`)
              : router.replace('/devices')
          }
        >
          <Text style={styles.primaryButtonText}>
            {wakeState.device ? 'Open Device' : 'Open Devices'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/devices')}>
          <Text style={styles.secondaryButtonText}>Back to WakeMATE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090f',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 28,
    padding: 24,
    backgroundColor: '#12131b',
    borderWidth: 1,
    borderColor: '#232536',
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 10,
  },
  message: {
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  deviceCard: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#171924',
    borderWidth: 1,
    borderColor: '#2a2e43',
    marginBottom: 20,
  },
  deviceLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  deviceName: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  deviceMeta: {
    color: '#94a3b8',
    fontSize: 13,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3348',
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
});

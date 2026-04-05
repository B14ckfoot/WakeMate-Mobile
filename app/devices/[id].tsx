import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Edit, Monitor, Power, RefreshCw, Settings, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';

export default function DeviceDetailScreen() {
  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [device, setDevice] = useState<Device | null>(null);
  const [status, setStatus] = useState<'online' | 'offline'>('offline');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [isWaking, setIsWaking] = useState(false);

  const loadDevice = useCallback(async (refreshStatus: boolean = true) => {
    try {
      setIsLoading(true);
      const devices = await deviceService.getDevices();
      const foundDevice = devices.find((entry: Device) => entry.id === id);

      if (!foundDevice) {
        Alert.alert('Error', 'Device not found');
        router.back();
        return;
      }

      let nextDevice = foundDevice;

      if (refreshStatus) {
        setIsRefreshingStatus(true);
        const isOnline = await deviceService.checkDeviceStatus(foundDevice.ip);
        const nextStatus = isOnline ? 'online' : 'offline';

        if (nextStatus !== foundDevice.status) {
          nextDevice = {
            ...foundDevice,
            status: nextStatus,
          };

          const updatedDevices = devices.map((entry) => (entry.id === foundDevice.id ? nextDevice : entry));
          await deviceService.saveDevices(updatedDevices);
        }
      }

      setDevice(nextDevice);
      setStatus(nextDevice.status);
    } catch (error) {
      console.error('Error loading device:', error);
      Alert.alert('Error', 'Failed to load device details');
    } finally {
      setIsLoading(false);
      setIsRefreshingStatus(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      loadDevice(true);
    }, [loadDevice])
  );

  const handleDelete = () => {
    Alert.alert('Delete Device', 'Are you sure you want to delete this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const devices = await deviceService.getDevices();
            const updatedDevices = devices.filter((entry: Device) => entry.id !== id);
            await deviceService.saveDevices(updatedDevices);
            router.replace('/devices');
          } catch (error) {
            console.error('Error deleting device:', error);
            Alert.alert('Error', 'Failed to delete device');
          }
        },
      },
    ]);
  };

  const handlePrimaryAction = async () => {
    if (!device) {
      return;
    }

    if (status === 'online') {
      const setupError = await deviceService.getCompanionSetupError();

      if (setupError) {
        Alert.alert('Companion Setup Required', setupError, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => router.push('/settings'),
          },
        ]);
        return;
      }

      router.push(`/devices/control/${device.id}`);
      return;
    }

    if (!device.mac.trim()) {
      Alert.alert('MAC Address Required', 'Add the device MAC address before sending a Wake-on-LAN packet.');
      return;
    }

    try {
      setIsWaking(true);
      const result = await deviceService.wakeMachine(device);
      Alert.alert('Wake Signal Sent', `${result?.message ?? 'Wake-on-LAN packet sent.'}`, [
        {
          text: 'Refresh Status',
          onPress: () => loadDevice(true),
        },
        {
          text: 'OK',
          style: 'default',
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send the wake signal';
      Alert.alert('Wake Failed', message);
    } finally {
      setIsWaking(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.glowOrbOne} />
        <View style={styles.glowOrbTwo} />
        <ActivityIndicator size="large" color="#0891b2" />
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.glowOrbOne} />
        <View style={styles.glowOrbTwo} />
        <Text style={styles.errorText}>Device not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.glowOrbOne} />
      <View style={styles.glowOrbTwo} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
              <ArrowLeft size={22} color="#0891b2" />
            </TouchableOpacity>

            <Text style={styles.headerTitle} numberOfLines={1}>
              {device.name}
            </Text>

            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => loadDevice(true)}
              disabled={isRefreshingStatus}
            >
              <RefreshCw size={20} color="#0891b2" />
            </TouchableOpacity>
          </View>

          <View style={styles.deviceCard}>
            <Text style={styles.eyebrow}>WakeMATE Device</Text>
            <View style={styles.iconContainer}>
              <Monitor size={46} color="#0891b2" />
            </View>

            <Text style={styles.deviceName}>{device.name}</Text>
            <Text style={styles.deviceMeta}>Ping: {device.ip}</Text>

            <View style={styles.statusPill}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: status === 'online' ? '#4ade80' : '#6b7280' },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: status === 'online' ? '#4ade80' : '#d1d5db' },
                ]}
              >
                {isRefreshingStatus ? 'Checking status...' : status === 'online' ? 'Online' : 'Offline'}
              </Text>
            </View>

            <View style={styles.detailsContainer}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>MAC Address</Text>
                <Text style={styles.detailValue}>{device.mac || 'Not set'}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Wake Address</Text>
                <Text style={styles.detailValue}>{device.wakeAddress}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Wake Port</Text>
                <Text style={styles.detailValue}>{device.wakePort}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.primaryButton,
                status === 'offline' && styles.wakeButton,
                isWaking && styles.disabledButton,
              ]}
              onPress={handlePrimaryAction}
              disabled={isWaking}
            >
              {status === 'online' ? (
                <>
                  <Settings size={20} color="#ffffff" />
                  <Text style={[styles.primaryButtonText, styles.buttonTextWithIcon]}>Control Device</Text>
                </>
              ) : (
                <>
                  <Power size={20} color="#ffffff" />
                  <Text style={[styles.primaryButtonText, styles.buttonTextWithIcon]}>
                    {isWaking ? 'Sending Wake Signal...' : 'Wake Device'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.actionsContainer}>
            <TouchableOpacity style={styles.actionButton} onPress={() => router.push(`/devices/edit/${device.id}`)}>
              <Edit size={20} color="#ffffff" />
              <Text style={[styles.actionText, styles.buttonTextWithIcon]}>Edit Device</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={handleDelete}>
              <Trash2 size={20} color="#ffffff" />
              <Text style={[styles.actionText, styles.buttonTextWithIcon]}>Delete Device</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#05090c',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  glowOrbOne: {
    position: 'absolute',
    top: -120,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
  },
  glowOrbTwo: {
    position: 'absolute',
    top: 240,
    left: -90,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(8, 145, 178, 0.1)',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  deviceCard: {
    backgroundColor: '#0b1217',
    borderRadius: 24,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#16313a',
    shadowColor: '#22d3ee',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#67e8f9',
    marginBottom: 14,
  },
  iconContainer: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#04080b',
    borderWidth: 1,
    borderColor: '#17323b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  deviceName: {
    color: '#f8fbff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  deviceMeta: {
    marginTop: 6,
    color: '#8aa1ab',
    fontSize: 15,
    textAlign: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 16,
    marginBottom: 20,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailsContainer: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#17323b',
    paddingTop: 8,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#17323b',
  },
  detailLabel: {
    color: '#8aa1ab',
    fontSize: 14,
    flexShrink: 0,
  },
  detailValue: {
    color: '#f8fbff',
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
    lineHeight: 20,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#0891b2',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wakeButton: {
    backgroundColor: '#059669',
  },
  disabledButton: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  actionsContainer: {
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: '#7f1d1d',
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextWithIcon: {
    marginLeft: 8,
  },
  errorText: {
    color: '#ffffff',
    fontSize: 18,
    textAlign: 'center',
  },
});

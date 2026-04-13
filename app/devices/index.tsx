import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Plus, RefreshCw, Search, Settings } from 'lucide-react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';
import SwipeableDeviceItem from '../../src/components/SwipeableDeviceItem';
import { useServer } from '../../src/context/ServerContext';

export default function DevicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isConnected, connectionError } = useServer();
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingStatuses, setIsRefreshingStatuses] = useState(false);

  const refreshDeviceStatuses = useCallback(async (deviceList: Device[]) => {
    if (deviceList.length === 0) {
      setDevices([]);
      return [];
    }

    setIsRefreshingStatuses(true);

    try {
      const statusResults = await Promise.allSettled(
        deviceList.map(async (device) => {
          const isOnline = await deviceService.checkDeviceStatus(device.ip);
          return {
            ...device,
            status: isOnline ? 'online' : 'offline',
          } satisfies Device;
        })
      );

      const nextDevices = statusResults.map((result, index) =>
        result.status === 'fulfilled' ? result.value : deviceList[index]
      );

      setDevices(nextDevices);

      const statusesChanged = nextDevices.some(
        (device, index) => device.status !== deviceList[index]?.status
      );

      if (statusesChanged) {
        await deviceService.saveDevices(nextDevices);
      }

      return nextDevices;
    } catch (error) {
      console.error('Error refreshing device statuses:', error);
      setDevices(deviceList);
      return deviceList;
    } finally {
      setIsRefreshingStatuses(false);
    }
  }, []);

  const loadDevices = useCallback(async (options?: { showSpinner?: boolean; refreshStatuses?: boolean }) => {
    const showSpinner = options?.showSpinner ?? true;
    const refreshStatuses = options?.refreshStatuses ?? true;

    try {
      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      const loadedDevices = await deviceService.getDevices();
      setDevices(loadedDevices);

      if (refreshStatuses) {
        await refreshDeviceStatuses(loadedDevices);
      }
    } catch (error) {
      console.error('Error loading devices:', error);
      Alert.alert('Error', 'Failed to load your devices');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [refreshDeviceStatuses]);

  useFocusEffect(
    useCallback(() => {
      loadDevices({ showSpinner: true, refreshStatuses: true });
    }, [loadDevices])
  );

  const handleDeleteDevice = (id: string) => {
    Alert.alert(
      'Delete Device',
      'Are you sure you want to delete this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedDevices = devices.filter((device) => device.id !== id);
              await deviceService.saveDevices(updatedDevices);
              setDevices(updatedDevices);
            } catch (error) {
              console.error('Error deleting device:', error);
              Alert.alert('Error', 'Failed to delete device');
            }
          },
        },
      ]
    );
  };

  const handleLongPress = (device: Device) => {
    Alert.alert(device.name, 'Choose an option', [
      {
        text: 'Edit Device',
        onPress: () => router.push(`/devices/edit/${device.id}`),
      },
      {
        text: 'Settings',
        onPress: () => router.push('/settings'),
      },
      {
        text: 'Cancel',
        style: 'cancel',
      },
    ]);
  };

  const handlePressDevice = useCallback((device: Device) => {
    const canOpenControlsDirectly = isConnected && !connectionError && device.status === 'online';

    if (canOpenControlsDirectly) {
      router.push(`/devices/control/${device.id}`);
      return;
    }

    router.push(`/devices/${device.id}`);
  }, [connectionError, isConnected, router]);

  const renderDevice = ({ item }: { item: Device }) => (
    <SwipeableDeviceItem
      device={item}
      onDelete={handleDeleteDevice}
      onPress={handlePressDevice}
      onLongPress={handleLongPress}
    />
  );

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <View style={styles.brandPanel}>
          <View style={styles.brandRow}>
            <View style={styles.brandIconWrap}>
              <Image
                source={require('../../assets/images/MenuBar.ICON.png')}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            <View style={styles.headerTextWrap}>
              <Text style={styles.eyebrow}>WakeMATE</Text>
              <Text style={styles.title}>Your PCs, ready to wake.</Text>
              <Text style={styles.subtitle}>Jump straight into your saved devices, scan for a new one, or wake a machine in one tap.</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push('/settings')}
          accessibilityLabel="Open settings"
        >
          <Settings size={22} color="#22d3ee" />
        </TouchableOpacity>
      </View>

      <View style={styles.contentContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#0891b2" style={styles.loader} />
        ) : devices.length > 0 ? (
          <FlatList
            data={devices}
            renderItem={renderDevice}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.deviceList,
              {
                paddingBottom: insets.bottom + 132,
              },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing || isRefreshingStatuses}
                onRefresh={() => loadDevices({ showSpinner: false, refreshStatuses: true })}
                tintColor="#0891b2"
              />
            }
            ListHeaderComponent={
              <View style={styles.listToolbar}>
                <Text style={styles.listMeta}>
                  {devices.length} {devices.length === 1 ? 'device' : 'devices'}
                </Text>

                <TouchableOpacity
                  style={styles.refreshButton}
                  onPress={() => loadDevices({ showSpinner: false, refreshStatuses: true })}
                  disabled={isRefreshing || isRefreshingStatuses}
                >
                  <RefreshCw size={16} color="#67e8f9" />
                  <Text style={styles.refreshButtonText}>
                    {isRefreshingStatuses ? 'Refreshing...' : 'Refresh status'}
                  </Text>
                </TouchableOpacity>
              </View>
            }
          />
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyLogoWrap}>
              <Image
                source={require('../../assets/images/MenuBar.ICON.png')}
                style={styles.emptyLogo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.emptyText}>No devices found</Text>
            <Text style={styles.emptySubtext}>Scan your network or add a machine manually to start waking and controlling it from here.</Text>
          </View>
        )}
      </View>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.bottomButton, styles.secondaryBottomButton]}
          onPress={() => router.push('/devices/add?scan=1')}
          accessibilityLabel="Scan network and auto fill device info"
        >
          <Search size={18} color="#67e8f9" />
          <Text style={styles.secondaryBottomButtonText}>Scan Network</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomButton, styles.primaryBottomButton]}
          onPress={() => router.push('/devices/add')}
          accessibilityLabel="Add a device"
        >
          <Plus size={18} color="#ffffff" />
          <Text style={styles.primaryBottomButtonText}>Add Device</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#05090c',
    gap: 12,
  },
  brandPanel: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#16313a',
    backgroundColor: '#0b1217',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#22d3ee',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: {
      width: 0,
      height: 12,
    },
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
    paddingLeft: 14,
  },
  brandIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: '#04080b',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandIcon: {
    width: 48,
    height: 48,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#67e8f9',
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f8fbff',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#8aa1ab',
    lineHeight: 20,
  },
  headerIconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loader: {
    flex: 1,
  },
  listToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  listMeta: {
    color: '#8aa1ab',
    fontSize: 14,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0e1d24',
    borderWidth: 1,
    borderColor: '#17323b',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#d8fbff',
    fontSize: 13,
    fontWeight: '600',
  },
  deviceList: {
    paddingTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyLogoWrap: {
    width: 92,
    height: 92,
    borderRadius: 24,
    backgroundColor: '#0b1217',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyLogo: {
    width: 64,
    height: 64,
  },
  emptyText: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#8aa1ab',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#05090c',
    borderTopWidth: 1,
    borderTopColor: '#14252d',
  },
  bottomButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBottomButton: {
    backgroundColor: '#0d171d',
    borderWidth: 1,
    borderColor: '#17323b',
  },
  primaryBottomButton: {
    backgroundColor: '#0891b2',
  },
  secondaryBottomButtonText: {
    color: '#d8fbff',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  primaryBottomButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
});

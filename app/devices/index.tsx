import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

export default function DevicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  const renderDevice = ({ item }: { item: Device }) => (
    <SwipeableDeviceItem
      device={item}
      onDelete={handleDeleteDevice}
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
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>My Devices</Text>
          <Text style={styles.subtitle}>Wake, manage, and control your computers.</Text>
        </View>

        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push('/settings')}
          accessibilityLabel="Open settings"
        >
          <Settings size={22} color="#7c3aed" />
        </TouchableOpacity>
      </View>

      <View style={styles.contentContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#7c3aed" style={styles.loader} />
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
                tintColor="#7c3aed"
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
                  <RefreshCw size={16} color="#c4b5fd" />
                  <Text style={styles.refreshButtonText}>
                    {isRefreshingStatuses ? 'Refreshing...' : 'Refresh status'}
                  </Text>
                </TouchableOpacity>
              </View>
            }
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No devices found</Text>
            <Text style={styles.emptySubtext}>Use the buttons below to scan your network or add a device manually.</Text>
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
          <Search size={18} color="#e9ddff" />
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
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#121212',
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f1f',
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
    color: '#a0a0a0',
    fontSize: 14,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#221a36',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#e9ddff',
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
  emptyText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#a0a0a0',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: '#232323',
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
    backgroundColor: '#221a36',
  },
  primaryBottomButton: {
    backgroundColor: '#7c3aed',
  },
  secondaryBottomButtonText: {
    color: '#e9ddff',
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

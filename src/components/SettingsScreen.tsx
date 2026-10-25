import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  ExternalLink,
  Info,
  LayoutGrid,
  MonitorDown,
  RefreshCw,
  Star,
  Trash,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';
import {
  getFavoriteDeviceId,
  resolveWidgetDevice,
  setFavoriteDeviceId,
} from '../services/favoriteDevice';
import { COMPANION_DOWNLOAD_URL } from './CompanionSetupPrompt';

const appVersion = Constants.expoConfig?.version ?? '1.1.1';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<Device[]>([]);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [loadedDevices, storedFavorite] = await Promise.all([
        deviceService.getDevices(),
        getFavoriteDeviceId(),
      ]);
      setDevices(loadedDevices);
      setFavoriteId(storedFavorite);
    } catch (error) {
      console.error('Error loading settings data:', error);
      Alert.alert('Error', 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectWidgetDevice = useCallback(async (device: Device) => {
    try {
      setFavoriteId(await setFavoriteDeviceId(device.id));
    } catch (error) {
      console.error('Error saving the widget device:', error);
      Alert.alert('Error', 'Could not update which PC the widget wakes.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleClearAllDevices = () => {
    Alert.alert(
      'Clear All Devices',
      'Are you sure you want to remove all devices? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await deviceService.saveDevices([]);
              setDevices([]);
              Alert.alert('Success', 'All devices have been removed');
            } catch (error) {
              console.error('Error clearing devices:', error);
              Alert.alert('Error', 'Failed to clear devices');
            }
          },
        },
      ]
    );
  };

  const handleOpenCompanionSetup = useCallback(async () => {
    try {
      await WebBrowser.openBrowserAsync(COMPANION_DOWNLOAD_URL);
    } catch (error) {
      console.warn('Could not open the WakeMATE Companion download page:', error);
      Alert.alert(
        'Couldn\'t Open the Website',
        'Visit wakematemobile.com from your computer to download WakeMATE Companion.'
      );
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.glowOrbOne} />
        <View style={styles.glowOrbTwo} />
        <ActivityIndicator size="large" color="#0891b2" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.glowOrbOne} />
      <View style={styles.glowOrbTwo} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.maxWidth}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
              <ArrowLeft size={22} color="#0891b2" />
            </TouchableOpacity>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity style={styles.headerButton} onPress={loadData}>
              <RefreshCw size={20} color="#0891b2" />
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MonitorDown size={20} color="#0891b2" />
              <Text style={styles.sectionTitle}>Windows Companion</Text>
            </View>

            <Text style={styles.companionDescription}>
              Download the Companion on the Windows PC you want to wake and control, then scan its tray QR code inside WakeMATE.
            </Text>
            <TouchableOpacity
              style={styles.companionLink}
              onPress={() => { void handleOpenCompanionSetup(); }}
              accessibilityRole="link"
              accessibilityLabel="Open the WakeMATE Companion download and setup page"
            >
              <Text style={styles.companionLinkText}>Download &amp; Setup</Text>
              <ExternalLink size={17} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* The Home Screen widget and Control Center button exist only on iOS. */}
          {Platform.OS === 'ios' ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <LayoutGrid size={20} color="#0891b2" />
                <Text style={styles.sectionTitle}>Widget &amp; Control Center</Text>
              </View>

              {devices.length > 0 ? (
                <>
                  <Text style={styles.companionDescription}>
                    Pick the PC your Home Screen widget and Control Center button wake. To give one
                    widget a different PC, hold it on the Home Screen and choose Edit Widget.
                  </Text>

                  {devices.map((device) => {
                    const isWidgetDevice = resolveWidgetDevice(devices, favoriteId)?.id === device.id;

                    return (
                      <TouchableOpacity
                        key={device.id}
                        style={[styles.widgetOption, isWidgetDevice && styles.widgetOptionSelected]}
                        onPress={() => { void handleSelectWidgetDevice(device); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isWidgetDevice }}
                        accessibilityLabel={
                          isWidgetDevice
                            ? `${device.name} is the computer the widget wakes`
                            : `Use ${device.name} for the widget`
                        }
                      >
                        <Star
                          size={20}
                          color={isWidgetDevice ? '#fbbf24' : '#4b6470'}
                          fill={isWidgetDevice ? '#fbbf24' : 'transparent'}
                        />

                        <View style={styles.widgetOptionText}>
                          <Text style={styles.deviceName}>{device.name}</Text>
                          <Text style={styles.deviceLine}>
                            {isWidgetDevice ? `${device.ip} • Widget default` : device.ip}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <Text style={styles.noDevicesText}>
                  Add a computer first, then choose which one the widget wakes.
                </Text>
              )}
            </View>
          ) : null}

          {/* Each computer is renamed or removed from its own page in the device
              list. Settings used to list them again with a second edit form,
              which showed the same details twice. */}
          {devices.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Trash size={20} color="#0891b2" />
                <Text style={styles.sectionTitle}>Reset</Text>
              </View>

              <Text style={styles.companionDescription}>
                Removes every saved computer and its pairing from this phone. To rename or remove
                one computer, open it from the device list.
              </Text>

              <TouchableOpacity style={styles.clearAllButton} onPress={handleClearAllDevices}>
                <Trash size={18} color="#ffffff" />
                <Text style={styles.clearAllText}>Clear All Devices</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Info size={20} color="#0891b2" />
              <Text style={styles.sectionTitle}>About</Text>
            </View>

            <View style={styles.aboutInfo}>
              <Text style={styles.appName}>WakeMATE Mobile</Text>
              <Text style={styles.appVersion}>Version {appVersion}</Text>
              <Text style={styles.appDescription}>
                Mobile companion for the WakeMATE desktop service, built to wake and control your computers remotely.
              </Text>
            </View>
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
  content: {
    paddingHorizontal: 16,
  },
  maxWidth: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '800',
  },
  section: {
    backgroundColor: '#0b1217',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#16313a',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
    marginLeft: 8,
  },
  widgetOption: {
    backgroundColor: '#0f171c',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#17323b',
  },
  widgetOptionSelected: {
    borderColor: '#fbbf24',
    backgroundColor: '#141a18',
  },
  widgetOptionText: {
    flex: 1,
  },
  deviceName: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  deviceLine: {
    color: '#7f97a1',
    fontSize: 13,
    lineHeight: 18,
  },
  noDevicesText: {
    color: '#8aa1ab',
    textAlign: 'center',
    paddingVertical: 10,
  },
  clearAllButton: {
    backgroundColor: '#991b1b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 8,
  },
  clearAllText: {
    color: '#ffffff',
    fontWeight: '700',
    marginLeft: 8,
  },
  companionDescription: {
    color: '#8aa1ab',
    fontSize: 14,
    lineHeight: 21,
  },
  companionLink: {
    minHeight: 48,
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#0891b2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  companionLinkText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  aboutInfo: {
    alignItems: 'center',
    paddingTop: 4,
  },
  appName: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
  },
  appVersion: {
    color: '#7f97a1',
    marginTop: 4,
  },
  appDescription: {
    color: '#7f97a1',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});

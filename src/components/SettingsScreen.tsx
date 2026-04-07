import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  ArrowLeft,
  Camera,
  Edit,
  Info,
  RefreshCw,
  Save,
  Server,
  Trash,
  Wifi,
  WifiOff,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';
import { useServer } from '../context/ServerContext';
import {
  DEFAULT_WAKE_PORT,
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../utils/deviceNetwork';

const SCANNABLE_TOKEN_KEYS = ['api_token', 'token', 'pairing_token', 'pairingToken', 'serverToken'] as const;

const getScannableString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const extractTokenFromObject = (value: Record<string, unknown>): string | null => {
  for (const key of SCANNABLE_TOKEN_KEYS) {
    const token = getScannableString(value[key]);
    if (token) {
      return token;
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const token = extractTokenFromObject(nestedValue as Record<string, unknown>);
      if (token) {
        return token;
      }
    }
  }

  return null;
};

const extractTokenFromQrData = (rawData: string): string | null => {
  const trimmedData = rawData.trim();
  if (!trimmedData) {
    return null;
  }

  try {
    const parsedData = JSON.parse(trimmedData);
    if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
      const tokenFromJson = extractTokenFromObject(parsedData as Record<string, unknown>);
      if (tokenFromJson) {
        return tokenFromJson;
      }
    }
  } catch {
    // The QR code may contain a raw token or URL instead of JSON.
  }

  const queryParamMatch = trimmedData.match(
    /(?:^|[?&#])(?:api_token|token|pairing_token|pairingToken|serverToken)=([^&#]+)/i
  );
  if (queryParamMatch?.[1]) {
    try {
      return decodeURIComponent(queryParamMatch[1]).trim();
    } catch {
      return queryParamMatch[1].trim();
    }
  }

  const keyedValueMatch = trimmedData.match(
    /(?:api_token|token|pairing_token|pairingToken|serverToken)\s*[:=]\s*["']?([^"'\s,}]+)/i
  );
  if (keyedValueMatch?.[1]) {
    return keyedValueMatch[1].trim();
  }

  const firstNonEmptyLine = trimmedData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstNonEmptyLine && !/\s/.test(firstNonEmptyLine)) {
    return firstNonEmptyLine;
  }

  return null;
};

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [serverIpInput, setServerIpInput] = useState('');
  const [serverTokenInput, setServerTokenInput] = useState('');
  const [editName, setEditName] = useState('');
  const [editMac, setEditMac] = useState('');
  const [editIp, setEditIp] = useState('');
  const [editWakeAddress, setEditWakeAddress] = useState('');
  const [editWakePort, setEditWakePort] = useState(String(DEFAULT_WAKE_PORT));
  const [modalVisible, setModalVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [tokenScanNotice, setTokenScanNotice] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const tokenScanLockedRef = useRef(false);

  const {
    serverIp,
    setServerIp,
    serverToken,
    setServerToken,
    isConnected,
    connectionError,
    testConnection,
  } = useServer();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const loadedDevices = await deviceService.getDevices();
      setDevices(loadedDevices);
    } catch (error) {
      console.error('Error loading settings data:', error);
      Alert.alert('Error', 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setServerIpInput(serverIp);
    setServerTokenInput(serverToken);
  }, [serverIp, serverToken]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const persistConnectionSettings = useCallback(async (nextServerIp: string, nextServerToken: string) => {
    await Promise.all([
      deviceService.setServerAddress(nextServerIp),
      deviceService.setServerToken(nextServerToken),
    ]);

    setServerIp(nextServerIp);
    setServerToken(nextServerToken);
  }, [setServerIp, setServerToken]);

  const pairAndEnableRemoteControls = useCallback(async (nextServerIp: string, nextServerToken: string) => {
    await persistConnectionSettings(nextServerIp, nextServerToken);

    const connected = await testConnection(nextServerIp, nextServerToken);
    if (!connected) {
      return false;
    }

    await deviceService.activatePairedControls(nextServerIp, nextServerToken);
    await testConnection(nextServerIp, nextServerToken);
    return true;
  }, [persistConnectionSettings, testConnection]);

  const handleUpdateServerConnection = async () => {
    const nextServerIp = serverIpInput.trim();
    const nextServerToken = serverTokenInput.trim();

    if (!nextServerIp) {
      Alert.alert('Error', 'Please enter a valid server IP');
      return;
    }

    if (!isValidIpAddress(nextServerIp)) {
      Alert.alert('Error', 'Please enter a valid IP address (for example 192.168.1.100)');
      return;
    }

    try {
      if (nextServerToken) {
        const paired = await pairAndEnableRemoteControls(nextServerIp, nextServerToken);
        if (paired) {
          Alert.alert('Success', 'Connected to the WakeMATE companion and enabled remote controls for this computer.');
        }
        return;
      }

      await persistConnectionSettings(nextServerIp, nextServerToken);

      const connected = await testConnection(nextServerIp, nextServerToken);
      if (connected) {
        Alert.alert('Connected', 'The companion is reachable. Add the pairing token to enable commands.');
      }
    } catch (error) {
      console.error('Error updating companion connection:', error);
      const message = error instanceof Error ? error.message : 'Failed to connect to the WakeMATE companion.';
      Alert.alert('Connection Error', message);
    }
  };

  const handleEditDevice = (device: Device) => {
    setEditingDevice(device);
    setEditName(device.name);
    setEditMac(device.mac);
    setEditIp(device.ip);
    setEditWakeAddress(device.wakeAddress);
    setEditWakePort(String(device.wakePort));
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingDevice(null);
  };

  const closeTokenScanner = useCallback(() => {
    tokenScanLockedRef.current = false;
    setScannerError(null);
    setScannerVisible(false);
  }, []);

  const handleOpenTokenScanner = useCallback(async () => {
    tokenScanLockedRef.current = false;
    setScannerError(null);
    setTokenScanNotice(null);

    try {
      if (!cameraPermission?.granted) {
        const permissionResponse = await requestCameraPermission();
        if (!permissionResponse.granted) {
          Alert.alert(
            'Camera Access Needed',
            permissionResponse.canAskAgain
              ? 'Allow camera access to scan the WakeMATE pairing token QR code.'
              : 'Camera access is disabled for WakeMATE. Enable it in your device settings to scan the pairing token.'
          );
          return;
        }
      }

      setScannerVisible(true);
    } catch (error) {
      console.error('Error requesting camera permission:', error);
      Alert.alert('Scanner Unavailable', 'Camera access could not be started right now.');
    }
  }, [cameraPermission?.granted, requestCameraPermission]);

  const handleTokenQrScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (tokenScanLockedRef.current) {
        return;
      }

      tokenScanLockedRef.current = true;

      const token = extractTokenFromQrData(data);
      if (!token) {
        Alert.alert(
          'Unsupported QR Code',
          'Scan a QR code that contains the raw pairing token, api_token=..., JSON with api_token, or a WakeMATE pairing link.'
        );
        tokenScanLockedRef.current = false;
        return;
      }

      setServerTokenInput(token);
      setScannerVisible(false);
      setScannerError(null);

      let nextServerIp = serverIpInput.trim();

      if (!isValidIpAddress(nextServerIp)) {
        try {
          const discoveredServerIp = await deviceService.discoverCompanionServer();
          if (discoveredServerIp && isValidIpAddress(discoveredServerIp)) {
            nextServerIp = discoveredServerIp;
            setServerIpInput(discoveredServerIp);
          }
        } catch (error) {
          console.error('Error discovering companion during QR pairing:', error);
        }
      }

      if (!isValidIpAddress(nextServerIp)) {
        setTokenScanNotice('Pairing token scanned. Add or confirm the companion IP to finish enabling remote controls automatically.');
        return;
      }

      try {
        setTokenScanNotice('Pairing token scanned. Enabling remote controls for this computer...');
        const paired = await pairAndEnableRemoteControls(nextServerIp, token);

        if (paired) {
          setTokenScanNotice('Pairing complete. Remote controls are now enabled for this computer.');
          Alert.alert('Pairing Complete', 'Remote controls are now enabled for this computer.');
          return;
        }

        setTokenScanNotice('Pairing token scanned, but the companion could not be reached yet. Check the saved IP and try again.');
      } catch (error) {
        console.error('Error enabling paired controls after QR scan:', error);
        const message = error instanceof Error
          ? error.message
          : 'The token was saved, but remote controls could not be enabled automatically.';
        setTokenScanNotice('Pairing token scanned, but remote controls could not be enabled automatically.');
        Alert.alert('Pairing Incomplete', message);
      }

      setScannerError(null);
    },
    [pairAndEnableRemoteControls, serverIpInput]
  );

  const handleSaveEdit = async () => {
    if (!editingDevice) {
      return;
    }

    if (!editName.trim()) {
      Alert.alert('Error', 'Please enter a device name');
      return;
    }

    if (!editMac.trim()) {
      Alert.alert('Error', 'Please enter the MAC address so Wake-on-LAN works while the PC is off');
      return;
    }

    if (!isValidMacAddress(editMac)) {
      Alert.alert('Error', 'Please enter a valid MAC address (for example 00:11:22:33:44:55)');
      return;
    }

    if (!editIp.trim()) {
      Alert.alert('Error', 'Please enter the ping address used to detect and control the device');
      return;
    }

    if (!isValidIpAddress(editIp.trim())) {
      Alert.alert('Error', 'Please enter a valid ping address (for example 192.168.1.100)');
      return;
    }

    if (editWakeAddress.trim() && !isValidIpAddress(editWakeAddress.trim())) {
      Alert.alert('Error', 'Please enter a valid wake address or leave it blank to use the subnet broadcast');
      return;
    }

    const parsedPort = Number.parseInt(editWakePort.trim(), 10);
    if (editWakePort.trim() && (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535)) {
      Alert.alert('Error', 'Please enter a valid wake port between 0 and 65535');
      return;
    }

    try {
      const suggestedWakeAddress = getSuggestedWakeAddress(editIp.trim());
      const updatedDevice: Device = {
        ...editingDevice,
        name: editName.trim(),
        mac: normalizeMacAddress(editMac),
        ip: editIp.trim(),
        wakeAddress: editWakeAddress.trim() || suggestedWakeAddress || editIp.trim(),
        wakePort: sanitizeWakePort(editWakePort, DEFAULT_WAKE_PORT),
      };

      const updatedDevices = devices.map((device) =>
        device.id === updatedDevice.id ? updatedDevice : device
      );

      await deviceService.saveDevices(updatedDevices);
      setDevices(updatedDevices);
      closeModal();
      Alert.alert('Success', 'Device updated successfully');
    } catch (error) {
      console.error('Error updating device:', error);
      Alert.alert('Error', 'Failed to update device');
    }
  };

  const handleDeleteDevice = (deviceId: string) => {
    Alert.alert('Delete Device', 'Are you sure you want to delete this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const updatedDevices = devices.filter((device) => device.id !== deviceId);
            await deviceService.saveDevices(updatedDevices);
            setDevices(updatedDevices);
          } catch (error) {
            console.error('Error deleting device:', error);
            Alert.alert('Error', 'Failed to delete device');
          }
        },
      },
    ]);
  };

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
              <Server size={20} color="#0891b2" />
              <Text style={styles.sectionTitle}>Companion Connection</Text>
            </View>

            <View style={styles.serverStatus}>
              {isConnected ? (
                <View style={styles.statusRow}>
                  <Wifi size={18} color="#4ade80" />
                  <Text style={styles.connectedText}>Connected</Text>
                </View>
              ) : (
                <View style={styles.statusRow}>
                  <WifiOff size={18} color="#ef4444" />
                  <Text style={styles.disconnectedText}>Disconnected</Text>
                </View>
              )}

              <TouchableOpacity style={styles.refreshButton} onPress={() => testConnection(serverIpInput.trim(), serverTokenInput.trim())}>
                <RefreshCw size={18} color="#0891b2" />
              </TouchableOpacity>
            </View>

            {connectionError ? (
              <Text style={isConnected ? styles.infoText : styles.errorText}>{connectionError}</Text>
            ) : null}

            <Text style={styles.inputLabel}>Server IP</Text>
            <TextInput
              style={styles.input}
              value={serverIpInput}
              onChangeText={setServerIpInput}
              placeholder="192.168.1.100"
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
              autoCorrect={false}
            />

            <Text style={styles.inputLabel}>Pairing Token</Text>
            <TextInput
              style={styles.input}
              value={serverTokenInput}
              onChangeText={setServerTokenInput}
              placeholder="Token from wakemate.config.json"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.tokenScanButton} onPress={handleOpenTokenScanner}>
              <Camera size={16} color="#67e8f9" />
              <Text style={styles.tokenScanButtonText}>Scan QR Code</Text>
            </TouchableOpacity>
            <Text style={styles.helpText}>
              Copy the `api_token` value from `wakemate.config.json`, or scan a QR code that contains the token.
            </Text>
            {tokenScanNotice ? <Text style={styles.infoText}>{tokenScanNotice}</Text> : null}

            <TouchableOpacity style={styles.primaryButton} onPress={handleUpdateServerConnection}>
              <Text style={styles.primaryButtonText}>Save and Test</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Wifi size={20} color="#0891b2" />
              <Text style={styles.sectionTitle}>Saved Devices</Text>
            </View>

            {devices.length > 0 ? (
              devices.map((device) => (
                <View key={device.id} style={styles.deviceItem}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{device.name}</Text>
                    <Text style={styles.deviceLine}>Ping: {device.ip}</Text>
                    <Text style={styles.deviceLine}>MAC: {device.mac}</Text>
                    <Text style={styles.deviceLine}>
                      Wake: {device.wakeAddress}:{device.wakePort}
                    </Text>
                  </View>

                  <View style={styles.deviceActions}>
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleEditDevice(device)}>
                      <Edit size={20} color="#0891b2" />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.actionButton} onPress={() => handleDeleteDevice(device.id)}>
                      <Trash size={20} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.noDevicesText}>No devices added yet.</Text>
            )}

            {devices.length > 0 ? (
              <TouchableOpacity style={styles.clearAllButton} onPress={handleClearAllDevices}>
                <Trash size={18} color="#ffffff" />
                <Text style={styles.clearAllText}>Clear All Devices</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Info size={20} color="#0891b2" />
              <Text style={styles.sectionTitle}>About</Text>
            </View>

            <View style={styles.aboutInfo}>
              <Text style={styles.appName}>WakeMATE Mobile</Text>
              <Text style={styles.appVersion}>Version 1.0.0</Text>
              <Text style={styles.appDescription}>
                Mobile companion for the WakeMATE desktop service, built to wake and control your computers remotely.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top}
          style={styles.modalOverlay}
        >
          <View style={styles.modalShell}>
            <ScrollView
              contentContainerStyle={[
                styles.modalContent,
                {
                  paddingBottom: insets.bottom + 20,
                },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitle}>Edit Device</Text>

              <Text style={styles.inputLabel}>Device Name</Text>
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                placeholder="My Computer"
                placeholderTextColor="#6b7280"
              />

              <Text style={styles.inputLabel}>MAC Address</Text>
              <TextInput
                style={styles.input}
                value={editMac}
                onChangeText={setEditMac}
                placeholder="00:11:22:33:44:55"
                placeholderTextColor="#6b7280"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Text style={styles.helpText}>Required for Wake-on-LAN while the PC is powered off.</Text>

              <Text style={styles.inputLabel}>Ping Address</Text>
              <TextInput
                style={styles.input}
                value={editIp}
                onChangeText={setEditIp}
                placeholder="192.168.1.100"
                placeholderTextColor="#6b7280"
                keyboardType="decimal-pad"
                autoCorrect={false}
              />
              <Text style={styles.helpText}>Used to check status and send commands once the PC is online.</Text>

              <Text style={styles.inputLabel}>Wake Address</Text>
              <TextInput
                style={styles.input}
                value={editWakeAddress}
                onChangeText={setEditWakeAddress}
                placeholder={getSuggestedWakeAddress(editIp) || '192.168.1.255'}
                placeholderTextColor="#6b7280"
                keyboardType="decimal-pad"
                autoCorrect={false}
              />
              <Text style={styles.helpText}>
                Wake-on-LAN target. Leave this blank to use {getSuggestedWakeAddress(editIp) || 'the broadcast for your ping address'}.
              </Text>

              <Text style={styles.inputLabel}>Wake Port</Text>
              <TextInput
                style={styles.input}
                value={editWakePort}
                onChangeText={setEditWakePort}
                placeholder={String(DEFAULT_WAKE_PORT)}
                placeholderTextColor="#6b7280"
                keyboardType="number-pad"
              />
              <Text style={styles.helpText}>Most devices use port 9, but some networks use 7 or 0.</Text>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.saveButton} onPress={handleSaveEdit}>
                  <Save size={16} color="#ffffff" />
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={scannerVisible} animationType="slide" onRequestClose={closeTokenScanner}>
        <View style={styles.scannerModal}>
          <View
            style={[
              styles.scannerHeader,
              {
                paddingTop: insets.top + 12,
              },
            ]}
          >
            <TouchableOpacity style={styles.headerButton} onPress={closeTokenScanner}>
              <ArrowLeft size={22} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Pairing Token</Text>
            <View style={styles.scannerHeaderSpacer} />
          </View>

          <View style={styles.scannerCameraShell}>
            <CameraView
              style={styles.scannerCamera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={handleTokenQrScanned}
              onMountError={(event) => setScannerError(event.message)}
            />
            <View pointerEvents="none" style={styles.scannerOverlay}>
              <View style={styles.scannerFrame} />
            </View>
          </View>

          <View
            style={[
              styles.scannerFooter,
              {
                paddingBottom: insets.bottom + 24,
              },
            ]}
          >
            <Text style={styles.scannerDescription}>
              Point the camera at a QR code with your WakeMATE pairing token.
            </Text>
            <Text style={styles.scannerSubtext}>
              Raw token, `api_token=...`, JSON, and `wakemate://pair?token=...` all work.
            </Text>
            {scannerError ? <Text style={styles.scannerError}>{scannerError}</Text> : null}

            <TouchableOpacity style={styles.cancelButton} onPress={closeTokenScanner}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  serverStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectedText: {
    color: '#4ade80',
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  disconnectedText: {
    color: '#ef4444',
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  refreshButton: {
    padding: 6,
  },
  errorText: {
    color: '#fca5a5',
    marginBottom: 12,
    lineHeight: 20,
  },
  infoText: {
    color: '#67e8f9',
    marginBottom: 12,
    lineHeight: 20,
  },
  inputLabel: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#0f171c',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#f8fbff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#17323b',
  },
  tokenScanButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tokenScanButtonText: {
    color: '#d8fbff',
    fontSize: 13,
    fontWeight: '700',
  },
  helpText: {
    color: '#7f97a1',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 18,
    backgroundColor: '#0891b2',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  deviceItem: {
    backgroundColor: '#0f171c',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#17323b',
  },
  deviceInfo: {
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
  deviceActions: {
    justifyContent: 'center',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#091117',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalShell: {
    maxHeight: '92%',
  },
  scannerModal: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  scannerHeader: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scannerHeaderSpacer: {
    width: 42,
  },
  scannerTitle: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
  },
  scannerCameraShell: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  scannerCamera: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerFrame: {
    width: '72%',
    aspectRatio: 1,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.92)',
    backgroundColor: 'transparent',
  },
  scannerFooter: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 10,
  },
  scannerDescription: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  scannerSubtext: {
    color: '#8aa1ab',
    fontSize: 13,
    lineHeight: 20,
  },
  scannerError: {
    color: '#fca5a5',
    lineHeight: 20,
  },
  modalContent: {
    backgroundColor: '#0b1217',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: '#16313a',
  },
  modalTitle: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#0f171c',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#17323b',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#0891b2',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  saveButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    marginLeft: 8,
  },
});

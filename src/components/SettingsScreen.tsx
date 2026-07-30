import React, { useCallback, useState } from 'react';
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
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Edit,
  Info,
  RefreshCw,
  Save,
  Trash,
  Wifi,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';
import {
  DEFAULT_WAKE_PORT,
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../utils/deviceNetwork';

const appVersion = Constants.expoConfig?.version ?? '1.1.0';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editName, setEditName] = useState('');
  const [editMac, setEditMac] = useState('');
  const [editIp, setEditIp] = useState('');
  const [editWakeAddress, setEditWakeAddress] = useState('');
  const [editWakePort, setEditWakePort] = useState(String(DEFAULT_WAKE_PORT));
  const [modalVisible, setModalVisible] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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
              <Text style={styles.appVersion}>Version {appVersion}</Text>
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
  helpText: {
    color: '#7f97a1',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
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

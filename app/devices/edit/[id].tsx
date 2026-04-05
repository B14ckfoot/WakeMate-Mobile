import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Save } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../../src/types/device';
import deviceService from '../../services/deviceService';
import {
  DEFAULT_WAKE_PORT,
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../../../src/utils/deviceNetwork';

export default function EditDeviceScreen() {
  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [pingAddress, setPingAddress] = useState('');
  const [wakeAddress, setWakeAddress] = useState('');
  const [wakePort, setWakePort] = useState(String(DEFAULT_WAKE_PORT));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const suggestedWakeAddress = getSuggestedWakeAddress(pingAddress);

  const loadDevice = useCallback(async () => {
    try {
      setIsLoading(true);
      const devices = await deviceService.getDevices();
      const device = devices.find((entry: Device) => entry.id === id);

      if (!device) {
        Alert.alert('Error', 'Device not found');
        router.back();
        return;
      }

      setName(device.name);
      setMac(device.mac);
      setPingAddress(device.ip);
      setWakeAddress(device.wakeAddress);
      setWakePort(String(device.wakePort));
    } catch (error) {
      console.error('Error loading device:', error);
      Alert.alert('Error', 'Failed to load device details');
    } finally {
      setIsLoading(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      loadDevice();
    }, [loadDevice])
  );

  const validateFields = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a device name');
      return false;
    }
    if (!mac.trim()) {
      Alert.alert('Error', 'Please enter the MAC address so Wake-on-LAN works while the PC is off');
      return false;
    }
    if (!isValidMacAddress(mac)) {
      Alert.alert('Error', 'Please enter a valid MAC address (for example 00:11:22:33:44:55)');
      return false;
    }
    if (!pingAddress.trim()) {
      Alert.alert('Error', 'Please enter the ping address used to detect and control the device');
      return false;
    }
    if (!isValidIpAddress(pingAddress)) {
      Alert.alert('Error', 'Please enter a valid ping address (for example 192.168.1.100)');
      return false;
    }
    if (wakeAddress.trim() && !isValidIpAddress(wakeAddress)) {
      Alert.alert('Error', 'Please enter a valid wake address or leave it blank to use the subnet broadcast');
      return false;
    }

    const parsedPort = Number.parseInt(wakePort.trim(), 10);
    if (wakePort.trim() && (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535)) {
      Alert.alert('Error', 'Please enter a valid wake port between 0 and 65535');
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateFields()) {
      return;
    }

    try {
      setIsSaving(true);
      const devices = await deviceService.getDevices();

      const updatedDevices = devices.map((device: Device) => {
        if (device.id !== id) {
          return device;
        }

        return {
          ...device,
          name: name.trim(),
          mac: normalizeMacAddress(mac),
          ip: pingAddress.trim(),
          wakeAddress: wakeAddress.trim() || suggestedWakeAddress || pingAddress.trim(),
          wakePort: sanitizeWakePort(wakePort, DEFAULT_WAKE_PORT),
        };
      });

      await deviceService.saveDevices(updatedDevices);

      Alert.alert('Success', 'Device updated successfully', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) {
      console.error('Error updating device:', error);
      Alert.alert('Error', 'Failed to update device');
    } finally {
      setIsSaving(false);
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
      style={styles.container}
    >
      <View style={styles.glowOrbOne} />
      <View style={styles.glowOrbTwo} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color="#0891b2" />
          </TouchableOpacity>

          <Text style={styles.eyebrow}>WakeMATE Setup</Text>
          <Text style={styles.title}>Edit Device</Text>
          <Text style={styles.subtitle}>Update the saved device details without leaving the current setup flow.</Text>

          <View style={styles.formCard}>
            <Text style={styles.label}>Device Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="My Computer"
              placeholderTextColor="#5f7480"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={styles.label}>MAC Address</Text>
            <TextInput
              style={styles.input}
              value={mac}
              onChangeText={setMac}
              placeholder="00:11:22:33:44:55"
              placeholderTextColor="#5f7480"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>Required for waking the PC while it is powered off.</Text>

            <Text style={styles.label}>Ping Address</Text>
            <TextInput
              style={styles.input}
              value={pingAddress}
              onChangeText={setPingAddress}
              placeholder="192.168.1.100"
              placeholderTextColor="#5f7480"
              keyboardType="decimal-pad"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>Used to check status and send commands once the PC is online.</Text>

            <Text style={styles.label}>Wake Address</Text>
            <TextInput
              style={styles.input}
              value={wakeAddress}
              onChangeText={setWakeAddress}
              placeholder={suggestedWakeAddress || '192.168.1.255'}
              placeholderTextColor="#5f7480"
              keyboardType="decimal-pad"
              autoCorrect={false}
            />
            <Text style={styles.helperText}>
              Wake-on-LAN target. Leave this blank to use {suggestedWakeAddress || 'the broadcast for your ping address'}.
            </Text>

            <Text style={styles.label}>Wake Port</Text>
            <TextInput
              style={styles.input}
              value={wakePort}
              onChangeText={setWakePort}
              placeholder={String(DEFAULT_WAKE_PORT)}
              placeholderTextColor="#5f7480"
              keyboardType="number-pad"
            />
            <Text style={styles.helperText}>Most devices use port 9, but some networks use 7 or 0.</Text>

            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.disabledButton]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Text style={styles.buttonText}>Saving...</Text>
              ) : (
                <>
                  <Save size={20} color="#ffffff" />
                  <Text style={[styles.buttonText, styles.buttonTextWithIcon]}>Save Changes</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
    marginBottom: 20,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#67e8f9',
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#f8fbff',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 24,
    fontSize: 15,
    lineHeight: 22,
    color: '#8aa1ab',
  },
  formCard: {
    backgroundColor: '#0b1217',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#16313a',
  },
  label: {
    color: '#f8fbff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#0f171c',
    color: '#f8fbff',
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#17323b',
  },
  helperText: {
    color: '#6f8791',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: '#0891b2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 28,
  },
  disabledButton: {
    opacity: 0.72,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  buttonTextWithIcon: {
    marginLeft: 8,
  },
});

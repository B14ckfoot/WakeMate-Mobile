import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ArrowLeft, Plus, Search } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import { useServer } from '../../src/context/ServerContext';
import deviceService from '../services/deviceService';
import {
  DEFAULT_WAKE_PORT,
  getSuggestedWakeAddress,
  isValidIpAddress,
  isValidMacAddress,
  normalizeMacAddress,
  sanitizeWakePort,
} from '../../src/utils/deviceNetwork';

const NAME_KEYS = [
  'name',
  'hostname',
  'host',
  'devicename',
  'computername',
  'machinename',
  'friendlyname',
  'systemname',
];
const IP_KEYS = ['ip', 'localip', 'ipaddress', 'address', 'hostip', 'ipv4', 'localaddress'];
const MAC_KEYS = ['mac', 'macaddress', 'hwaddress', 'physicaladdress', 'ethernetmac', 'wifiMac'];

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const toCandidateString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const findValueByKeys = (
  input: unknown,
  keys: string[],
  validator?: (value: string) => boolean
): string | null => {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      const candidate = toCandidateString(value);

      if (normalizedKeys.has(normalizeKey(key)) && candidate && (!validator || validator(candidate))) {
        return candidate;
      }

      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return null;
};

const findMatchingValue = (input: unknown, validator: (value: string) => boolean): string | null => {
  const queue: unknown[] = [input];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current)) {
      const candidate = toCandidateString(current);
      if (candidate && validator(candidate)) {
        return candidate;
      }
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const value of Object.values(current)) {
      const candidate = toCandidateString(value);
      if (candidate && validator(candidate)) {
        return candidate;
      }

      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return null;
};

const extractCompanionFields = (info: unknown, fallbackIp: string) => {
  const payload = isRecord(info) && 'data' in info ? (info as UnknownRecord).data : info;

  const pingIp =
    findValueByKeys(payload, IP_KEYS, isValidIpAddress) ??
    findMatchingValue(payload, isValidIpAddress) ??
    fallbackIp;

  const rawMac =
    findValueByKeys(payload, MAC_KEYS, isValidMacAddress) ??
    findMatchingValue(payload, isValidMacAddress) ??
    '';

  const name =
    findValueByKeys(payload, NAME_KEYS) ??
    `WakeMATE ${pingIp}`;

  return {
    name,
    pingIp,
    mac: rawMac ? normalizeMacAddress(rawMac) : '',
    wakeAddress: getSuggestedWakeAddress(pingIp) || pingIp,
  };
};

export default function AddDeviceScreen() {
  const params = useLocalSearchParams<{ scan?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { serverIp, serverToken, setServerIp } = useServer();
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [pingAddress, setPingAddress] = useState('');
  const [wakeAddress, setWakeAddress] = useState('');
  const [wakePort, setWakePort] = useState(String(DEFAULT_WAKE_PORT));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const hasAutoScannedRef = useRef(false);

  const suggestedWakeAddress = getSuggestedWakeAddress(pingAddress);

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

  const handleScanAndAutoFill = useCallback(async () => {
    try {
      setIsScanning(true);

      const discoveredServerIp = await deviceService.discoverCompanionServer();
      if (!discoveredServerIp) {
        Alert.alert(
          'No WakeMATE Companion Found',
          'Make sure the desktop companion is running and that your phone and computer are on the same Wi-Fi network.'
        );
        return;
      }

      const savedCompanionIp = discoveredServerIp.trim();
      const hadDifferentServerIp = serverIp.trim() !== savedCompanionIp;
      setServerIp(savedCompanionIp);

      const info = await deviceService.getCompanionInfo(discoveredServerIp);
      const companionFields = extractCompanionFields(info, discoveredServerIp);
      const filledFields: string[] = [];
      const missingFields: string[] = [];

      if (!name.trim() && companionFields.name) {
        setName(companionFields.name);
        filledFields.push('name');
      }

      if (!pingAddress.trim() && companionFields.pingIp) {
        setPingAddress(companionFields.pingIp);
        filledFields.push('ping address');
      }

      if (!mac.trim() && companionFields.mac) {
        setMac(companionFields.mac);
        filledFields.push('MAC address');
      } else if (!mac.trim()) {
        missingFields.push('MAC address');
      }

      if (!wakeAddress.trim() && companionFields.wakeAddress) {
        setWakeAddress(companionFields.wakeAddress);
        filledFields.push('wake address');
      }

      const connectionNotes: string[] = [];
      if (hadDifferentServerIp) {
        connectionNotes.push(`Companion API connected at ${savedCompanionIp}.`);
      } else {
        connectionNotes.push(`Companion API confirmed at ${savedCompanionIp}.`);
      }

      if (!serverToken.trim()) {
        connectionNotes.push('Remote commands will work as soon as a pairing token is available.');
      }

      if (filledFields.length === 0) {
        Alert.alert(
          'Scan Complete',
          `${connectionNotes.join('\n')}\n\nYour current form already has values. Clear a field if you want scan results to replace it.`
        );
        return;
      }

      const summary =
        missingFields.length > 0
          ? `Filled: ${filledFields.join(', ')}.\nStill needed: ${missingFields.join(', ')}.`
          : `Filled: ${filledFields.join(', ')}.`;

      Alert.alert('Auto Fill Complete', `${connectionNotes.join('\n')}\n\n${summary}`);
    } catch (error) {
      console.error('Error scanning for companion info:', error);
      const message = error instanceof Error ? error.message : 'Unable to scan the network right now.';
      Alert.alert('Scan Failed', message);
    } finally {
      setIsScanning(false);
    }
  }, [mac, name, pingAddress, serverIp, serverToken, setServerIp, wakeAddress]);

  useEffect(() => {
    if (params.scan !== '1' || hasAutoScannedRef.current) {
      return;
    }

    hasAutoScannedRef.current = true;
    handleScanAndAutoFill();
  }, [handleScanAndAutoFill, params.scan]);

  const handleAddDevice = async () => {
    if (!validateFields()) {
      return;
    }

    try {
      setIsSubmitting(true);

      const devices = await deviceService.getDevices();
      const newDevice: Device = {
        id: Date.now().toString(),
        name: name.trim(),
        mac: normalizeMacAddress(mac),
        ip: pingAddress.trim(),
        wakeAddress: wakeAddress.trim() || suggestedWakeAddress || pingAddress.trim(),
        wakePort: sanitizeWakePort(wakePort, DEFAULT_WAKE_PORT),
        status: 'offline',
        type: 'wifi',
      };

      await deviceService.saveDevices([...devices, newDevice]);

      Alert.alert('Success', 'Device added successfully', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (error) {
      console.error('Error adding device:', error);
      Alert.alert('Error', 'Failed to add device');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 12}
      style={styles.container}
    >
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <ArrowLeft size={24} color="#7c3aed" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContainer,
          {
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Add New Device</Text>
          <Text style={styles.subtitle}>Save the device details once so waking and control work reliably.</Text>

          <View style={styles.scanCard}>
            <View style={styles.scanCopy}>
              <Text style={styles.scanTitle}>Scan Network and Auto Fill</Text>
              <Text style={styles.scanDescription}>
                If the WakeMATE companion is online, we&apos;ll look for it on your network, connect the app to that API host, and fill in the device details we can detect.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
              onPress={handleScanAndAutoFill}
              disabled={isScanning}
            >
              {isScanning ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Search size={18} color="#ffffff" />
                  <Text style={styles.scanButtonText}>Scan</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.label}>Device Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="My Computer"
              placeholderTextColor="#777777"
              autoCorrect={false}
              returnKeyType="next"
            />

            <Text style={styles.label}>MAC Address</Text>
            <TextInput
              style={styles.input}
              value={mac}
              onChangeText={setMac}
              placeholder="00:11:22:33:44:55"
              placeholderTextColor="#777777"
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
              placeholderTextColor="#777777"
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
              placeholderTextColor="#777777"
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
              placeholderTextColor="#777777"
              keyboardType="number-pad"
            />
            <Text style={styles.helperText}>Most devices use port 9, but some networks use 7 or 0.</Text>

            <TouchableOpacity
              style={[styles.addButton, isSubmitting && styles.disabledButton]}
              onPress={handleAddDevice}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Text style={styles.buttonText}>Adding...</Text>
              ) : (
                <>
                  <Plus size={20} color="#ffffff" />
                  <Text style={[styles.buttonText, styles.buttonTextWithIcon]}>Add Device</Text>
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
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#121212',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d1d1d',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 15,
    lineHeight: 22,
    color: '#9ca3af',
  },
  scanCard: {
    backgroundColor: '#201733',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  scanCopy: {
    marginBottom: 14,
  },
  scanTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  scanDescription: {
    marginTop: 6,
    color: '#d1c4f4',
    fontSize: 13,
    lineHeight: 19,
  },
  scanButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.7,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  formCard: {
    backgroundColor: '#1b1b1b',
    borderRadius: 18,
    padding: 18,
  },
  label: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#262626',
    color: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 12,
    fontSize: 16,
  },
  helperText: {
    color: '#a0a0a0',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  addButton: {
    backgroundColor: '#7c3aed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 28,
  },
  disabledButton: {
    backgroundColor: '#666666',
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

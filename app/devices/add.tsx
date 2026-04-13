import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
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
import { ArrowLeft, Plus, Search } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from '../../src/types/device';
import { useServer } from '../../src/context/ServerContext';
import deviceService from '../services/deviceService';
import {
  inferDevicePlatformFromMetadata,
  inferDevicePlatformFromName,
  normalizeDevicePlatform,
} from '../../src/utils/devicePlatform';
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
const MAC_KEYS = [
  'mac',
  'macaddress',
  'hwaddress',
  'physicaladdress',
  'ethernetmac',
  'wifimac',
  'primarymac',
  'primarymacaddress',
  'adaptermac',
  'networkadaptermac',
  'lanmac',
];
const WAKE_ADDRESS_KEYS = [
  'wakeaddress',
  'broadcast',
  'broadcastaddress',
  'wakebroadcast',
  'wolbroadcast',
  'wolbroadcastaddress',
];
const WAKE_PORT_KEYS = ['wakeport', 'wakeonlanport', 'wolport', 'wakeudpport', 'woludpport'];

type UnknownRecord = Record<string, unknown>;
type CompanionCandidate = {
  serverIp: string;
  deviceName: string;
  macAddress: string | null;
  wakeAddress: string | null;
  wakePort: number | null;
  apiPort: number;
  version: string | null;
  platform: Device['platform'];
};

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

const toCandidatePort = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
      return parsed;
    }
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

const findNumberByKeys = (input: unknown, keys: string[]): number | null => {
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
      const candidate = toCandidatePort(value);

      if (normalizedKeys.has(normalizeKey(key)) && candidate !== null) {
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

const collectRecords = (input: unknown): UnknownRecord[] => {
  const queue: unknown[] = [input];
  const visited = new Set<object>();
  const records: UnknownRecord[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!isRecord(current) || visited.has(current)) {
      continue;
    }

    visited.add(current);
    records.push(current);

    for (const value of Object.values(current)) {
      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return records;
};

const scoreCompanionRecord = (record: UnknownRecord, fallbackIp: string): number => {
  const ip = findValueByKeys(record, IP_KEYS, isValidIpAddress);
  const mac = findValueByKeys(record, MAC_KEYS, isValidMacAddress);
  const wakeAddress = findValueByKeys(record, WAKE_ADDRESS_KEYS, isValidIpAddress);
  const wakePort = findNumberByKeys(record, WAKE_PORT_KEYS);
  const name = findValueByKeys(record, NAME_KEYS);

  let score = 0;

  if (ip === fallbackIp) {
    score += 100;
  }
  if (mac) {
    score += 60;
  }
  if (ip) {
    score += 40;
  }
  if (wakeAddress) {
    score += 20;
  }
  if (wakePort !== null) {
    score += 10;
  }
  if (name) {
    score += 5;
  }

  return score;
};

const extractCompanionFields = (info: unknown, fallbackIp: string) => {
  const payload = isRecord(info) && 'data' in info ? (info as UnknownRecord).data : info;
  const bestRecord = collectRecords(payload)
    .sort((left, right) => scoreCompanionRecord(right, fallbackIp) - scoreCompanionRecord(left, fallbackIp))[0];
  const preferredSource = bestRecord ?? payload;

  const pingIp =
    findValueByKeys(preferredSource, IP_KEYS, isValidIpAddress) ??
    findValueByKeys(payload, IP_KEYS, isValidIpAddress) ??
    findMatchingValue(preferredSource, isValidIpAddress) ??
    findMatchingValue(payload, isValidIpAddress) ??
    fallbackIp;

  const rawMac =
    findValueByKeys(preferredSource, MAC_KEYS, isValidMacAddress) ??
    findValueByKeys(payload, MAC_KEYS, isValidMacAddress) ??
    findMatchingValue(preferredSource, isValidMacAddress) ??
    findMatchingValue(payload, isValidMacAddress) ??
    '';

  const wakeAddress =
    findValueByKeys(preferredSource, WAKE_ADDRESS_KEYS, isValidIpAddress) ??
    findValueByKeys(payload, WAKE_ADDRESS_KEYS, isValidIpAddress) ??
    (getSuggestedWakeAddress(pingIp) || pingIp);

  const wakePort =
    findNumberByKeys(preferredSource, WAKE_PORT_KEYS) ??
    findNumberByKeys(payload, WAKE_PORT_KEYS) ??
    DEFAULT_WAKE_PORT;

  const name =
    findValueByKeys(preferredSource, NAME_KEYS) ??
    findValueByKeys(payload, NAME_KEYS) ??
    `WakeMATE ${pingIp}`;

  return {
    name,
    pingIp,
    mac: rawMac ? normalizeMacAddress(rawMac) : '',
    wakeAddress,
    wakePort,
    platform: inferDevicePlatformFromMetadata(preferredSource, name),
  };
};

const isUnauthorizedCompanionInfoError = (error: unknown): boolean =>
  (isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403)) ||
  (error instanceof Error && error.message.includes('Pairing token was rejected by the companion'));

const buildScannedDevice = (fields: {
  name: string;
  pingIp: string;
  mac: string;
  wakeAddress: string;
  wakePort?: number;
  platform?: Device['platform'];
}): Device | null => {
  const trimmedName = fields.name.trim();
  const trimmedPingIp = fields.pingIp.trim();
  const normalizedMac = normalizeMacAddress(fields.mac);
  const resolvedWakeAddress =
    fields.wakeAddress.trim() || getSuggestedWakeAddress(trimmedPingIp) || trimmedPingIp;

  if (!trimmedName || !trimmedPingIp || !normalizedMac) {
    return null;
  }

  if (!isValidIpAddress(trimmedPingIp) || !isValidMacAddress(normalizedMac)) {
    return null;
  }

  return {
    id: Date.now().toString(),
    name: trimmedName,
    mac: normalizedMac,
    ip: trimmedPingIp,
    wakeAddress: resolvedWakeAddress,
    wakePort: sanitizeWakePort(fields.wakePort, DEFAULT_WAKE_PORT),
    status: 'offline',
    type: 'wifi',
    platform: normalizeDevicePlatform(fields.platform ?? trimmedName),
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
  const [discoveredCompanions, setDiscoveredCompanions] = useState<CompanionCandidate[]>([]);
  const [companionPickerVisible, setCompanionPickerVisible] = useState(false);
  const hasAutoScannedRef = useRef(false);

  const suggestedWakeAddress = getSuggestedWakeAddress(pingAddress);
  const shouldAttemptAutoSave = params.scan === '1';

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

  const applyDiscoveredCompanion = useCallback(async (discoveredCompanion: CompanionCandidate) => {
    const savedCompanionIp = discoveredCompanion.serverIp.trim();
    const hadDifferentServerIp = serverIp.trim() !== savedCompanionIp;
    await deviceService.setServerConnection(savedCompanionIp, discoveredCompanion.apiPort);
    setServerIp(savedCompanionIp);

    let healthFields = {
      name: discoveredCompanion.deviceName || `WakeMATE ${savedCompanionIp}`,
      pingIp: savedCompanionIp,
      mac: discoveredCompanion.macAddress || '',
      wakeAddress: discoveredCompanion.wakeAddress || getSuggestedWakeAddress(savedCompanionIp) || savedCompanionIp,
      wakePort: discoveredCompanion.wakePort ?? DEFAULT_WAKE_PORT,
      platform: normalizeDevicePlatform(discoveredCompanion.platform ?? discoveredCompanion.deviceName),
    };

    const [healthResult, infoResult] = await Promise.allSettled([
      deviceService.getCompanionHealth(savedCompanionIp),
      deviceService.getCompanionInfo(savedCompanionIp),
    ]);

    if (healthResult.status === 'fulfilled') {
      const parsedHealthFields = extractCompanionFields(healthResult.value, savedCompanionIp);
      healthFields = {
        ...healthFields,
        ...parsedHealthFields,
        mac: parsedHealthFields.mac || healthFields.mac,
      };
    }

    let companionFields = {
      ...healthFields,
    };
    let protectedInfoNotice: string | null = null;

    if (infoResult.status === 'fulfilled') {
      companionFields = extractCompanionFields(infoResult.value, savedCompanionIp);
    } else if (isUnauthorizedCompanionInfoError(infoResult.reason)) {
      protectedInfoNotice = serverToken.trim()
        ? 'The saved pairing token was rejected by the companion, so only the network address could be filled automatically.'
        : 'This companion requires a pairing token to read device details, so only the network address could be filled automatically.';
    } else if (healthResult.status === 'rejected') {
      throw infoResult.reason;
    }

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

    const currentWakePort = sanitizeWakePort(wakePort, DEFAULT_WAKE_PORT);
    if (
      companionFields.wakePort !== null &&
      companionFields.wakePort !== undefined &&
      (wakePort.trim() === '' || currentWakePort === DEFAULT_WAKE_PORT) &&
      companionFields.wakePort !== currentWakePort
    ) {
      setWakePort(String(companionFields.wakePort));
      filledFields.push('wake port');
    }

    const connectionNotes: string[] = [];
    if (hadDifferentServerIp) {
      connectionNotes.push(`Companion API connected at ${savedCompanionIp}.`);
    } else {
      connectionNotes.push(`Companion API confirmed at ${savedCompanionIp}.`);
    }

    if (protectedInfoNotice) {
      connectionNotes.push(protectedInfoNotice);
    } else if (!serverToken.trim()) {
      connectionNotes.push('Remote commands will work as soon as a pairing token is available.');
    }

    const resolvedPlatform = normalizeDevicePlatform(companionFields.platform ?? healthFields.platform);

    const scannedDevice = buildScannedDevice({
      name: name.trim() || companionFields.name,
      pingIp: pingAddress.trim() || companionFields.pingIp,
      mac: mac.trim() || companionFields.mac,
      wakeAddress: wakeAddress.trim() || companionFields.wakeAddress,
      wakePort: companionFields.wakePort,
      platform: resolvedPlatform,
    });

    if (shouldAttemptAutoSave && scannedDevice) {
      const existingDevices = await deviceService.getDevices();
      const existingDevice = existingDevices.find(
        (device) => device.mac === scannedDevice.mac || device.ip === scannedDevice.ip
      );

      const savedDevice = existingDevice
        ? {
            ...existingDevice,
            ...scannedDevice,
            id: existingDevice.id,
          }
        : scannedDevice;

      const nextDevices = existingDevice
        ? existingDevices.map((device) => (device.id === existingDevice.id ? savedDevice : device))
        : [...existingDevices, savedDevice];

      await deviceService.saveDevices(nextDevices);

      Alert.alert(
        existingDevice ? 'Device Updated' : 'Device Saved',
        `${connectionNotes.join('\n')}\n\n${savedDevice.name} is now in your saved devices.`,
        [{ text: 'OK', onPress: () => router.replace('/devices') }]
      );
      return;
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

    const autoSaveNote = shouldAttemptAutoSave
      ? 'The device was not saved yet because WakeMATE still needs the missing fields above.'
      : null;

    Alert.alert(
      'Auto Fill Complete',
      `${connectionNotes.join('\n')}\n\n${summary}${autoSaveNote ? `\n\n${autoSaveNote}` : ''}`
    );
  }, [mac, name, pingAddress, router, serverIp, serverToken, setServerIp, shouldAttemptAutoSave, wakeAddress, wakePort]);

  const closeCompanionPicker = useCallback(() => {
    setCompanionPickerVisible(false);
    setDiscoveredCompanions([]);
  }, []);

  const handleCompanionSelected = useCallback(async (companion: CompanionCandidate) => {
    closeCompanionPicker();

    try {
      setIsScanning(true);
      await applyDiscoveredCompanion(companion);
    } catch (error) {
      console.error('Error applying selected companion:', error);
      const message = error instanceof Error ? error.message : 'Unable to use the selected computer right now.';
      Alert.alert('Selection Failed', message);
    } finally {
      setIsScanning(false);
    }
  }, [applyDiscoveredCompanion, closeCompanionPicker]);

  const handleScanAndAutoFill = useCallback(async () => {
    try {
      setIsScanning(true);

      const companions = await deviceService.discoverCompanions();
      if (companions.length === 0) {
        Alert.alert(
          'No WakeMATE Companion Found',
          'Make sure the desktop companion is running and that your phone and computer are on the same Wi-Fi network.'
        );
        return;
      }

      if (companions.length === 1) {
        await applyDiscoveredCompanion(companions[0]);
        return;
      }

      setDiscoveredCompanions(companions);
      setCompanionPickerVisible(true);
    } catch (error) {
      console.error('Error scanning for companion info:', error);
      const message = error instanceof Error ? error.message : 'Unable to scan the network right now.';
      Alert.alert('Scan Failed', message);
    } finally {
      setIsScanning(false);
    }
  }, [applyDiscoveredCompanion]);

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
        platform: inferDevicePlatformFromName(name),
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
      <View style={styles.glowOrbOne} />
      <View style={styles.glowOrbTwo} />

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
          <ArrowLeft size={24} color="#0891b2" />
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
          <Text style={styles.eyebrow}>WakeMATE Setup</Text>
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

      <Modal
        visible={companionPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeCompanionPicker}
      >
        <View style={styles.selectionOverlay}>
          <View style={styles.selectionSheet}>
            <Text style={styles.selectionTitle}>Choose a Computer</Text>
            <Text style={styles.selectionDescription}>
              More than one WakeMATE companion is online. Pick the computer you want to use for auto fill.
            </Text>

            <ScrollView style={styles.selectionList} contentContainerStyle={styles.selectionListContent}>
              {discoveredCompanions.map((companion) => (
                <TouchableOpacity
                  key={companion.serverIp}
                  style={styles.selectionItem}
                  onPress={() => void handleCompanionSelected(companion)}
                >
                  <Text style={styles.selectionItemTitle}>{companion.deviceName}</Text>
                  <Text style={styles.selectionItemMeta}>{companion.serverIp}:{companion.apiPort}</Text>
                  {companion.version ? (
                    <Text style={styles.selectionItemSubtext}>WakeMATE {companion.version}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.selectionCancelButton} onPress={closeCompanionPicker}>
              <Text style={styles.selectionCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05090c',
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
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: 'transparent',
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
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
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
    marginBottom: 18,
    fontSize: 15,
    lineHeight: 22,
    color: '#8aa1ab',
  },
  scanCard: {
    backgroundColor: '#0b1217',
    borderRadius: 24,
    padding: 18,
    marginBottom: 18,
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
  scanCopy: {
    marginBottom: 14,
  },
  scanTitle: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
  },
  scanDescription: {
    marginTop: 6,
    color: '#8aa1ab',
    fontSize: 14,
    lineHeight: 21,
  },
  scanButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#0891b2',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scanButtonDisabled: {
    opacity: 0.72,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
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
  addButton: {
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
  selectionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 7, 10, 0.74)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  selectionSheet: {
    backgroundColor: '#0b1217',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#16313a',
    padding: 20,
    maxHeight: '75%',
  },
  selectionTitle: {
    color: '#f8fbff',
    fontSize: 22,
    fontWeight: '800',
  },
  selectionDescription: {
    marginTop: 8,
    color: '#8aa1ab',
    fontSize: 14,
    lineHeight: 21,
  },
  selectionList: {
    marginTop: 18,
  },
  selectionListContent: {
    gap: 12,
  },
  selectionItem: {
    backgroundColor: '#0f171c',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#17323b',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectionItemTitle: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '800',
  },
  selectionItemMeta: {
    marginTop: 6,
    color: '#67e8f9',
    fontSize: 13,
    fontWeight: '600',
  },
  selectionItemSubtext: {
    marginTop: 4,
    color: '#6f8791',
    fontSize: 12,
  },
  selectionCancelButton: {
    marginTop: 18,
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23424c',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f171c',
  },
  selectionCancelText: {
    color: '#d8e5ec',
    fontSize: 15,
    fontWeight: '700',
  },
});

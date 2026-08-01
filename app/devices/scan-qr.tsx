import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import deviceService from '../services/deviceService';
import { buildScannedDevice } from '../../src/utils/deviceMetadata';
import { getThisPhoneDisplayName } from '../../src/utils/deviceIdentity';
import { parseStructuredPairingQr } from '../../src/utils/pairingQr';

export default function ScanDeviceQrScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isProcessing, setIsProcessing] = useState(false);
  const scanLockedRef = useRef(false);

  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted) {
      requestCameraPermission();
    }
  }, [cameraPermission, requestCameraPermission]);

  const handleQrScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanLockedRef.current) {
        return;
      }

      scanLockedRef.current = true;

      const parsedQr = parseStructuredPairingQr(data);
      if (!parsedQr.ok) {
        const invalidTls = parsedQr.error.code === 'invalid_tls_metadata';
        Alert.alert(
          invalidTls ? 'Invalid Secure Pairing Code' : 'Unsupported Pairing Code',
          parsedQr.error.message,
          [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
        );
        return;
      }

      // Both supported QR contracts are normalized before anything can be
      // discovered or persisted, so parsing and device extraction cannot
      // disagree about which identity or transport fields were scanned.
      const { connection: pairingQr, deviceMac, deviceName: qrDeviceName } =
        parsedQr.value;
      const pairingToken = pairingQr.token;

      let resolvedApiPort = pairingQr.apiPort;
      const resolvedTlsPort = pairingQr.tlsPort;
      const resolvedTlsFingerprint = pairingQr.tlsFingerprint;
      let fields: Parameters<typeof buildScannedDevice>[0] = {
        name: qrDeviceName,
        pingIp: pairingQr.ip ?? '',
        mac: deviceMac ?? '',
        wakeAddress: '',
      };
      let scannedDevice = buildScannedDevice(fields);

      if (!scannedDevice && pairingToken) {
        // The companion deliberately omits IP/MAC when the OS cannot identify
        // its primary adapter. Recover those fields through LAN discovery so
        // this scan remains the only pairing step.
        setIsProcessing(true);
        try {
          const discoveries = await deviceService.discoverCompanions();
          const matchingIp = pairingQr.ip
            ? discoveries.find((entry) => entry.serverIp === pairingQr.ip)
            : null;
          const matchingMac = fields.mac
            ? discoveries.find((entry) => entry.macAddress === fields.mac)
            : null;
          const matchingNames = qrDeviceName
            ? discoveries.filter(
                (entry) =>
                  entry.deviceName.localeCompare(qrDeviceName, undefined, {
                    sensitivity: 'base',
                  }) === 0
              )
            : [];
          const discoveredCompanion =
            matchingIp ??
            (!pairingQr.ip ? matchingMac : null) ??
            (!pairingQr.ip && !matchingMac && matchingNames.length === 1
              ? matchingNames[0]
              : null);

          if (discoveredCompanion) {
            if (
              fields.mac &&
              discoveredCompanion.macAddress &&
              discoveredCompanion.macAddress !== fields.mac
            ) {
              Alert.alert(
                'Pairing Code Does Not Match',
                'The computer found on the network has a different MAC address from the scanned QR code. Regenerate the code on the computer you want to add.',
                [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
              );
              return;
            }

            if (
              pairingQr.tlsFingerprint &&
              discoveredCompanion.tlsFingerprint &&
              discoveredCompanion.tlsFingerprint !== pairingQr.tlsFingerprint
            ) {
              Alert.alert(
                'Secure Pairing Mismatch',
                'The computer found on the network advertises a different certificate from the scanned QR code. Regenerate the code before pairing.',
                [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
              );
              return;
            }

            fields = {
              name: qrDeviceName || discoveredCompanion.deviceName,
              pingIp: pairingQr.ip ?? discoveredCompanion.serverIp,
              mac: fields.mac || discoveredCompanion.macAddress || '',
              wakeAddress:
                discoveredCompanion.wakeAddress ||
                fields.wakeAddress ||
                discoveredCompanion.serverIp,
              wakePort: discoveredCompanion.wakePort ?? fields.wakePort,
              platform: discoveredCompanion.platform ?? fields.platform,
            };
            scannedDevice = buildScannedDevice(fields);
            resolvedApiPort =
              resolvedApiPort ?? discoveredCompanion.apiPort;
          }
        } catch (error) {
          console.error('Error discovering companion during QR pairing:', error);
        } finally {
          setIsProcessing(false);
        }
      }

      if (!scannedDevice) {
        Alert.alert(
          'Incomplete Device Info',
          'WakeMATE could not identify both the computer IP and MAC address. Make sure the phone and computer are on the same network, regenerate the QR code from the companion, and scan it again.',
          [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
        );
        return;
      }

      try {
        setIsProcessing(true);

        const existingDevices = await deviceService.getDevices();
        const existingDevice = existingDevices.find(
          (device) => device.mac === scannedDevice.mac || device.ip === scannedDevice.ip
        );

        const savedDevice = existingDevice
          ? { ...existingDevice, ...scannedDevice, id: existingDevice.id }
          : scannedDevice;

        const nextDevices = existingDevice
          ? existingDevices.map((device) => (device.id === existingDevice.id ? savedDevice : device))
          : [...existingDevices, savedDevice];

        await deviceService.saveDevices(nextDevices);

        let pairingSummary = '';
        if (pairingToken) {
          // Credentials are stored against this computer, so pairing a second
          // machine no longer overwrites the first.
          const result = await deviceService.pairDeviceFromQr(savedDevice.id, {
            ip: savedDevice.ip,
            token: pairingToken,
            tlsFingerprint: resolvedTlsFingerprint,
            apiPort: resolvedApiPort,
            tlsPort: resolvedTlsPort,
            phoneName: getThisPhoneDisplayName(),
          });

          if (result.status === 'approved') {
            pairingSummary = ' Remote controls are enabled.';
          } else if (result.status === 'unsupported') {
            pairingSummary = ' Pairing was requested. This older Companion cannot confirm approval in the app, so approve the prompt on the computer before using remote controls.';
          } else if (result.status === 'denied') {
            pairingSummary = ' The pairing request was denied on the computer; remote controls stay off.';
          } else if (result.status === 'timeout') {
            pairingSummary = ' Pairing timed out. Show a new pairing QR code on the computer and scan it again.';
          } else {
            // Keep recovery in this one-scan flow and say what failed.
            pairingSummary = result.detail
              ? ` Pairing did not finish: ${result.detail}`
              : ' Pairing did not finish. Make sure the WakeMATE companion is running, then try the scan again.';
          }
        }

        Alert.alert(
          existingDevice ? 'Device Updated' : 'Device Saved',
          `${savedDevice.name} is now in your saved devices.${pairingSummary}`,
          [{ text: 'OK', onPress: () => router.replace('/devices') }]
        );
      } catch (error) {
        console.error('Error saving device from QR scan:', error);
        Alert.alert(
          'Save Failed',
          'The device could not be saved right now. Please try again.',
          [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [router]
  );

  const renderCameraBody = () => {
    if (!cameraPermission) {
      return (
        <View style={styles.centeredMessage}>
          <ActivityIndicator size="large" color="#0891b2" />
        </View>
      );
    }

    if (!cameraPermission.granted) {
      return (
        <View style={styles.centeredMessage}>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionText}>
            {cameraPermission.canAskAgain
              ? 'Allow camera access to scan a WakeMATE device QR code.'
              : 'Camera access is disabled for WakeMATE. Enable it in your device settings to scan a device QR code.'}
          </Text>
          {cameraPermission.canAskAgain ? (
            <TouchableOpacity style={styles.primaryButton} onPress={() => requestCameraPermission()}>
              <Text style={styles.primaryButtonText}>Allow Camera Access</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    return (
      <View style={styles.cameraShell}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={handleQrScanned}
        />
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
        </View>
        {isProcessing ? (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={styles.processingText}>Setting up computer... If a pairing dialog appears there, click Yes.</Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <ArrowLeft size={22} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Scan Device QR Code</Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderCameraBody()}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.description}>
          Point the camera at the QR code shown by the WakeMATE companion app to add that device instantly.
        </Text>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
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
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f171c',
    borderWidth: 1,
    borderColor: '#17323b',
  },
  headerSpacer: {
    width: 42,
  },
  title: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
  },
  cameraShell: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: '72%',
    aspectRatio: 1,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.92)',
    backgroundColor: 'transparent',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 7, 10, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  centeredMessage: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 28,
    backgroundColor: '#0b1217',
    borderWidth: 1,
    borderColor: '#17323b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  permissionTitle: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  permissionText: {
    color: '#8aa1ab',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#0891b2',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 12,
  },
  description: {
    color: '#8aa1ab',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  cancelButton: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23424c',
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f171c',
  },
  cancelButtonText: {
    color: '#d8e5ec',
    fontSize: 15,
    fontWeight: '700',
  },
});

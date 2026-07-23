import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import deviceService from '../services/deviceService';
import { useServer } from '../../src/context/ServerContext';
import { buildScannedDevice, extractCompanionFields } from '../../src/utils/deviceMetadata';
import { getThisPhoneDisplayName } from '../../src/utils/deviceIdentity';
import { parsePairingQrConnection } from '../../src/utils/pairingQr';

export default function ScanDeviceQrScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshFromStorage } = useServer();
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        Alert.alert(
          'Unsupported QR Code',
          "This doesn't look like a WakeMATE device QR code. Make sure you're scanning the code shown by the companion app.",
          [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
        );
        return;
      }

      // Pairing QR v2 carries the token and transport metadata, so one scan
      // can save the device and establish a pinned HTTPS connection.
      const pairingQr = parsePairingQrConnection(data);
      const pairingToken = pairingQr.token;
      if (!pairingQr.hasValidTlsMetadata) {
        Alert.alert(
          'Invalid Secure Pairing Code',
          'This QR code advertises secure transport but is missing a valid TLS port or certificate fingerprint. Regenerate it from the WakeMATE companion.',
          [{ text: 'Try Again', onPress: () => { scanLockedRef.current = false; } }]
        );
        return;
      }
      const connectionPort =
        pairingQr.tlsFingerprint && pairingQr.tlsPort
          ? pairingQr.tlsPort
          : pairingQr.apiPort;

      const fields = extractCompanionFields(parsed, '');
      const scannedDevice = buildScannedDevice(fields);

      if (!scannedDevice) {
        if (pairingToken) {
          if (pairingQr.ip) {
            await deviceService.setServerConnection(pairingQr.ip, connectionPort);
            await deviceService.setServerTlsFingerprint(pairingQr.tlsFingerprint);
          }
          await deviceService.setServerToken(pairingToken);
          await refreshFromStorage();
          Alert.alert(
            'Pairing Token Saved',
            'This QR code had a pairing token but no complete device details. Open Settings to confirm the companion IP and finish pairing.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
          return;
        }

        Alert.alert(
          'Incomplete Device Info',
          "This QR code is missing required details (device name, MAC address, or IP address). Ask the companion app to regenerate its QR code.",
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
          try {
            await deviceService.setServerConnection(savedDevice.ip, connectionPort);
            await deviceService.setServerTlsFingerprint(pairingQr.tlsFingerprint);
            await deviceService.setServerToken(pairingToken);

            // Protocol v3: swap the QR token for a per-device token so this
            // phone can be revoked individually from the companion tray.
            // Older companions fall back to the shared-token activation.
            const enrollment = await deviceService.enrollDevice(
              savedDevice.ip,
              getThisPhoneDisplayName()
            );

            let approval: 'approved' | 'denied' | 'timeout' | 'unsupported';
            if (enrollment) {
              approval = await deviceService.waitForPairingApproval(savedDevice.ip, {
                timeoutMs: 30000,
                deviceId: enrollment.deviceId,
              });
              if (approval === 'approved') {
                await deviceService.setServerToken(enrollment.deviceToken);
              }
            } else {
              await deviceService.activatePairedControls(savedDevice.ip, pairingToken);
              approval = await deviceService.waitForPairingApproval(savedDevice.ip, { timeoutMs: 30000 });
            }

            if (approval === 'approved' || approval === 'unsupported') {
              pairingSummary = ' Remote controls are enabled.';
            } else if (approval === 'denied') {
              pairingSummary = ' The pairing request was denied on the computer; remote controls stay off.';
            } else {
              pairingSummary = ' Approve the pairing dialog on the computer to enable remote controls.';
            }
          } catch (pairingError) {
            console.error('Error pairing from QR scan:', pairingError);
            pairingSummary = ' The pairing token was saved, but pairing could not be completed yet — finish it in Settings.';
          }

          // Everything above wrote through deviceService directly; sync the
          // app-wide connection state so Settings shows the scanned IP and
          // token without any manual re-entry.
          await refreshFromStorage();
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
    [refreshFromStorage, router]
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
            <Text style={styles.processingText}>Saving device... If a pairing dialog appears on the computer, click Yes there.</Text>
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

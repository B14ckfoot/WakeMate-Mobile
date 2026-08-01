import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, XCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '../src/context/ServerContext';
import {
  completeDevicePairing,
  parsePairingPayloadFromLink,
  PairingFlowError,
  savePartialPairing,
} from '../src/utils/pairingFlow';
import { pairingLinkFromParams } from '../src/utils/pairingQr';

/**
 * Universal Link / custom-scheme entry point for `/pair`. Reached from the
 * native iPhone Camera app (or any other opener) tapping the companion's
 * pairing link -- see WakeMATE-Companion/src/tray.rs for the producer and
 * app.json's `ios.associatedDomains` / `scheme` for how iOS routes here.
 * Mirrors app/devices/scan-qr.tsx's pairing sequence so a tapped link and an
 * in-app scan behave identically.
 */
export default function PairScreen() {
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshFromStorage } = useServer();
  const [phase, setPhase] = useState<'working' | 'success' | 'partial' | 'error'>('working');
  const [statusText, setStatusText] = useState('Reading pairing link…');
  const [detailText, setDetailText] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const run = async () => {
      const link = pairingLinkFromParams(params);
      if (!link) {
        setPhase('error');
        setStatusText('Invalid Pairing Link');
        setDetailText(
          'This link is missing its pairing token, or has expired. Open the WakeMATE companion tray and generate a new QR code.'
        );
        return;
      }

      let parsedPayload: ReturnType<typeof parsePairingPayloadFromLink>;
      try {
        parsedPayload = parsePairingPayloadFromLink(link);
      } catch (error) {
        setPhase('error');
        setStatusText('Invalid Pairing Link');
        setDetailText(
          error instanceof PairingFlowError
            ? error.message
            : 'This pairing link could not be read. Generate a new QR code from the companion.'
        );
        return;
      }

      const { connection, scannedDevice } = parsedPayload;

      if (!scannedDevice) {
        setStatusText('Saving pairing token…');
        try {
          await savePartialPairing(connection);
          await refreshFromStorage();
          setPhase('partial');
          setStatusText('Pairing Token Saved');
          setDetailText(
            'This link had a pairing token but no complete device details. Open Settings to confirm the companion IP and finish pairing.'
          );
        } catch (error) {
          setPhase('error');
          setStatusText('Could Not Save Pairing Token');
          setDetailText(
            error instanceof PairingFlowError
              ? error.message
              : 'The pairing token could not be saved. Try scanning the QR code again.'
          );
        }
        return;
      }

      setStatusText(`Connecting to ${scannedDevice.name}…`);
      try {
        const outcome = await completeDevicePairing(scannedDevice, connection);

        if (connection.token) {
          await refreshFromStorage();
        }

        if (outcome.approval === 'denied') {
          setPhase('error');
          setStatusText('Pairing Denied');
          setDetailText('The pairing request was denied on the computer. Try again and approve the prompt.');
          return;
        }

        setPhase('success');
        setStatusText(outcome.existingDevice ? 'Device Updated' : 'Device Paired');
        setDetailText(
          `${outcome.device.name} is now in your saved devices.${
            outcome.approvalSummary ? ` ${outcome.approvalSummary}` : ''
          }`
        );
      } catch (error) {
        setPhase('error');
        setStatusText('Pairing Failed');
        setDetailText(
          error instanceof Error
            ? error.message
            : 'The device could not be saved right now. Please try again.'
        );
      }
    };

    void run();
  }, [params, refreshFromStorage]);

  const goToDevices = () => router.replace('/devices');
  const goToSettings = () => router.replace('/settings');

  return (
    <View style={styles.container}>
      <View style={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        {phase === 'working' ? (
          <ActivityIndicator size="large" color="#0891b2" />
        ) : phase === 'error' ? (
          <XCircle size={56} color="#f87171" />
        ) : (
          <CheckCircle2 size={56} color="#4ade80" />
        )}

        <Text style={styles.title}>{statusText}</Text>
        {detailText ? <Text style={styles.detail}>{detailText}</Text> : null}

        {phase !== 'working' ? (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={phase === 'partial' ? goToSettings : goToDevices}
          >
            <Text style={styles.primaryButtonText}>
              {phase === 'partial' ? 'Open Settings' : 'Go to Devices'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05090c',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  detail: {
    color: '#8aa1ab',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 12,
    backgroundColor: '#0891b2',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});

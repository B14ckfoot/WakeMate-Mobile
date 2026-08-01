import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, MonitorDown, QrCode, ShieldCheck } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const COMPANION_DOWNLOAD_URL = 'https://wakematemobile.com/#companion';
export const COMPANION_SETUP_DISMISSED_KEY = 'wakemate.onboarding.companionSetup.v1';

const DISMISSED_VALUE = 'dismissed';
const SAVED_DEVICES_KEY = 'devices';

const hasSavedDevices = (rawValue: string | null): boolean => {
  if (!rawValue) {
    return false;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
};

export default function CompanionSetupPrompt() {
  const insets = useSafeAreaInsets();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadPromptState = async () => {
      try {
        const [storedValue, savedDevices] = await Promise.all([
          AsyncStorage.getItem(COMPANION_SETUP_DISMISSED_KEY),
          AsyncStorage.getItem(SAVED_DEVICES_KEY),
        ]);
        if (
          isMounted &&
          storedValue !== DISMISSED_VALUE &&
          !hasSavedDevices(savedDevices)
        ) {
          setIsVisible(true);
        }
      } catch (error) {
        // A storage failure should not block the app with a prompt whose
        // dismissal cannot be remembered.
        console.warn('Could not load the Companion setup prompt state:', error);
      }
    };

    void loadPromptState();

    return () => {
      isMounted = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setIsVisible(false);

    void AsyncStorage.setItem(COMPANION_SETUP_DISMISSED_KEY, DISMISSED_VALUE).catch((error) => {
      console.warn('Could not save the Companion setup prompt state:', error);
    });
  }, []);

  const openDownloadPage = useCallback(async () => {
    try {
      await WebBrowser.openBrowserAsync(COMPANION_DOWNLOAD_URL);
      dismiss();
    } catch (error) {
      console.warn('Could not open the WakeMATE Companion download page:', error);
      Alert.alert(
        'Couldn\'t Open the Website',
        'Visit wakematemobile.com from your computer to download WakeMATE Companion.'
      );
    }
  }, [dismiss]);

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
      testID="companion-setup-prompt"
    >
      <ScrollView
        contentContainerStyle={[
          styles.overlay,
          {
            paddingTop: Math.max(insets.top, 20),
            paddingBottom: Math.max(insets.bottom, 20),
          },
        ]}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconWrap} accessible={false}>
            <View style={styles.iconHalo} />
            <MonitorDown size={34} color="#67e8f9" strokeWidth={1.9} />
          </View>

          <Text style={styles.eyebrow}>ONE-TIME SETUP</Text>
          <Text style={styles.title} accessibilityRole="header">
            Connect your Windows PC
          </Text>
          <Text style={styles.intro}>
            Install the free WakeMATE Companion to discover your PC and enable secure remote controls.
          </Text>

          <View style={styles.steps}>
            <View style={styles.stepRow}>
              <View style={styles.stepIcon} accessible={false}>
                <MonitorDown size={20} color="#67e8f9" />
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>Download on your PC</Text>
                <Text style={styles.stepBody}>
                  Visit wakematemobile.com from the Windows PC you want to control and install the Companion.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.stepRow}>
              <View style={styles.stepIcon} accessible={false}>
                <QrCode size={20} color="#67e8f9" />
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.stepTitle}>Scan the tray QR code</Text>
                <Text style={styles.stepBody}>
                  Open Companion from the Windows system tray, choose View Pairing QR Code, then scan it here in WakeMATE.
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.localNote}>
            <ShieldCheck size={18} color="#22d3ee" accessible={false} />
            <Text style={styles.localNoteText}>
              The website is only for the download. Pairing stays directly between this app and your computer.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => { void openDownloadPage(); }}
            accessibilityRole="link"
            accessibilityLabel="View the WakeMATE Companion download page"
            accessibilityHint="Opens wakematemobile.com in a browser"
            testID="view-companion-download"
          >
            <Text style={styles.primaryButtonText}>View Download Page</Text>
            <ExternalLink size={18} color="#ffffff" accessible={false} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.laterButton}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Maybe later"
            accessibilityHint="Closes this setup reminder"
            testID="dismiss-companion-setup"
          >
            <Text style={styles.laterButtonText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(1, 5, 8, 0.88)',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#1c3b45',
    backgroundColor: '#0b1217',
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 18,
    shadowColor: '#22d3ee',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: {
      width: 0,
      height: 14,
    },
    elevation: 16,
  },
  iconWrap: {
    width: 66,
    height: 66,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: '#0e1d24',
    borderWidth: 1,
    borderColor: '#1b424e',
    marginBottom: 18,
  },
  iconHalo: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(34, 211, 238, 0.09)',
  },
  eyebrow: {
    color: '#67e8f9',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginBottom: 7,
  },
  title: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    textAlign: 'center',
  },
  intro: {
    color: '#9bb0b9',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  steps: {
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 18,
    backgroundColor: '#0e1d24',
    borderWidth: 1,
    borderColor: '#17323b',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 15,
  },
  stepIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 145, 178, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.18)',
    marginRight: 12,
  },
  stepCopy: {
    flex: 1,
  },
  stepTitle: {
    color: '#eefcff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  stepBody: {
    color: '#8aa1ab',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1a333c',
    marginLeft: 50,
  },
  localNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  localNoteText: {
    flex: 1,
    color: '#78909a',
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 9,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 15,
    backgroundColor: '#0891b2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 22,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  laterButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginTop: 7,
  },
  laterButtonText: {
    color: '#9bb0b9',
    fontSize: 15,
    fontWeight: '700',
  },
});

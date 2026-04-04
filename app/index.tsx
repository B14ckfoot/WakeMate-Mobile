import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Monitor } from 'lucide-react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.heroCard}>
          <Monitor size={64} color="#7c3aed" style={styles.icon} />
          <Text style={styles.title}>Welcome to WakeMATE</Text>
          <Text style={styles.subtitle}>Manage and control your devices remotely without fighting the interface.</Text>
        </View>

        <Link href="/devices" asChild>
          <TouchableOpacity style={styles.button}>
            <Monitor size={22} color="#ffffff" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>Manage Devices</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  heroCard: {
    backgroundColor: '#1b1b1b',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    marginBottom: 20,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#a0a0a0',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#7c3aed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
  },
  buttonIcon: {
    marginRight: 10,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});

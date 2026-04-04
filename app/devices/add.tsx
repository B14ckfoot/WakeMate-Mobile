import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
  Alert
} from 'react-native';
import { ArrowLeft, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Device } from '../../src/types/device';
import deviceService from '../services/deviceService';

export default function AddDeviceScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateFields = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a device name');
      return false;
    }
    if (!ip.trim()) {
      Alert.alert('Error', 'Please enter the device IP address');
      return false;
    }
    // Simple IP validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip.trim())) {
      Alert.alert('Error', 'Please enter a valid IP address (e.g., 192.168.1.100)');
      return false;
    }
    return true;
  };

  const handleAddDevice = async () => {
    if (!validateFields()) return;

    try {
      setIsSubmitting(true);
      
      // Get existing devices
      const devices = await deviceService.getDevices();
      
      // Create new device
      const newDevice: Device = {
        id: Date.now().toString(),
        name: name.trim(),
        mac: mac.trim(),
        ip: ip.trim(),
        status: 'offline',
        type: 'wifi',
      };
      
      // Save updated devices list
      const updatedDevices = [...devices, newDevice];
      await deviceService.saveDevices(updatedDevices);
      
      setIsSubmitting(false);
      Alert.alert('Success', 'Device added successfully', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error adding device:', error);
      setIsSubmitting(false);
      Alert.alert('Error', 'Failed to add device');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color="#7c3aed" />
        </TouchableOpacity>
        
        <Text style={styles.title}>Add New Device</Text>
        
        <View style={styles.formContainer}>
          <Text style={styles.label}>Device Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="My Computer"
            placeholderTextColor="#777777"
          />
          
          <Text style={styles.label}>MAC Address (Optional)</Text>
          <TextInput
            style={styles.input}
            value={mac}
            onChangeText={setMac}
            placeholder="00:11:22:33:44:55"
            placeholderTextColor="#777777"
          />
          
          <Text style={styles.label}>IP Address</Text>
          <TextInput
            style={styles.input}
            value={ip}
            onChangeText={setIp}
            placeholder="192.168.1.100"
            placeholderTextColor="#777777"
            keyboardType="decimal-pad"
          />
          
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
                <Text style={styles.buttonText}>Add Device</Text>
              </>
            )}
          </TouchableOpacity>
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
  scrollContainer: {
    flexGrow: 1,
    padding: 16,
  },
  backButton: {
    marginBottom: 16,
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 24,
  },
  formContainer: {
    flex: 1,
  },
  label: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1e1e1e',
    color: '#ffffff',
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#7c3aed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 8,
    marginTop: 32,
  },
  disabledButton: {
    backgroundColor: '#666666',
  },
  buttonText: {
    color: '#ffffff',
    marginLeft: 8,
    fontWeight: '600',
    fontSize: 16,
  },
});

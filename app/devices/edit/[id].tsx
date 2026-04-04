import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Save } from 'lucide-react-native';
import { Device } from '../../../src/types/device';
import deviceService from '../../services/deviceService';

export default function EditDeviceScreen() {
  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadDevice();
  }, [id]);

  const loadDevice = async () => {
    try {
      setIsLoading(true);
      const devices = await deviceService.getDevices();
      
      const device = devices.find((d: Device) => d.id === id);
      if (device) {
        setName(device.name);
        setMac(device.mac);
        setIp(device.ip);
      } else {
        Alert.alert('Error', 'Device not found');
        router.back();
      }
    } catch (error) {
      console.error('Error loading device:', error);
      Alert.alert('Error', 'Failed to load device details');
    } finally {
      setIsLoading(false);
    }
  };

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

  const handleSave = async () => {
    if (!validateFields()) return;

    try {
      setIsSaving(true);
      
      // Get existing devices
      const devices = await deviceService.getDevices();
      
      // Find and update the device
      const updatedDevices = devices.map((device: Device) => {
        if (device.id === id) {
          return {
            ...device,
            name: name.trim(),
            mac: mac.trim(),
            ip: ip.trim(),
          };
        }
        return device;
      });
      
      // Save updated devices list
      await deviceService.saveDevices(updatedDevices);
      
      setIsSaving(false);
      Alert.alert('Success', 'Device updated successfully', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error updating device:', error);
      setIsSaving(false);
      Alert.alert('Error', 'Failed to update device');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

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
        
        <Text style={styles.title}>Edit Device</Text>
        
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
            style={[styles.saveButton, isSaving && styles.disabledButton]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <Text style={styles.buttonText}>Saving...</Text>
            ) : (
              <>
                <Save size={20} color="#ffffff" style={styles.buttonIcon} />
                <Text style={styles.buttonText}>Save Changes</Text>
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
  saveButton: {
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
  buttonIcon: {
    marginRight: 2,
  },
});

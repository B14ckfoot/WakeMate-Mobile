import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Device } from '../../src/types/device';

export const deviceService = {
  async getServerAddress(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem('serverIp');
    } catch (error) {
      console.error('Error getting server address:', error);
      return null;
    }
  },
  
  async setServerAddress(ip: string): Promise<void> {
    try {
      await AsyncStorage.setItem('serverIp', ip);
    } catch (error) {
      console.error('Error setting server address:', error);
      throw error;
    }
  },
  
  async getDevices(): Promise<Device[]> {
    try {
      const devices = await AsyncStorage.getItem('devices');
      return devices ? JSON.parse(devices) : [];
    } catch (error) {
      console.error('Error getting devices:', error);
      return [];
    }
  },
  
  async saveDevices(devices: Device[]): Promise<void> {
    try {
      await AsyncStorage.setItem('devices', JSON.stringify(devices));
    } catch (error) {
      console.error('Error saving devices:', error);
      throw error;
    }
  },
  
  async checkDeviceStatus(deviceIp: string): Promise<boolean> {
    try {
      const response = await axios.get(`http://${deviceIp}:7777/status`, {
        timeout: 3000,
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      return response.data && 
        (response.data.status === "online" || response.data.status === "success");
    } catch (error) {
      console.log(`Error checking device status:`, error);
      return false;
    }
  },
  
  async sendCommand(command: string, params: Record<string, any> = {}): Promise<any> {
    const serverIp = await this.getServerAddress();
    
    if (!serverIp) {
      throw new Error('Server IP not set');
    }
    
    try {
      const response = await axios.post(`http://${serverIp}:7777`, {
        command,
        params
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      return response.data;
    } catch (error) {
      console.error('Error sending command:', error);
      throw error;
    }
  }
};

export default deviceService;

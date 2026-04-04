import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUBNETS = [
  '10.0.0.',
  '192.168.0.',
  '192.168.1.',
  '192.168.',
  '10.0.1.',
];

export function useEnhancedAutoDiscoverServer() {
  const [serverIp, setServerIp] = useState(null);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState(null);
  const [progress, setProgress] = useState(0);

  const testServerConnection = useCallback(async (ip, timeout = 2000) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`http://${ip}:7777/v1/health`, {
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data?.ok === true && data?.data?.status === 'online';
    } catch {
      return false;
    }
  }, []);

  const checkIP = useCallback(async (ip, timeout) => {
    try {
      const found = await testServerConnection(ip, timeout);
      if (found) {
        setServerIp(ip);
        await AsyncStorage.setItem('serverIp', ip);
        setSearching(false);
        return true;
      }
    } catch {
      // Ignore per-host failures during scan.
    }

    return false;
  }, [testServerConnection]);

  const scanSubnet = useCallback(async (subnet) => {
    const timeout = 1000;
    const startRange = 1;
    const endRange = 254;
    const priorityIPs = [1, 100, 101, 102, 103, 104, 105, 150, 200];

    for (const index of priorityIPs) {
      setProgress(Math.floor((index / endRange) * 100));
      const found = await checkIP(`${subnet}${index}`, timeout);
      if (found) {
        return true;
      }
    }

    for (let index = startRange; index <= endRange; index += 1) {
      if (priorityIPs.includes(index)) {
        continue;
      }

      setProgress(Math.floor((index / endRange) * 100));
      const found = await checkIP(`${subnet}${index}`, timeout);
      if (found) {
        return true;
      }
    }

    return false;
  }, [checkIP]);

  const scanNetwork = useCallback(async () => {
    setSearching(true);
    setError(false);
    setCurrentSubnet(null);
    setProgress(0);

    try {
      const storedIp = await AsyncStorage.getItem('serverIp');
      if (storedIp) {
        const isValid = await testServerConnection(storedIp);
        if (isValid) {
          setServerIp(storedIp);
          setSearching(false);
          setProgress(100);
          return;
        }

        await AsyncStorage.removeItem('serverIp');
      }

      for (const subnet of SUBNETS) {
        setCurrentSubnet(subnet);

        if (subnet === '192.168.') {
          for (let subnetNum = 2; subnetNum <= 5; subnetNum += 1) {
            const result = await scanSubnet(`192.168.${subnetNum}.`);
            if (result) {
              return;
            }
          }
        } else {
          const result = await scanSubnet(subnet);
          if (result) {
            return;
          }
        }
      }

      setError(true);
      setSearching(false);
    } catch (scanError) {
      console.error('Error during network scan:', scanError);
      setError(true);
      setSearching(false);
    }
  }, [scanSubnet, testServerConnection]);

  useEffect(() => {
    scanNetwork();
  }, [scanNetwork]);

  const retry = useCallback(() => {
    scanNetwork();
  }, [scanNetwork]);

  return {
    serverIp,
    searching,
    error,
    retry,
    currentSubnet,
    progress,
  };
}

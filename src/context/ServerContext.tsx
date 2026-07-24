import React, { createContext, useCallback, useEffect, useContext, useState, ReactNode } from 'react';
import deviceService from '../services/deviceService';
import { pingServer, testCommandEndpoint, runDiagnostics } from '../utils/serverStatusChecker';

const DEFAULT_COMPANION_PORT = 7777;

interface ServerContextType {
  serverIp: string;
  setServerIp: (ip: string) => void;
  serverToken: string;
  setServerToken: (token: string) => void;
  isConnected: boolean;
  connectionError: string | null;
  testConnection: (nextIp?: string, nextToken?: string) => Promise<boolean>;
  runServerDiagnostics: () => Promise<any>;
  refreshFromStorage: () => Promise<void>;
  lastStatus: 'success' | 'error' | 'pending' | null;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

interface ServerProviderProps {
  children: ReactNode;
}

export const ServerProvider: React.FC<ServerProviderProps> = ({ children }) => {
  const [serverIp, setServerIp] = useState<string>('');
  const [serverToken, setServerToken] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<'success' | 'error' | 'pending' | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const loadConnectionSettings = async () => {
      try {
        const [savedIp, savedToken] = await Promise.all([
          deviceService.getServerAddress(),
          deviceService.getServerToken(),
        ]);

        if (savedIp) {
          setServerIp(savedIp);
        }

        if (savedToken) {
          setServerToken(savedToken);
        }
      } catch (error) {
        console.error('Error loading companion settings:', error);
      } finally {
        setIsHydrated(true);
      }
    };

    loadConnectionSettings();
  }, []);

  // The QR pairing flows write the companion IP/token straight to storage
  // (outside this provider), so screens call this to pick those values up
  // without requiring an app restart.
  const refreshFromStorage = useCallback(async () => {
    try {
      const [savedIp, savedToken] = await Promise.all([
        deviceService.getServerAddress(),
        deviceService.getServerToken(),
      ]);

      setServerIp(savedIp?.trim() ?? '');
      setServerToken(savedToken?.trim() ?? '');
    } catch (error) {
      console.error('Error refreshing companion settings:', error);
    }
  }, []);

  const resolveConnectionEndpoint = useCallback(async (nextIp: string): Promise<{
    port: number;
    tlsFingerprint: string | null;
  }> => {
    const trimmedIp = nextIp.trim();
    const [savedIp, savedPort, tlsFingerprint] = await Promise.all([
      deviceService.getServerAddress(),
      deviceService.getServerPort(),
      deviceService.getServerTlsFingerprint(),
    ]);

    if (savedIp?.trim() === trimmedIp && savedPort) {
      return { port: savedPort, tlsFingerprint };
    }

    return { port: DEFAULT_COMPANION_PORT, tlsFingerprint: null };
  }, []);

  const testConnection = useCallback(async (nextIp: string = serverIp, nextToken: string = serverToken): Promise<boolean> => {
    const trimmedServerIp = nextIp.trim();
    const trimmedServerToken = nextToken.trim();

    if (!trimmedServerIp) {
      setConnectionError('Server IP not set');
      setIsConnected(false);
      setLastStatus('error');
      return false;
    }

    setLastStatus('pending');

    try {
      setConnectionError(null);
      const { port: targetPort, tlsFingerprint } =
        await resolveConnectionEndpoint(trimmedServerIp);

      const pingResult = await pingServer(
        trimmedServerIp,
        targetPort,
        tlsFingerprint
      );
      if (!pingResult.success) {
        setIsConnected(false);
        setConnectionError(pingResult.message);
        setLastStatus('error');
        return false;
      }

      if (!trimmedServerToken) {
        setIsConnected(true);
        setConnectionError('Companion reachable. Scan the pairing QR code from the WakeMATE tray icon to enable commands.');
        setLastStatus('success');
        return true;
      }

      const pairingResult = await testCommandEndpoint(
        trimmedServerIp,
        trimmedServerToken,
        targetPort,
        tlsFingerprint
      );
      if (pairingResult.success) {
        setIsConnected(true);
        setConnectionError(null);
        setLastStatus('success');
        return true;
      }

      setIsConnected(false);
      setConnectionError(`Companion reachable, but pairing failed: ${pairingResult.message}`);
      setLastStatus('error');
      return false;
    } catch (error) {
      console.error('Connection test failed:', error);
      setIsConnected(false);
      setLastStatus('error');

      if (error instanceof Error) {
        if (error.message.includes('Network Error') || error.message.includes('Failed to fetch')) {
          setConnectionError('Network error: Unable to reach the companion. Make sure it is running.');
        } else {
          setConnectionError(`Failed to connect: ${error.message}`);
        }
      } else {
        setConnectionError('Failed to connect to companion');
      }

      return false;
    }
  }, [resolveConnectionEndpoint, serverIp, serverToken]);

  useEffect(() => {
    const syncConnectionSettings = async () => {
      if (!isHydrated) {
        return;
      }

      try {
        await Promise.all([
          deviceService.setServerAddress(serverIp),
          deviceService.setServerToken(serverToken),
        ]);
      } catch (error) {
        console.error('Error saving companion settings:', error);
      }

      if (!serverIp) {
        setIsConnected(false);
        setConnectionError('Server IP not set');
        setLastStatus(serverToken ? 'error' : null);
        return;
      }

      await testConnection(serverIp, serverToken);
    };

    syncConnectionSettings();
  }, [isHydrated, serverIp, serverToken, testConnection]);

  const runServerDiagnostics = async (): Promise<any> => {
    if (!serverIp) {
      return {
        overall: false,
        message: 'Server IP not set',
      };
    }

    try {
      const { port: targetPort, tlsFingerprint } =
        await resolveConnectionEndpoint(serverIp);
      const results = await runDiagnostics(
        serverIp,
        serverToken || undefined,
        targetPort,
        tlsFingerprint
      );
      setIsConnected(results.overall);

      if (!results.overall) {
        const failedStep = results.steps.find((step) => !step.success);
        setConnectionError(failedStep ? failedStep.message : 'Diagnostics failed');
      } else {
        setConnectionError(null);
      }

      return results;
    } catch (error) {
      console.error('Diagnostics failed:', error);
      setIsConnected(false);

      if (error instanceof Error) {
        setConnectionError(`Diagnostics failed: ${error.message}`);
      } else {
        setConnectionError('Diagnostics failed with unknown error');
      }

      return {
        overall: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        steps: [],
      };
    }
  };

  return (
    <ServerContext.Provider
      value={{
        serverIp,
        setServerIp,
        serverToken,
        setServerToken,
        isConnected,
        connectionError,
        testConnection,
        runServerDiagnostics,
        refreshFromStorage,
        lastStatus,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
};

export const useServer = (): ServerContextType => {
  const context = useContext(ServerContext);
  if (context === undefined) {
    throw new Error('useServer must be used within a ServerProvider');
  }
  return context;
};

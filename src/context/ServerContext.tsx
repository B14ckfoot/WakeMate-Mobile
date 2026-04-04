import React, { createContext, useCallback, useEffect, useContext, useState, ReactNode } from 'react';
import deviceService from '../services/deviceService';
import { pingServer, testCommandEndpoint, runDiagnostics } from '../utils/serverStatusChecker';

interface ServerContextType {
  serverIp: string;
  setServerIp: (ip: string) => void;
  serverToken: string;
  setServerToken: (token: string) => void;
  isConnected: boolean;
  connectionError: string | null;
  testConnection: (nextIp?: string, nextToken?: string) => Promise<boolean>;
  runServerDiagnostics: () => Promise<any>;
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

      const pingResult = await pingServer(trimmedServerIp);
      if (!pingResult.success) {
        setIsConnected(false);
        setConnectionError(pingResult.message);
        setLastStatus('error');
        return false;
      }

      if (!trimmedServerToken) {
        setIsConnected(true);
        setConnectionError('Companion reachable. Add the pairing token from wakemate.config.json to enable commands.');
        setLastStatus('success');
        return true;
      }

      const pairingResult = await testCommandEndpoint(trimmedServerIp, trimmedServerToken);
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
  }, [serverIp, serverToken]);

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
      const results = await runDiagnostics(serverIp, serverToken || undefined);
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

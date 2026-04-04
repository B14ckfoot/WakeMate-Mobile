import React, { useState } from 'react';

interface ServerDebugProps {
  serverIp: string | null;
}

const ServerDebugComponent: React.FC<ServerDebugProps> = ({ serverIp }) => {
  const [statusResponse, setStatusResponse] = useState<any>(null);
  const [pingResult, setPingResult] = useState<string>('Not tested');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testServerConnection = async () => {
    if (!serverIp) {
      setError('No server IP provided');
      return;
    }

    setIsLoading(true);
    setError(null);
    setPingResult('Testing...');

    try {
      console.log(`Testing connection to http://${serverIp}:7777/status`);
      
      // Create a controller to handle timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`http://${serverIp}:7777/status`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      clearTimeout(timeoutId);
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Response data:', data);
        setStatusResponse(data);
        setPingResult(`Success! Status ${response.status}, Server reports: ${JSON.stringify(data)}`);
      } else {
        setPingResult(`Failed: Server responded with status ${response.status}`);
        setError(`HTTP Error: ${response.status}`);
      }
    } catch (err) {
      console.error('Connection test error:', err);
      
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          setPingResult('Failed: Connection timed out after 5 seconds');
          setError('Timeout error: Server did not respond within 5 seconds');
        } else {
          setPingResult(`Failed: ${err.message}`);
          setError(err.message);
        }
      } else {
        setPingResult('Failed: Unknown error');
        setError('Unknown error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Test direct API call
  const testCommandEndpoint = async () => {
    if (!serverIp) {
      setError('No server IP provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log(`Testing command endpoint at http://${serverIp}:7777`);
      
      const response = await fetch(`http://${serverIp}:7777`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        body: JSON.stringify({
          command: 'get_status',
          params: {}
        }),
        signal: AbortSignal.timeout(5000)
      });
      
      console.log('Command endpoint response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Command endpoint response:', data);
        setStatusResponse(data);
        setPingResult(`Command endpoint success! Response: ${JSON.stringify(data)}`);
      } else {
        setPingResult(`Command endpoint failed with status ${response.status}`);
        setError(`HTTP Error: ${response.status}`);
      }
    } catch (err) {
      console.error('Command endpoint test error:', err);
      
      if (err instanceof Error) {
        setPingResult(`Command endpoint failed: ${err.message}`);
        setError(err.message);
      } else {
        setPingResult('Command endpoint failed: Unknown error');
        setError('Unknown error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-red-950 border border-red-500 p-4 rounded-lg mt-4 text-white">
      <h2 className="text-xl font-bold mb-2">Server Connection Debugger</h2>
      <p className="mb-4 text-sm">Current server IP: {serverIp || 'Not set'}</p>
      
      <div className="flex space-x-2 mb-4">
        <button
          onClick={testServerConnection}
          disabled={isLoading}
          className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm disabled:bg-gray-500"
        >
          Test /status Endpoint
        </button>
        
        <button
          onClick={testCommandEndpoint}
          disabled={isLoading}
          className="bg-green-600 text-white py-2 px-4 rounded-lg text-sm disabled:bg-gray-500"
        >
          Test Command Endpoint
        </button>
      </div>
      
      {isLoading && (
        <div className="flex items-center justify-center mb-2">
          <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
          <span className="ml-2">Testing connection...</span>
        </div>
      )}
      
      <div className="bg-gray-800 p-3 rounded-lg mb-3">
        <h3 className="text-sm font-semibold mb-1">Ping Result:</h3>
        <p className="text-sm font-mono">{pingResult}</p>
      </div>
      
      {error && (
        <div className="bg-red-900 p-3 rounded-lg mb-3">
          <h3 className="text-sm font-semibold mb-1">Error:</h3>
          <p className="text-sm">{error}</p>
        </div>
      )}
      
      {statusResponse && (
        <div className="bg-gray-800 p-3 rounded-lg">
          <h3 className="text-sm font-semibold mb-1">Response Data:</h3>
          <pre className="text-xs font-mono overflow-auto max-h-32">
            {JSON.stringify(statusResponse, null, 2)}
          </pre>
        </div>
      )}
      
      <div className="mt-4 bg-gray-800 p-3 rounded-lg">
        <h3 className="text-sm font-semibold mb-1">Common Solutions:</h3>
        <ul className="text-xs list-disc pl-5 space-y-1">
          <li>Verify server is running and reachable from the device</li>
          <li>Check that your device and server are on the same network</li>
          <li>Ensure port 7777 is open on your server firewall</li>
          <li>Try restarting both your app and server</li>
          <li>Check server logs for any errors</li>
        </ul>
      </div>
    </div>
  );
};

export default ServerDebugComponent;

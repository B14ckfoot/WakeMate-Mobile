const AUTH_HEADER = 'x-wakemate-token';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 3000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function pingServer(ip: string, port: number = 7777): Promise<{
  success: boolean;
  message: string;
  responseTime?: number;
}> {
  try {
    const startTime = performance.now();
    const response = await fetchWithTimeout(`http://${ip}:${port}/v1/health`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
      },
    });

    const endTime = performance.now();
    const responseTime = Math.round(endTime - startTime);

    if (!response.ok) {
      return {
        success: false,
        message: `Companion responded with status ${response.status}`,
        responseTime,
      };
    }

    const data = await response.json();
    if (data?.ok === true && data?.data?.status === 'online') {
      return {
        success: true,
        message: `Connected successfully (${responseTime}ms)`,
        responseTime,
      };
    }

    return {
      success: false,
      message: 'Companion responded but health payload was unexpected',
      responseTime,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: 'Connection timed out after 3 seconds',
        };
      }

      if (error.message.includes('Failed to fetch')) {
        return {
          success: false,
          message: 'Failed to connect to companion. Make sure the WakeMATE companion is running.',
        };
      }

      return {
        success: false,
        message: `Connection error: ${error.message}`,
      };
    }

    return {
      success: false,
      message: 'Unknown connection error',
    };
  }
}

export async function testCommandEndpoint(
  ip: string,
  token?: string,
  port: number = 7777
): Promise<{
  success: boolean;
  message: string;
  responseData?: any;
}> {
  if (!token?.trim()) {
    return {
      success: false,
      message: 'Companion reachable, but pairing token is not set yet.',
    };
  }

  try {
    const response = await fetchWithTimeout(`http://${ip}:${port}/v1/pairing/check`, {
      method: 'GET',
      headers: {
        [AUTH_HEADER]: token.trim(),
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: 'Pairing token accepted',
        responseData: data,
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        message: 'Pairing token was rejected by the companion.',
      };
    }

    return {
      success: false,
      message: `Pairing check responded with status ${response.status}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          success: false,
          message: 'Pairing check timed out after 3 seconds',
        };
      }

      return {
        success: false,
        message: `Pairing check error: ${error.message}`,
      };
    }

    return {
      success: false,
      message: 'Unknown pairing check error',
    };
  }
}

export async function runDiagnostics(
  ip: string,
  token?: string,
  port: number = 7777
): Promise<{
  overall: boolean;
  steps: {
    name: string;
    success: boolean;
    message: string;
    data?: any;
  }[];
}> {
  const results = {
    overall: false,
    steps: [] as {
      name: string;
      success: boolean;
      message: string;
      data?: any;
    }[],
  };

  const pingResult = await pingServer(ip, port);
  results.steps.push({
    name: 'Companion Health',
    success: pingResult.success,
    message: pingResult.message,
    data: pingResult,
  });

  const pairingResult = await testCommandEndpoint(ip, token, port);
  results.steps.push({
    name: 'Pairing Token',
    success: pairingResult.success,
    message: pairingResult.message,
    data: pairingResult,
  });

  results.overall = results.steps.every((step) => step.success);
  return results;
}

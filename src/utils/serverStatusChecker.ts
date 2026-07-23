import { requestCompanion } from '../services/companionTransport';

const AUTH_HEADER = 'x-wakemate-token';
const LOCAL_CONNECTION_TIMEOUT_MS = 1500;

export async function pingServer(
  ip: string,
  port: number = 7777,
  tlsFingerprint?: string | null
): Promise<{
  success: boolean;
  message: string;
  responseTime?: number;
}> {
  try {
    const startTime = performance.now();
    const response = await requestCompanion<any>({
      ip,
      port,
      path: '/v1/health',
      timeoutMs: LOCAL_CONNECTION_TIMEOUT_MS,
      tlsFingerprint,
      headers: {
        'Cache-Control': 'no-cache',
      },
    });
    const responseTime = Math.round(performance.now() - startTime);

    if (response.data?.ok === true && response.data?.data?.status === 'online') {
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
    const message = error instanceof Error ? error.message : 'Unknown connection error';
    if (/timeout|timed out|aborted/i.test(message)) {
      return {
        success: false,
        message: 'Connection timed out after 1.5 seconds',
      };
    }

    return {
      success: false,
      message: `Connection error: ${message}`,
    };
  }
}

export async function testCommandEndpoint(
  ip: string,
  token?: string,
  port: number = 7777,
  tlsFingerprint?: string | null
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
    const response = await requestCompanion<any>({
      ip,
      port,
      path: '/v1/pairing/check',
      timeoutMs: LOCAL_CONNECTION_TIMEOUT_MS,
      tlsFingerprint,
      headers: {
        [AUTH_HEADER]: token.trim(),
      },
    });

    return {
      success: true,
      message: 'Pairing token accepted',
      responseData: response.data,
    };
  } catch (error) {
    const status =
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'status' in error.response
        ? error.response.status
        : null;
    if (status === 401 || status === 403) {
      return {
        success: false,
        message: 'Pairing token was rejected by the companion.',
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown pairing check error';
    if (/timeout|timed out|aborted/i.test(message)) {
      return {
        success: false,
        message: 'Pairing check timed out after 1.5 seconds',
      };
    }

    return {
      success: false,
      message: `Pairing check error: ${message}`,
    };
  }
}

export async function runDiagnostics(
  ip: string,
  token?: string,
  port: number = 7777,
  tlsFingerprint?: string | null
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

  const pingResult = await pingServer(ip, port, tlsFingerprint);
  results.steps.push({
    name: 'Companion Health',
    success: pingResult.success,
    message: pingResult.message,
    data: pingResult,
  });

  const pairingResult = await testCommandEndpoint(
    ip,
    token,
    port,
    tlsFingerprint
  );
  results.steps.push({
    name: 'Pairing Token',
    success: pairingResult.success,
    message: pairingResult.message,
    data: pairingResult,
  });

  results.overall = results.steps.every((step) => step.success);
  return results;
}

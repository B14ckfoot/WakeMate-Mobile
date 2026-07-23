import { requestCompanion } from '../services/companionTransport';

export async function checkDeviceStatus(
  ip: string,
  port: number = 7777,
  tlsFingerprint?: string | null
): Promise<boolean> {
  try {
    const response = await requestCompanion<any>({
      ip,
      port,
      path: '/v1/health',
      timeoutMs: 3000,
      tlsFingerprint,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });

    return response.data?.ok === true && response.data?.data?.status === 'online';
  } catch (error) {
    console.log(`Error checking device status for ${ip}:${port}`, error);
    return false;
  }
}

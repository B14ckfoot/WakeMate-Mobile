export async function checkDeviceStatus(ip: string, port: number = 7777): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`http://${ip}:${port}/v1/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`Device at ${ip}:${port} returned status ${response.status}`);
      return false;
    }

    const data = await response.json();
    return data?.ok === true && data?.data?.status === 'online';
  } catch (error) {
    console.log(`Error checking device status for ${ip}:${port}`, error);
    return false;
  }
}
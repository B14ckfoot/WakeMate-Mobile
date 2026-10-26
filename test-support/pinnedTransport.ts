import { requestPinnedHttps } from '../modules/wakemate-tls';

// Preserve readable command/pairing response fixtures while stubbing the native
// network boundary. The real JS transport still decides whether HTTPS is safe.
export const stubPinnedTransport = (request: jest.Mock): void => {
  (requestPinnedHttps as jest.Mock).mockReset().mockImplementation(
    async (url, method, headers, body, fingerprint, timeout) => {
      const response = await request({
        url, method, headers, fingerprint, timeout,
        data: body === null ? undefined : JSON.parse(body),
      });
      return {
        status: response.status,
        headers: response.headers,
        body: JSON.stringify(response.data),
      };
    }
  );
};

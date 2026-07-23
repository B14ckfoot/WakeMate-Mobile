import CryptoKit
import ExpoModulesCore
import Foundation
import Security

public final class WakemateTlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakemateTls")

    AsyncFunction("request") {
      (
        urlValue: String,
        method: String,
        headers: [String: String],
        body: String?,
        fingerprint: String,
        timeoutMs: Int,
        promise: Promise
      ) in
      guard let url = URL(string: urlValue), url.scheme?.lowercased() == "https" else {
        promise.reject(PinnedRequestException("Pinned requests require an HTTPS URL."))
        return
      }

      guard let expectedFingerprint = parseFingerprint(fingerprint) else {
        promise.reject(PinnedRequestException(
          "Expected a 64-character SHA-256 certificate fingerprint."
        ))
        return
      }

      var request = URLRequest(url: url)
      request.httpMethod = method.uppercased()
      request.timeoutInterval = Double(max(timeoutMs, 1)) / 1000.0
      request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      request.httpBody = body?.data(using: .utf8)
      headers.forEach { name, value in
        request.setValue(value, forHTTPHeaderField: name)
      }

      let delegate = PinnedRequestDelegate(
        expectedFingerprint: expectedFingerprint,
        promise: promise
      )
      let configuration = URLSessionConfiguration.ephemeral
      configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      configuration.urlCache = nil
      let session = URLSession(
        configuration: configuration,
        delegate: delegate,
        delegateQueue: nil
      )
      session.dataTask(with: request).resume()
    }
  }
}

private final class PinnedRequestDelegate: NSObject, URLSessionDataDelegate {
  private let expectedFingerprint: Data
  private let promise: Promise
  private var responseData = Data()
  private var httpResponse: HTTPURLResponse?
  private var pinMismatch = false

  init(expectedFingerprint: Data, promise: Promise) {
    self.expectedFingerprint = expectedFingerprint
    self.promise = promise
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard
      challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let serverTrust = challenge.protectionSpace.serverTrust,
      let certificate = SecTrustGetCertificateAtIndex(serverTrust, 0)
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    let certificateData = SecCertificateCopyData(certificate) as Data
    let actualFingerprint = Data(SHA256.hash(data: certificateData))

    if actualFingerprint == expectedFingerprint {
      // The exact certificate pin is the server identity. The companion is
      // self-signed and may move to a new DHCP address, so a public-CA
      // hostname evaluation is intentionally replaced by this QR pin.
      completionHandler(.useCredential, URLCredential(trust: serverTrust))
    } else {
      pinMismatch = true
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Never follow a redirect to a host that has not been pinned.
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    httpResponse = response as? HTTPURLResponse
    completionHandler(.allow)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    responseData.append(data)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    defer {
      session.finishTasksAndInvalidate()
    }

    if pinMismatch {
      promise.reject(PinnedRequestException(
        "WakeMATE companion certificate fingerprint mismatch."
      ))
      return
    }

    if let error {
      promise.reject(PinnedRequestException(error.localizedDescription))
      return
    }

    guard let httpResponse else {
      promise.reject(PinnedRequestException("The companion returned no HTTP response."))
      return
    }

    var headers: [String: String] = [:]
    httpResponse.allHeaderFields.forEach { name, value in
      headers[String(describing: name)] = String(describing: value)
    }
    let body = String(data: responseData, encoding: .utf8) ?? ""

    promise.resolve([
      "status": httpResponse.statusCode,
      "headers": headers,
      "body": body
    ])
  }
}

private final class PinnedRequestException: GenericException<String> {
  override var reason: String {
    param
  }
}

private func parseFingerprint(_ value: String) -> Data? {
  let normalized = value
    .trimmingCharacters(in: .whitespacesAndNewlines)
    .lowercased()
    .replacingOccurrences(of: "sha256:", with: "")
    .replacingOccurrences(of: ":", with: "")
  guard normalized.count == 64, normalized.allSatisfy({ $0.isHexDigit }) else {
    return nil
  }

  var bytes = [UInt8]()
  bytes.reserveCapacity(32)
  var index = normalized.startIndex
  for _ in 0..<32 {
    let nextIndex = normalized.index(index, offsetBy: 2)
    guard let byte = UInt8(normalized[index..<nextIndex], radix: 16) else {
      return nil
    }
    bytes.append(byte)
    index = nextIndex
  }
  return Data(bytes)
}

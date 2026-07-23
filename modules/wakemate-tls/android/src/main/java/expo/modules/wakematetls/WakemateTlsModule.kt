package expo.modules.wakematetls

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class WakemateTlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WakemateTls")

    AsyncFunction("request") {
        url: String,
        method: String,
        headers: Map<String, String>,
        body: String?,
        fingerprint: String,
        timeoutMs: Int ->
      pinnedRequest(url, method, headers, body, fingerprint, timeoutMs)
    }
  }
}

private fun pinnedRequest(
  urlValue: String,
  method: String,
  headers: Map<String, String>,
  body: String?,
  fingerprint: String,
  timeoutMs: Int
): Map<String, Any> {
  val url = URL(urlValue)
  require(url.protocol.equals("https", ignoreCase = true)) {
    "Pinned requests require an HTTPS URL."
  }

  val expectedFingerprint = parseFingerprint(fingerprint)
  val trustManager = FingerprintTrustManager(expectedFingerprint)
  val sslContext = SSLContext.getInstance("TLS")
  sslContext.init(null, arrayOf(trustManager), SecureRandom())

  val connection = url.openConnection() as HttpsURLConnection
  try {
    connection.sslSocketFactory = sslContext.socketFactory
    // The stable certificate pin is the server identity. The certificate is
    // intentionally self-signed and the companion's DHCP address can change,
    // so PKI hostname validation is not applicable after the exact DER pin
    // has been checked by FingerprintTrustManager.
    connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
    connection.instanceFollowRedirects = false
    connection.requestMethod = method.uppercase()
    connection.connectTimeout = timeoutMs.coerceAtLeast(1)
    connection.readTimeout = timeoutMs.coerceAtLeast(1)
    connection.useCaches = false
    headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

    if (body != null) {
      val encodedBody = body.toByteArray(Charsets.UTF_8)
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(encodedBody.size)
      connection.outputStream.use { stream -> stream.write(encodedBody) }
    }

    val status = connection.responseCode
    val responseBody = (if (status >= 400) connection.errorStream else connection.inputStream)
      ?.bufferedReader(Charsets.UTF_8)
      ?.use { reader -> reader.readText() }
      .orEmpty()
    val responseHeaders = connection.headerFields.entries
      .filter { (name, _) -> name != null }
      .associate { (name, values) -> name!! to values.joinToString(", ") }

    return mapOf(
      "status" to status,
      "headers" to responseHeaders,
      "body" to responseBody
    )
  } finally {
    connection.disconnect()
  }
}

private class FingerprintTrustManager(
  private val expectedFingerprint: ByteArray
) : X509TrustManager {
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    throw CertificateException("Client certificates are not supported.")
  }

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull()
      ?: throw CertificateException("The companion did not provide a TLS certificate.")
    val actualFingerprint = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)

    if (!MessageDigest.isEqual(expectedFingerprint, actualFingerprint)) {
      throw CertificateException("WakeMATE companion certificate fingerprint mismatch.")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

private fun parseFingerprint(value: String): ByteArray {
  val normalized = value
    .trim()
    .lowercase()
    .removePrefix("sha256:")
    .replace(":", "")
  require(normalized.matches(Regex("^[0-9a-f]{64}$"))) {
    "Expected a 64-character SHA-256 certificate fingerprint."
  }

  return ByteArray(32) { index ->
    normalized.substring(index * 2, index * 2 + 2).toInt(16).toByte()
  }
}

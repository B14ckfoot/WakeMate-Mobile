// Lives in `_shared/` on purpose: @bacons/apple-targets compiles that folder
// into both the app and the widget extension. An App Intent that asks the
// system to bring the app forward needs membership in both targets, so moving
// this file up a level would quietly break the fallback path below.

import AppIntents
import Darwin
import Foundation
import WidgetKit

/// Sends a Wake-on-LAN magic packet straight from the widget extension.
///
/// This is a deliberate second implementation of the magic packet — the app's
/// own copy lives behind a React Native native module (`NativeModules.WakeOnLan`),
/// and an App Intent running in the widget extension has no JS runtime to call
/// into. Sending 102 bytes of UDP is small enough to duplicate honestly; the
/// alternative is launching the whole app just to open a socket.
///
/// Local network access: iOS gates LAN broadcast behind the local-network
/// privilege, but app extensions share their container app's grant. WakeMATE
/// asks for it the first time you wake from inside the app, so by the time the
/// control is used the grant is normally already decided. When it is not,
/// `sendto` fails and we fall back to opening the app, which *can* show the
/// system prompt.
enum WakeMateMagicPacket {
    enum SendError: Error {
        case invalidMacAddress
        case invalidBroadcastAddress
        case socketUnavailable(Int32)
        case sendFailed(Int32)
    }

    /// Builds the standard magic packet: six `0xFF` bytes followed by the
    /// target MAC repeated sixteen times.
    static func packet(for macAddress: String) throws -> [UInt8] {
        let hexDigits = macAddress.filter(\.isHexDigit)
        guard hexDigits.count == 12 else {
            throw SendError.invalidMacAddress
        }

        var macBytes: [UInt8] = []
        var index = hexDigits.startIndex
        while index < hexDigits.endIndex {
            let next = hexDigits.index(index, offsetBy: 2)
            guard let byte = UInt8(hexDigits[index..<next], radix: 16) else {
                throw SendError.invalidMacAddress
            }
            macBytes.append(byte)
            index = next
        }

        var payload = [UInt8](repeating: 0xFF, count: 6)
        for _ in 0..<16 {
            payload.append(contentsOf: macBytes)
        }
        return payload
    }

    static func send(macAddress: String, broadcastAddress: String, port: UInt16) throws {
        let payload = try packet(for: macAddress)

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        guard inet_pton(AF_INET, broadcastAddress, &address.sin_addr) == 1 else {
            throw SendError.invalidBroadcastAddress
        }

        let handle = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard handle >= 0 else {
            throw SendError.socketUnavailable(errno)
        }
        defer { close(handle) }

        var broadcastEnabled: Int32 = 1
        guard
            setsockopt(
                handle,
                SOL_SOCKET,
                SO_BROADCAST,
                &broadcastEnabled,
                socklen_t(MemoryLayout<Int32>.size)
            ) == 0
        else {
            throw SendError.socketUnavailable(errno)
        }

        let sentBytes = withUnsafePointer(to: &address) { addressPointer in
            addressPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { rebound in
                payload.withUnsafeBytes { buffer in
                    sendto(
                        handle,
                        buffer.baseAddress,
                        buffer.count,
                        0,
                        rebound,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
        }

        // A denied local-network privilege surfaces here as an error rather
        // than a silent drop, which is what lets the fallback below trigger.
        guard sentBytes == payload.count else {
            throw SendError.sendFailed(errno)
        }
    }

    /// The same broadcast candidates the app tries, in the same order: the
    /// device's configured address first, then the global broadcast. Succeeds
    /// if any one of them goes out.
    static func broadcastCandidates(for device: WakeMateSharedDevice) -> [String] {
        var candidates: [String] = []

        let configured = device.wakeAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        if !configured.isEmpty {
            candidates.append(configured)
        }
        if !candidates.contains("255.255.255.255") {
            candidates.append("255.255.255.255")
        }

        return candidates
    }

    static func wake(device: WakeMateSharedDevice) -> Bool {
        let port = UInt16(exactly: max(0, min(65535, device.wakePort))) ?? 9
        var sentAny = false

        for broadcastAddress in broadcastCandidates(for: device) {
            do {
                try send(macAddress: device.mac, broadcastAddress: broadcastAddress, port: port)
                sentAny = true
            } catch {
                continue
            }
        }

        return sentAny
    }
}

/// A wake request the extension could not complete itself, left for the app to
/// pick up when it next comes to the foreground.
enum WakeMatePendingWake {
    static let key = "wakemate.pendingWake"
    /// Long enough to survive a cold app launch, short enough that a request
    /// abandoned days ago never fires a surprise wake.
    static let expirySeconds: Double = 120

    static func record(deviceID: String) {
        guard let defaults = UserDefaults(suiteName: WakeMateSharedConstants.appGroup) else {
            return
        }

        let payload: [String: Any] = [
            "deviceId": deviceID,
            "requestedAt": Date().timeIntervalSince1970 * 1000,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            return
        }

        defaults.set(data, forKey: key)
    }
}

/// The outcome of the last press, so the widget can say what actually happened
/// instead of looking identical before and after a tap. Only ever records that
/// the packet left the phone -- whether the computer woke up is the companion's
/// answer to give, not this extension's.
enum WakeMateLastWake {
    static let key = "wakemate.lastWake"
    /// Past this the widget goes back to its resting state; a result from an
    /// hour ago tells the user nothing about the button they are looking at.
    static let displaySeconds: Double = 10 * 60

    struct Record {
        let deviceID: String
        let sentAt: Date
        let didSend: Bool
    }

    static func record(deviceID: String, didSend: Bool) {
        guard let defaults = UserDefaults(suiteName: WakeMateSharedConstants.appGroup) else {
            return
        }

        let payload: [String: Any] = [
            "deviceId": deviceID,
            "sentAt": Date().timeIntervalSince1970 * 1000,
            "didSend": didSend,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
            return
        }

        defaults.set(data, forKey: key)
    }

    static func latest() -> Record? {
        guard
            let defaults = UserDefaults(suiteName: WakeMateSharedConstants.appGroup),
            let data = defaults.data(forKey: key),
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let deviceID = payload["deviceId"] as? String,
            let sentAtMilliseconds = payload["sentAt"] as? Double,
            let didSend = payload["didSend"] as? Bool
        else {
            return nil
        }

        return Record(
            deviceID: deviceID,
            sentAt: Date(timeIntervalSince1970: sentAtMilliseconds / 1000),
            didSend: didSend
        )
    }

    /// The record for `deviceID`, but only while it is still recent enough to
    /// describe what the user just did.
    static func current(for deviceID: String, now: Date = Date()) -> Record? {
        guard
            let record = latest(),
            record.deviceID == deviceID,
            now.timeIntervalSince(record.sentAt) < displaySeconds,
            // A clock that moved backwards should not resurrect an old result.
            now.timeIntervalSince(record.sentAt) > -displaySeconds
        else {
            return nil
        }

        return record
    }
}

/// Both widget surfaces render from app-group state, so anything that changes
/// that state has to ask WidgetKit to redraw or the user keeps looking at the
/// previous answer.
enum WakeMateWidgetRefresh {
    static func reloadAll() {
        WidgetCenter.shared.reloadTimelines(ofKind: WakeMateSharedConstants.widgetKind)

        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadControls(ofKind: WakeMateSharedConstants.controlKind)
        }
    }
}

/// Failures the person pressing the widget or control can actually act on.
/// These surface as system alerts, which is the only feedback channel
/// available: an extension cannot bring the app forward
/// (`ForegroundContinuableIntent` is unavailable in app extensions) and Control
/// Center ignores custom URL schemes, so there is no way to hand off
/// automatically.
/// iOS 16+ because of `LocalizedStringResource`: this file is also compiled
/// into the app target, which still deploys back to iOS 15.1.
@available(iOS 16.0, *)
enum WakeMateWakeError: Error, CustomLocalizedStringResourceConvertible {
    case notConfigured
    case configuredDeviceMissing
    case couldNotSend

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notConfigured:
            return "Add a computer in WakeMATE first, then press and hold this to choose it."
        case .configuredDeviceMissing:
            return "That computer is no longer saved in WakeMATE. Press and hold to choose another."
        case .couldNotSend:
            return "Couldn't reach the network. Open WakeMATE once to finish waking this computer."
        }
    }
}

@available(iOS 17.0, *)
struct WakeMateWakeDeviceIntent: AppIntent {
    static let title: LocalizedStringResource = "Wake Computer"
    static let description = IntentDescription("Send a Wake-on-LAN magic packet to a saved computer.")

    /// The whole point of this control is waking without launching anything,
    /// and this cannot be decided per-run — it is read before `perform()`.
    static let openAppWhenRun: Bool = false

    /// Plumbing for the widget and the Control Center button, not a Shortcuts
    /// action: its only parameter is an opaque device ID, which would be
    /// meaningless in the Shortcuts editor.
    static let isDiscoverable: Bool = false

    /// Empty means "whatever this surface resolves to" -- the app's favorite,
    /// or the first saved computer. A specific ID pins it to that computer.
    @Parameter(title: "Device")
    var deviceID: String?

    init() {}

    init(deviceID: String?) {
        self.deviceID = deviceID
    }

    func perform() async throws -> some IntentResult {
        let resolution = WakeMateSharedStore.resolve(configuredID: deviceID)

        guard let device = resolution.device else {
            // Nothing to record, so just say what to do about it.
            throw resolution == .configuredDeviceMissing
                ? WakeMateWakeError.configuredDeviceMissing
                : WakeMateWakeError.notConfigured
        }

        let didSend = WakeMateMagicPacket.wake(device: device)

        if !didSend {
            // The packet could not leave the extension — most likely the
            // local-network privilege is still undetermined for this install,
            // and only the app can surface that system prompt. Leave the
            // request for the app to finish and tell the user to open it.
            WakeMatePendingWake.record(deviceID: device.id)
        }

        // Recorded either way, then redrawn, so the widget reports what
        // actually happened rather than staying on its resting state.
        WakeMateLastWake.record(deviceID: device.id, didSend: didSend)
        WakeMateWidgetRefresh.reloadAll()

        guard didSend else {
            throw WakeMateWakeError.couldNotSend
        }

        return .result()
    }
}

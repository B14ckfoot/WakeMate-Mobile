import AppIntents
import Foundation

enum WakeMateSharedConstants {
    static let appGroup = "group.com.anonymous.wakematemobile"
    static let devicesKey = "wakemate.devices"
    /// The computer the app marked as the widget default. Written by
    /// `src/services/favoriteDevice.ts`; keep the key in step with that file.
    static let favoriteDeviceKey = "wakemate.favoriteDeviceId"
    static let widgetKind = "com.anonymous.wakematemobile.widget"
    static let controlKind = "com.anonymous.wakematemobile.control"
    static let appScheme = "myapp"
}

struct WakeMateSharedDevice: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let mac: String
    let ip: String
    let wakeAddress: String
    let wakePort: Int
    let status: String
    let type: String
}

/// Which computer a widget or control should act on, and why. The distinction
/// between "nothing was chosen" and "the chosen computer is gone" matters:
/// falling back to another machine in the second case would wake the wrong PC.
enum WakeMateDeviceResolution: Equatable {
    /// A computer to act on. `isDefault` is true when it came from the app's
    /// favorite (or the first saved computer) rather than an explicit pick.
    case resolved(WakeMateSharedDevice, isDefault: Bool)
    /// This surface was pointed at a computer that is no longer saved.
    case configuredDeviceMissing
    /// Nothing is saved in the app yet.
    case noDevices

    var device: WakeMateSharedDevice? {
        guard case let .resolved(device, _) = self else {
            return nil
        }

        return device
    }

    var isDefault: Bool {
        guard case let .resolved(_, isDefault) = self else {
            return false
        }

        return isDefault
    }
}

enum WakeMateSharedStore {
    private static func defaults() -> UserDefaults? {
        UserDefaults(suiteName: WakeMateSharedConstants.appGroup)
    }

    /// Saved computers in the order the app stores them, which is the order
    /// they were added. `storedDevices().first` is therefore "the first
    /// computer you connected", which is what an unconfigured widget falls
    /// back to.
    static func storedDevices() -> [WakeMateSharedDevice] {
        guard let data = defaults()?.data(forKey: WakeMateSharedConstants.devicesKey) else {
            return []
        }

        return (try? JSONDecoder().decode([WakeMateSharedDevice].self, from: data)) ?? []
    }

    /// The same computers sorted for human pickers. Never use this for the
    /// fallback: alphabetical order has nothing to do with which computer the
    /// user actually cares about.
    static func devices() -> [WakeMateSharedDevice] {
        storedDevices().sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    static func favoriteDeviceID() -> String? {
        guard let raw = defaults()?.string(forKey: WakeMateSharedConstants.favoriteDeviceKey) else {
            return nil
        }

        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func device(id: String?) -> WakeMateSharedDevice? {
        guard let id, !id.isEmpty else {
            return nil
        }

        return storedDevices().first { $0.id == id }
    }

    /// The single place every widget surface decides what to act on:
    /// the computer this widget was configured with, else the favorite chosen
    /// in the app, else the first computer that was added. Without the last two
    /// steps a freshly placed widget resolves to nothing at all, even though
    /// the gallery preview showed a real computer.
    static func resolve(configuredID: String?) -> WakeMateDeviceResolution {
        let saved = storedDevices()

        let trimmedID = configuredID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmedID.isEmpty {
            guard let configured = saved.first(where: { $0.id == trimmedID }) else {
                // Deliberately no fallback: this widget was pointed at a
                // specific computer and that computer was removed.
                return .configuredDeviceMissing
            }

            return .resolved(configured, isDefault: false)
        }

        if
            let favoriteID = favoriteDeviceID(),
            let favorite = saved.first(where: { $0.id == favoriteID })
        {
            return .resolved(favorite, isDefault: true)
        }

        guard let first = saved.first else {
            return .noDevices
        }

        return .resolved(first, isDefault: true)
    }

    /// The computer a brand-new widget or control should start out on.
    static func defaultDevice() -> WakeMateSharedDevice? {
        resolve(configuredID: nil).device
    }
}

enum WakeMateDeepLink {
    static let devicesURL = buildURL(host: "devices", queryItems: [])

    static func wakeURL(for deviceID: String?) -> URL {
        guard let deviceID, !deviceID.isEmpty else {
            return devicesURL
        }

        return buildURL(
            host: "wake",
            queryItems: [URLQueryItem(name: "deviceId", value: deviceID)]
        )
    }

    private static func buildURL(host: String, queryItems: [URLQueryItem]) -> URL {
        var components = URLComponents()
        components.scheme = WakeMateSharedConstants.appScheme
        components.host = host
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        return components.url ?? URL(string: "\(WakeMateSharedConstants.appScheme)://\(host)")!
    }
}

@available(iOS 16.0, *)
struct WakeMateDeviceEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "WakeMATE Device"
    static let defaultQuery = WakeMateDeviceQuery()

    let id: String
    let name: String
    let ip: String
    let status: String

    var displayRepresentation: DisplayRepresentation {
        let subtitle = status.isEmpty ? ip : "\(ip) • \(status.capitalized)"
        return DisplayRepresentation(
            title: LocalizedStringResource(stringLiteral: name),
            subtitle: LocalizedStringResource(stringLiteral: subtitle)
        )
    }

    init(device: WakeMateSharedDevice) {
        id = device.id
        name = device.name
        ip = device.ip
        status = device.status
    }
}

@available(iOS 16.0, *)
struct WakeMateDeviceQuery: EntityQuery {
    func entities(for identifiers: [WakeMateDeviceEntity.ID]) async throws -> [WakeMateDeviceEntity] {
        let requestedIdentifiers = Set(identifiers)

        return WakeMateSharedStore.devices()
            .filter { requestedIdentifiers.contains($0.id) }
            .map(WakeMateDeviceEntity.init(device:))
    }

    func suggestedEntities() async throws -> [WakeMateDeviceEntity] {
        WakeMateSharedStore.devices().map(WakeMateDeviceEntity.init(device:))
    }

    /// Pre-fills the picker when a widget or control is first added. The
    /// protocol's default returns nil, which is what left every new widget
    /// configured with no computer at all.
    func defaultResult() async -> WakeMateDeviceEntity? {
        WakeMateSharedStore.defaultDevice().map(WakeMateDeviceEntity.init(device:))
    }
}

@available(iOS 17.0, *)
struct WakeMateWidgetConfigurationIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Wake PC Widget"
    static let description = IntentDescription("Choose the computer this widget should wake.")

    @Parameter(title: "Device")
    var device: WakeMateDeviceEntity?
}

@available(iOS 18.0, *)
struct WakeMateControlConfigurationIntent: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Wake PC Control"
    static let description = IntentDescription("Choose the computer this Control Center button should wake.")

    @Parameter(title: "Device")
    var device: WakeMateDeviceEntity?
}

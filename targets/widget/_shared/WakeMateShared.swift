import AppIntents
import Foundation

enum WakeMateSharedConstants {
    static let appGroup = "group.com.anonymous.wakematemobile"
    static let devicesKey = "wakemate.devices"
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

enum WakeMateSharedStore {
    static func devices() -> [WakeMateSharedDevice] {
        guard
            let defaults = UserDefaults(suiteName: WakeMateSharedConstants.appGroup),
            let data = defaults.data(forKey: WakeMateSharedConstants.devicesKey)
        else {
            return []
        }

        do {
            let decodedDevices = try JSONDecoder().decode([WakeMateSharedDevice].self, from: data)
            return decodedDevices.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        } catch {
            return []
        }
    }

    static func device(id: String?) -> WakeMateSharedDevice? {
        guard let id, !id.isEmpty else {
            return nil
        }

        return devices().first { $0.id == id }
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

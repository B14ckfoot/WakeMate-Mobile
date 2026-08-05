import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct WakeMateControlWidget: ControlWidget {
    static let kind: String = WakeMateSharedConstants.controlKind

    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(
            kind: Self.kind,
            intent: WakeMateControlConfigurationIntent.self
        ) { configuration in
            // Unconfigured controls fall back to the favorite chosen in the
            // app, then to the first saved computer, so the button works the
            // moment it is added.
            let resolution = WakeMateSharedStore.resolve(configuredID: configuration.device?.id)

            // Whatever this says is what the press wakes: the resolved ID goes
            // straight into the intent rather than being resolved again later.
            ControlWidgetButton(action: WakeMateWakeDeviceIntent(deviceID: resolution.device?.id)) {
                Label(
                    Self.title(for: resolution),
                    systemImage: resolution.device == nil ? "power.circle" : "power.circle.fill"
                )
            }
        }
        .displayName("Wake PC")
        .description("Wake a saved computer from Control Center.")
    }

    private static func title(for resolution: WakeMateDeviceResolution) -> String {
        switch resolution {
        case let .resolved(device, _):
            return device.name
        case .configuredDeviceMissing:
            return "Computer Removed"
        case .noDevices:
            return "Add a Computer"
        }
    }
}

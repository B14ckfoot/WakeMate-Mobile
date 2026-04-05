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
            let selectedDevice = WakeMateSharedStore.device(id: configuration.device?.id)
            let deviceName = selectedDevice?.name ?? configuration.device?.name ?? "Choose Device"

            ControlWidgetButton(
                action: OpenURLIntent(
                    WakeMateDeepLink.wakeURL(for: selectedDevice?.id ?? configuration.device?.id)
                )
            ) {
                Label(deviceName, systemImage: selectedDevice == nil ? "power.circle" : "power.circle.fill")
            }
        }
        .displayName("Wake PC")
        .description("Wake a saved computer from Control Center.")
    }
}

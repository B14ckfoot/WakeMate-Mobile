import AppIntents
import WidgetKit
import SwiftUI

@available(iOS 17.0, *)
struct WakeMateWidgetEntry: TimelineEntry {
    let date: Date
    let resolution: WakeMateDeviceResolution
    let lastWake: WakeMateLastWake.Record?

    var device: WakeMateSharedDevice? {
        resolution.device
    }

    var displayName: String {
        switch resolution {
        case let .resolved(device, _):
            return device.name
        case .configuredDeviceMissing:
            return "Computer Removed"
        case .noDevices:
            return "No Computers Yet"
        }
    }

    /// What the button will do, phrased for the person looking at it.
    var actionTitle: String {
        device == nil ? "Open WakeMATE" : "Wake"
    }

    /// Tapping anywhere outside the wake button opens the app: the device
    /// screen when there is one, the list when there is not.
    var containerURL: URL {
        guard let device else {
            return WakeMateDeepLink.devicesURL
        }

        return WakeMateDeepLink.wakeURL(for: device.id)
    }
}

@available(iOS 17.0, *)
struct WakeMateWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WakeMateWidgetEntry {
        // Deliberately the same resolution a placed widget uses. When the
        // gallery preview showed the first computer but the placed widget
        // resolved to nothing, the widget looked broken rather than
        // unconfigured.
        makeEntry(configuredID: nil)
    }

    func snapshot(for configuration: WakeMateWidgetConfigurationIntent, in context: Context) async -> WakeMateWidgetEntry {
        makeEntry(configuredID: configuration.device?.id)
    }

    func timeline(for configuration: WakeMateWidgetConfigurationIntent, in context: Context) async -> Timeline<WakeMateWidgetEntry> {
        let entry = makeEntry(configuredID: configuration.device?.id)

        guard let lastWake = entry.lastWake else {
            // Nothing time-sensitive on screen. Every input that changes this
            // widget (a press, a device edit in the app) reloads it explicitly.
            return Timeline(entries: [entry], policy: .never)
        }

        // Retire the "just sent" line on its own rather than leaving a stale
        // result on the Home Screen indefinitely.
        let expiry = lastWake.sentAt.addingTimeInterval(WakeMateLastWake.displaySeconds)
        return Timeline(
            entries: [
                entry,
                WakeMateWidgetEntry(date: expiry, resolution: entry.resolution, lastWake: nil),
            ],
            policy: .never
        )
    }

    private func makeEntry(configuredID: String?) -> WakeMateWidgetEntry {
        let resolution = WakeMateSharedStore.resolve(configuredID: configuredID)

        return WakeMateWidgetEntry(
            date: Date(),
            resolution: resolution,
            lastWake: resolution.device.flatMap { WakeMateLastWake.current(for: $0.id) }
        )
    }
}

@available(iOS 17.0, *)
struct WakeMateWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family

    let entry: WakeMateWidgetEntry

    private var accent: Color {
        Color(red: 0.20, green: 0.82, blue: 0.48)
    }

    private var iconName: String {
        switch entry.resolution {
        case .resolved:
            return entry.lastWake?.didSend == false ? "exclamationmark.triangle.fill" : "power.circle.fill"
        case .configuredDeviceMissing, .noDevices:
            return "power.circle"
        }
    }

    /// Never claims the computer is awake — only that the packet left the
    /// phone. Whether it actually booted is the companion's answer to give.
    @ViewBuilder
    private var subtitle: some View {
        switch entry.resolution {
        case let .resolved(device, _):
            if let lastWake = entry.lastWake {
                if lastWake.didSend {
                    Text("Magic packet sent ") + Text(lastWake.sentAt, style: .relative) + Text(" ago")
                } else {
                    Text("Couldn't send. Open WakeMATE to finish.")
                }
            } else if device.status == "online" {
                Text("Last seen online on \(device.ip)")
            } else {
                Text("Ready to wake on \(device.ip)")
            }
        case .configuredDeviceMissing:
            Text("Hold this widget to pick another computer.")
        case .noDevices:
            Text("Add a computer in WakeMATE to wake it from here.")
        }
    }

    /// The whole point of the widget: send the packet from the extension
    /// instead of launching the app to do it. Falls back to a plain tap-to-open
    /// when there is nothing to wake.
    @ViewBuilder
    private func wakeButton<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        if let device = entry.device {
            Button(intent: WakeMateWakeDeviceIntent(deviceID: device.id), label: label)
                .buttonStyle(.plain)
        } else {
            label()
        }
    }

    var body: some View {
        Group {
            switch family {
#if os(iOS)
            case .accessoryInline:
                // Inline accessories cannot host controls, so this one stays a
                // deep link into the app.
                Text(entry.device == nil ? "WakeMATE" : "Wake \(entry.displayName)")
            case .accessoryCircular:
                wakeButton {
                    ZStack {
                        AccessoryWidgetBackground()

                        Image(systemName: iconName)
                            .font(.system(size: 20, weight: .semibold))
                    }
                }
                .accessibilityLabel(
                    entry.device == nil ? "Open WakeMATE" : "Wake \(entry.displayName)"
                )
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Label("Wake PC", systemImage: iconName)
                        .font(.caption2.weight(.semibold))

                    wakeButton {
                        Text(entry.displayName)
                            .font(.headline)
                            .lineLimit(1)
                    }

                    subtitle
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
#endif
            default:
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: iconName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(accent)

                        Text("Wake PC")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white.opacity(0.85))
                    }

                    Spacer(minLength: 0)

                    Text(entry.displayName)
                        .font(family == .systemSmall ? .headline.weight(.bold) : .title3.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)

                    subtitle
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.74))
                        .lineLimit(2)

                    Spacer(minLength: 0)

                    wakeButton {
                        HStack {
                            Text(entry.actionTitle)
                                .font(.caption.weight(.bold))

                            Spacer(minLength: 8)

                            Image(systemName: entry.device == nil ? "arrow.up.right.circle.fill" : "power.circle.fill")
                                .font(.headline)
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity)
                        .background(
                            Capsule()
                                .fill(accent.opacity(entry.device == nil ? 0.42 : 0.82))
                        )
                    }
                    .accessibilityLabel(
                        entry.device == nil ? "Open WakeMATE" : "Wake \(entry.displayName)"
                    )
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .containerBackground(
                    LinearGradient(
                        colors: [
                            Color(red: 0.06, green: 0.07, blue: 0.11),
                            Color(red: 0.11, green: 0.08, blue: 0.20),
                            Color(red: 0.05, green: 0.16, blue: 0.14)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    for: .widget
                )
            }
        }
        .widgetURL(entry.containerURL)
    }
}

@available(iOS 17.0, *)
struct WakeMateWidget: Widget {
    let kind: String = WakeMateSharedConstants.widgetKind

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: WakeMateWidgetConfigurationIntent.self,
            provider: WakeMateWidgetProvider()
        ) { entry in
            WakeMateWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Wake PC")
        .description("Wake a saved computer from your Home Screen or Lock Screen.")
        .supportedFamilies(Self.supportedFamilies)
    }

    private static var supportedFamilies: [WidgetFamily] {
#if os(iOS)
        [
            .systemSmall,
            .systemMedium,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular
        ]
#else
        [
            .systemSmall,
            .systemMedium
        ]
#endif
    }
}

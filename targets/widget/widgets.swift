import WidgetKit
import SwiftUI

@available(iOS 17.0, *)
struct WakeMateWidgetEntry: TimelineEntry {
    let date: Date
    let resolvedDevice: WakeMateSharedDevice?
    let configuredDevice: WakeMateDeviceEntity?

    var displayName: String {
        resolvedDevice?.name ?? configuredDevice?.name ?? "Wake a Device"
    }

    var subtitle: String {
        if let resolvedDevice {
            return resolvedDevice.status == "online"
                ? "Last seen online on \(resolvedDevice.ip)"
                : "Magic packet ready for \(resolvedDevice.ip)"
        }

        return "Tap to open WakeMATE and choose a saved computer."
    }

    var wakeURL: URL {
        WakeMateDeepLink.wakeURL(for: resolvedDevice?.id ?? configuredDevice?.id)
    }
}

@available(iOS 17.0, *)
struct WakeMateWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WakeMateWidgetEntry {
        WakeMateWidgetEntry(
            date: Date(),
            resolvedDevice: WakeMateSharedStore.devices().first,
            configuredDevice: nil
        )
    }

    func snapshot(for configuration: WakeMateWidgetConfigurationIntent, in context: Context) async -> WakeMateWidgetEntry {
        makeEntry(for: configuration)
    }

    func timeline(for configuration: WakeMateWidgetConfigurationIntent, in context: Context) async -> Timeline<WakeMateWidgetEntry> {
        Timeline(entries: [makeEntry(for: configuration)], policy: .never)
    }

    private func makeEntry(for configuration: WakeMateWidgetConfigurationIntent) -> WakeMateWidgetEntry {
        WakeMateWidgetEntry(
            date: Date(),
            resolvedDevice: WakeMateSharedStore.device(id: configuration.device?.id),
            configuredDevice: configuration.device
        )
    }
}

@available(iOS 17.0, *)
struct WakeMateWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family

    let entry: WakeMateWidgetEntry

    var body: some View {
        Group {
            switch family {
            case .accessoryInline:
                Text(entry.resolvedDevice == nil ? "WakeMATE" : "Wake \(entry.displayName)")
            case .accessoryCircular:
                ZStack {
                    Circle()
                        .fill(Color(red: 0.20, green: 0.82, blue: 0.48).opacity(0.18))

                    Image(systemName: entry.resolvedDevice == nil ? "power.circle" : "power.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color(red: 0.20, green: 0.82, blue: 0.48))
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 4) {
                    Label("Wake PC", systemImage: "power.circle.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color(red: 0.20, green: 0.82, blue: 0.48))

                    Text(entry.displayName)
                        .font(.headline)
                        .lineLimit(1)

                    Text(entry.subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            default:
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: entry.resolvedDevice == nil ? "power.circle" : "power.circle.fill")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color(red: 0.20, green: 0.82, blue: 0.48))

                        Text("Wake PC")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white.opacity(0.85))
                    }

                    Spacer(minLength: 0)

                    Text(entry.displayName)
                        .font(family == .systemSmall ? .headline.weight(.bold) : .title3.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)

                    Text(entry.subtitle)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.74))
                        .lineLimit(2)

                    Spacer(minLength: 0)

                    HStack {
                        Text(entry.resolvedDevice == nil ? "Open WakeMATE" : "Send Magic Packet")
                            .font(.caption.weight(.bold))

                        Spacer(minLength: 8)

                        Image(systemName: "arrow.up.right.circle.fill")
                            .font(.headline)
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        Capsule()
                            .fill(Color(red: 0.20, green: 0.82, blue: 0.48).opacity(0.82))
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
        .widgetURL(entry.wakeURL)
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
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular
        ])
    }
}

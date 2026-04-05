import WidgetKit
import SwiftUI

@main
struct WakeMateWidgetsBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 17.0, *) {
            WakeMateWidget()
        }

        if #available(iOS 18.0, *) {
            WakeMateControlWidget()
        }
    }
}

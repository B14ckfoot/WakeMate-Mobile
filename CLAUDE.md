# WakeMATE Mobile

## Product

- This Expo app and `B14ckfoot/WakeMATE-Companion` form one local-network protocol ecosystem.
- The phone discovers, pairs with, wakes, monitors, and remotely controls computers that the desktop user approved.
- Wake-on-LAN and offline waking are core. Online state must come from the companion, never optimistic UI state.
- Favor a professional, dependable flow that a nontechnical user can complete with few steps. Normal pairing must not require config editing or manual token copying, and desktop approval remains explicit.
- Prefer local operation. Do not add cloud accounts, analytics, telemetry, ads, or third-party tracking without explicit user approval.
- Treat security and privacy as product requirements. Never weaken authentication, certificate verification, credential storage, approval, command authorization, or OS security to make a flow appear successful.

## Architecture

- Expo Router + React Native + TypeScript; primary platform iOS, with Android kept functional.
- Routes and screens are primarily in `app/`; reusable UI in `src/components/`; companion/device APIs in `src/services/`; shared connection state in `src/context/`.
- Device records and non-secret connection metadata use AsyncStorage; per-device tokens and TLS fingerprints use Expo SecureStore through `src/services/companionCredentials.ts`.
- Native pinned HTTPS is implemented by `modules/wakemate-tls/`. Expo Go is not a complete test environment.
- Native changes require rebuilding the development app; restarting Metro is insufficient.
- The iOS widget lives in `targets/widget/` and shares the app group `group.com.anonymous.wakematemobile`.

## Commands

- Install dependencies and reapply patches: `npm install`
- Start Metro: `npm start`
- Build/run iOS development app: `npx expo run:ios`; after it exists, `npm run ios` starts the iOS Metro flow.
- Build/run Android development app: `npx expo run:android`; after it exists, `npm run android` starts the Android Metro flow.
- Lint: `npm run lint`
- TypeScript: `npm run typecheck`
- CI Jest suite: `npm run test:ci`
- Verify generated iOS invariants: `npm run verify:ios`
- Practical full gate: run lint, typecheck, `test:ci`, and `verify:ios` separately so failures stay clear.

## Native-project safety

- Treat `ios/` and `android/` as generated Expo native projects. Prefer config plugins, templates, `patch-package` patches, and generation/verification scripts over unexplained manual Xcode or Gradle edits.
- Before a clean prebuild, inspect `app.json`, `plugins/`, `templates/`, `patches/`, `targets/`, and `scripts/verify-ios-project.js`; they reconstruct intentional native changes.
- After iOS native changes, run `npm run verify:ios` and rebuild the app.
- Preserve `ios/WakeMATE.xcworkspace`, the shared `WakeMATE` scheme, `WakeMateWidgets`, app groups, bundle identifiers, signing behavior, physical-device Debug bundling, and iOS-only target restrictions. Open the workspace, not the `.xcodeproj`.
- Guard platform-specific behavior. Android changes must not break iOS; iOS changes must not silently break Android.

## Engineering rules

- Inspect relevant implementation first, state the probable root cause before a broad rewrite, and prefer the smallest complete fix.
- Reuse established components, styles, services, storage abstractions, context, and Expo Router patterns. Keep screens efficient without sacrificing readability or accessible touch targets.
- Show truthful loading, approval, denied, offline, timeout, unsupported, and error states. Never infer success merely from dispatching a request.
- Trace pairing/status defects across QR parsing -> device identity/storage -> TLS activation -> desktop approval -> polling -> status UI.
- Preserve per-device SecureStore credentials and migrations. Do not restore or broaden insecure transport fallback without explicit architectural justification and user approval.
- For QR, discovery, pairing, authentication, ports, commands, status, or protocol changes, find every producer and consumer and review the companion repository too. Update contract tests and documentation.
- Never claim an unsupported OS action succeeded. Never commit secrets, signing credentials, certificates, private keys, tokens, provisioning profiles, or machine-specific paths.
- Run the narrowest relevant checks first, then the practical full gate. Do not suppress errors, warnings, lint rules, or tests just to get green output.
- Never discard unrelated work or use destructive Git commands. Do not commit, push, tag, publish, or alter signing configuration unless the user explicitly asks.

## Session handoff

- Report the root cause, files changed, commands/tests and results, remaining limitations, and unavoidable manual steps.
- Use Claude auto memory only for durable, non-obvious recurring discoveries (verified fixes, build constraints, platform environment details, or stable architecture not suited here). Never store secrets, speculation, logs, temporary status, manifest-obvious facts, duplicated instructions, or completed-task narratives. Keep the index concise and move detailed recurring notes into topic files.

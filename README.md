# WakeMate Mobile

WakeMate Mobile is the Expo/React Native app for waking, pairing, and remotely controlling your computers.

## What You Need

- Node.js 20 or newer
- `npm`
- A Mac with Xcode installed if you want to run the iOS simulator
- Android Studio if you want to run Android locally

## Clone And Run

```bash
git clone https://github.com/B14ckfoot/WakeMate-Mobile.git
cd WakeMate-Mobile
npm install
npx expo start
```

After Metro starts:

- Press `i` to open the iOS simulator on a Mac
- Press `a` to open Android
- Press `w` to open the web build

## Recommended Dev Path

This app uses native modules, so the safest local path is:

- iOS simulator on Mac
- Android emulator
- a development build on a physical device

If Expo Go shows native-module errors, use the simulator or run a native build:

```bash
npx expo run:ios
```

or

```bash
npx expo run:android
```

## Running On A New MacBook

1. Install Xcode from the App Store.
2. Open Xcode once so it finishes first-run setup.
3. Install Node.js.
4. Clone this repo.
5. Run `npm install`.
6. Run `npx expo start`.
7. Press `i` for the iOS simulator.

If the simulator build has never been created on that machine yet, run:

```bash
npx expo run:ios
```

Then start Metro again with:

```bash
npx expo start
```

## Scripts

- `npm start` or `npx expo start`: start Metro
- `npm run ios`: start Expo and open iOS flow
- `npm run android`: start Expo and open Android flow
- `npm run web`: run the web build
- `npm run lint`: run lint checks

## Companion Setup

The mobile app needs the WakeMate Companion running on the computer you want to control, and both devices must be on the same Wi-Fi/LAN.

For remote control features to work:

1. Install and start the desktop companion on the target computer (Windows tray app).
2. On the desktop, click the WakeMATE tray icon and choose **View Pairing QR Code**.
3. In the mobile app, scan that QR code — either from **Add device → Scan QR** (saves the computer and pairs in one scan) or from **Settings** via the camera button next to the pairing-token field. The QR (pairing contract v2) carries the device name, IP, port, MAC, and token.
4. Approve the pairing dialog that appears **on the desktop**. The app polls the companion and shows the real outcome (approved, denied, or still waiting).
5. Add or discover any additional devices inside the app.

Notes:

- Do **not** try to copy `api_token` out of `wakemate.config.json` — on a healthy install the companion stores the token in the OS credential store and that file's `api_token` field is intentionally empty. Scanning the QR is the supported path.
- Companions older than protocol v2 show a bare-token QR that only the **Settings** scanner can read, and they lack the `/v1/pairing/status` endpoint (the app then falls back to the older optimistic pairing behavior).
- Background and findings: see `WAKE_MATE_COMPANION_ARCHITECTURE_AUDIT.md` in the parent folder.

Without the companion server, you can still work on the UI, but remote input and control actions will not complete.

## Troubleshooting

- If dependencies act strange after pulling fresh changes, delete `node_modules` and run `npm install` again.
- If iOS will not boot from Expo alone, run `npx expo run:ios` once to generate the native build.
- If device controls fail, make sure the companion IP and token in Settings match the target computer.

## Project Structure

- `app/`: Expo Router screens
- `src/components/`: reusable UI
- `src/services/`: device and companion API logic
- `src/context/`: shared app state



 
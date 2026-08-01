import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { ServerProvider } from "../src/context/ServerContext";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import deviceService from '../src/services/deviceService';
import { usePendingWidgetWake } from '../src/widget/pendingWidgetWake';
import CompanionSetupPrompt from '../src/components/CompanionSetupPrompt';

export default function RootLayout() {
  useEffect(() => {
    void deviceService.syncWidgetData();
  }, []);

  // Picks up a wake the Control Center button could not send itself.
  usePendingWidgetWake();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ServerProvider>
        <Stack
          screenOptions={{
            headerShown: false, // We'll handle our own headers in each screen
            contentStyle: {
              backgroundColor: '#05090c',
            }
          }}
        />
        <CompanionSetupPrompt />
      </ServerProvider>
    </SafeAreaProvider>
  );
}

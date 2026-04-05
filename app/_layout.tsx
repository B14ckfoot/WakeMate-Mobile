import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { ServerProvider } from "../src/context/ServerContext";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import deviceService from '../src/services/deviceService';

export default function RootLayout() {
  useEffect(() => {
    void deviceService.syncWidgetData();
  }, []);

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
      </ServerProvider>
    </SafeAreaProvider>
  );
}

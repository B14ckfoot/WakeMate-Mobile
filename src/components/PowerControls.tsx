// src/components/PowerControls.tsx
import React from "react";
import { View, TouchableOpacity, Text } from "react-native";
import { Zap, Moon } from "lucide-react-native";
import deviceService from "../services/deviceService";
import { Device } from "../../src/types/device";

export default function PowerControls({ device }: { device: Device }) {
  return (
    <View style={{ flexDirection: "row", gap: 24 }}>
      <TouchableOpacity
        onPress={() => deviceService.wakeMachine(device)}
        style={{ alignItems: "center" }}
      >
        <Zap size={32} />
        <Text>Wake</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => deviceService.sendSleep(device.id, device.ip)}
        style={{ alignItems: "center" }}
      >
        <Moon size={32} />
        <Text>Sleep</Text>
      </TouchableOpacity>
    </View>
  );
}

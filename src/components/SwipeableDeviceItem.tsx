import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { Device } from '../../src/types/device';
import { Trash2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';

interface SwipeableDeviceItemProps {
  device: Device;
  onDelete: (id: string) => void;
  onLongPress?: (device: Device) => void;
}

const SwipeableDeviceItem: React.FC<SwipeableDeviceItemProps> = ({ 
  device, 
  onDelete,
  onLongPress 
}) => {
  const router = useRouter();
  const translateX = useRef(new Animated.Value(0)).current;
  const translateXValue = useRef(0);

  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      translateXValue.current = value;
    });

    return () => {
      translateX.removeListener(listenerId);
    };
  }, [translateX]);

  const gestureHandler = Animated.event(
    [{ nativeEvent: { translationX: translateX } }],
    { useNativeDriver: true }
  );

  const onHandlerStateChange = ({ nativeEvent }: PanGestureHandlerStateChangeEvent) => {
    if (nativeEvent.oldState === State.ACTIVE) {
      // Check if swipe was enough to trigger delete button reveal
      const dragX = nativeEvent.translationX;
      const transX = dragX < -80 ? -80 : 0;
      
      Animated.spring(translateX, {
        toValue: transX,
        useNativeDriver: true,
        bounciness: 0
      }).start();
    }
  };

  const handleDelete = () => {
    // Reset the card position before actually removing it
    Animated.timing(translateX, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true
    }).start(() => {
      onDelete(device.id);
    });
  };

  const handlePress = () => {
    // Only navigate if the card isn't swiped open
    const currentValue = translateXValue.current;
    if (currentValue === 0) {
      router.push(`/devices/${device.id}`);
    } else {
      // Reset swipe position if swiped open and tapped
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true
      }).start();
    }
  };

  const handleLongPress = () => {
    if (onLongPress) {
      // Reset swipe position first
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true
      }).start(() => {
        onLongPress(device);
      });
    }
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Underlying delete button */}
      <View style={styles.deleteButtonContainer}>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Trash2 size={20} color="#ffffff" />
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Main card content */}
      <PanGestureHandler
        onGestureEvent={gestureHandler}
        onHandlerStateChange={onHandlerStateChange}
      >
        <Animated.View 
          style={[
            styles.deviceItem,
            { transform: [{ translateX }] }
          ]}
        >
          <TouchableOpacity 
            style={styles.deviceItemContent} 
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={500}
            activeOpacity={0.8}
          >
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{device.name}</Text>
              <Text style={styles.deviceIp}>{device.ip}</Text>
            </View>
            <View style={styles.statusContainer}>
              <View style={[
                styles.statusIndicator, 
                { backgroundColor: device.status === 'online' ? '#4ade80' : '#6b7280' }
              ]} />
              <Text style={styles.statusText}>
                {device.status === 'online' ? 'Online' : 'Offline'}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </PanGestureHandler>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  deviceItem: {
    backgroundColor: '#0b1217',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#16313a',
    width: '100%',
    zIndex: 1,
  },
  deviceItemContent: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  deviceInfo: {
    flex: 1,
    paddingRight: 8,
  },
  deviceName: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  deviceIp: {
    color: '#7f97a1',
    fontSize: 14,
    lineHeight: 20,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    maxWidth: '40%',
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    color: '#7f97a1',
    fontSize: 14,
    flexShrink: 1,
  },
  deleteButtonContainer: {
    position: 'absolute',
    right: 0,
    height: '100%',
    width: 80,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteText: {
    color: '#ffffff',
    fontSize: 14,
    marginTop: 4,
  },
});

export default SwipeableDeviceItem;

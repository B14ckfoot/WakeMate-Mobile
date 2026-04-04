import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Animated,
  TextInput,
  Keyboard,
  Dimensions,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { ArrowLeft, MousePointer, Keyboard as KeyboardIcon, Music, Power, Moon, RefreshCw, LogOut, Settings } from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  State,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';
import { Device } from '../../../src/types/device';
import deviceService from '../../../src/services/deviceService';

export default function DeviceControlScreen() {
  const params = useLocalSearchParams();
  const id = params.id as string;
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mouse' | 'keyboard' | 'media' | 'power'>('mouse');
  const [isScrolling, setIsScrolling] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  
  // Navigate to settings screen
  const goToSettings = () => {
    router.push('/settings');
  };
  
  // Handle back navigation
  const handleBack = () => {
    router.back();
  };
  
  // For touchpad handling
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  
  // Reference to the keyboard input
  const keyboardInputRef = useRef<TextInput>(null);
  
  // Monitor keyboard visibility
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
      }
    );
    const keyboardDidHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  // Focus the input when keyboard tab is activated
  useEffect(() => {
    if (activeTab === 'keyboard' && keyboardInputRef.current) {
      // Add a slight delay to ensure the component is fully rendered
      const timeout = setTimeout(() => {
        keyboardInputRef.current?.focus();
      }, 100);
      
      return () => clearTimeout(timeout);
    }
  }, [activeTab]);

  useEffect(() => {
    const fetchDevice = async () => {
      try {
        const devices = await deviceService.getDevices();
        const foundDevice = devices.find(d => d.id === id);
        if (foundDevice) {
          setDevice(foundDevice);
        } else {
          alert('Device not found');
          router.back();
        }
      } catch (error) {
        console.error('Error loading device:', error);
        alert('Failed to load device');
      } finally {
        setLoading(false);
      }
    };

    fetchDevice();
  }, [id]);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: panX, translationY: panY } }],
    { useNativeDriver: true }
  );

  const onHandlerStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      // Send mouse movement to device
      const dx = event.nativeEvent.translationX;
      const dy = event.nativeEvent.translationY;
      
      if (device) {
        deviceService.sendMouseMove(device.id, device.ip, dx, dy)
          .catch(err => console.error('Error sending mouse move:', err));
      }
      
      // Reset animated values
      panX.setValue(0);
      panY.setValue(0);
    }
  };

  const handleMouseClick = (button: 'left' | 'right') => {
    if (device) {
      deviceService.sendMouseClick(device.id, device.ip, button)
        .catch(err => console.error(`Error sending ${button} click:`, err));
    }
  };
  
  const handleMediaCommand = (command: string) => {
    if (!device) return;
    
    switch (command) {
      case 'play_pause':
        deviceService.sendMediaPlayPause(device.id, device.ip)
          .then(() => setIsPlaying(!isPlaying))
          .catch(err => console.error('Error sending play/pause:', err));
        break;
      case 'next':
        deviceService.sendMediaNext(device.id, device.ip)
          .catch(err => console.error('Error sending next track:', err));
        break;
      case 'previous':
        deviceService.sendMediaPrevious(device.id, device.ip)
          .catch(err => console.error('Error sending previous track:', err));
        break;
      case 'volume_up':
        deviceService.sendVolumeUp(device.id, device.ip)
          .catch(err => console.error('Error sending volume up:', err));
        break;
      case 'volume_down':
        deviceService.sendVolumeDown(device.id, device.ip)
          .catch(err => console.error('Error sending volume down:', err));
        break;
      case 'mute':
        deviceService.sendVolumeMute(device.id, device.ip)
          .catch(err => console.error('Error sending mute:', err));
        break;
    }
  };
  
  const handlePowerCommand = (command: string) => {
    if (!device) return;
    
    switch (command) {
      case 'sleep':
        deviceService.sendSleep(device.id, device.ip)
          .catch(err => console.error('Error sending sleep command:', err));
        break;
      case 'restart':
        deviceService.sendRestart(device.id, device.ip)
          .catch(err => console.error('Error sending restart command:', err));
        break;
      case 'shutdown':
        deviceService.sendShutdown(device.id, device.ip)
          .catch(err => console.error('Error sending shutdown command:', err));
        break;
      case 'logoff':
        // Assuming you add a logoff command to deviceService
        console.log('Log off command not implemented yet');
        break;
    }
  };
  
  const renderPowerControls = () => (
    <View style={styles.powerContainer}>
      <TouchableOpacity
        style={styles.powerButton}
        onPress={() => handlePowerCommand('sleep')}
      >
        <Moon size={24} color="#ffffff" />
        <Text style={styles.powerButtonText}>Sleep</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.powerButton}
        onPress={() => handlePowerCommand('restart')}
      >
        <RefreshCw size={24} color="#ffffff" />
        <Text style={styles.powerButtonText}>Restart</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.powerButton}
        onPress={() => handlePowerCommand('shutdown')}
      >
        <Power size={24} color="#ffffff" />
        <Text style={styles.powerButtonText}>Shutdown</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={styles.powerButton}
        onPress={() => handlePowerCommand('logoff')}
      >
        <LogOut size={24} color="#ffffff" />
        <Text style={styles.powerButtonText}>Log Off</Text>
      </TouchableOpacity>
    </View>
  );
  
  const renderMediaControls = () => (
    <View style={styles.mediaContainer}>
      <View style={styles.mediaRow}>
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaCommand('previous')}
        >
          <Text style={styles.mediaButtonText}>⏮</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.mediaButton, styles.playButton]}
          onPress={() => handleMediaCommand('play_pause')}
        >
          <Text style={styles.mediaButtonText}>{isPlaying ? "⏸" : "▶"}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaCommand('next')}
        >
          <Text style={styles.mediaButtonText}>⏭</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.mediaRow}>
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaCommand('volume_down')}
        >
          <Text style={styles.mediaButtonText}>🔉</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaCommand('mute')}
        >
          <Text style={styles.mediaButtonText}>🔇</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.mediaButton}
          onPress={() => handleMediaCommand('volume_up')}
        >
          <Text style={styles.mediaButtonText}>🔊</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const showKeyboard = () => {
    setActiveTab('keyboard');
    // Force focus with a slight delay for iOS
    setTimeout(() => {
      if (keyboardInputRef.current) {
        keyboardInputRef.current.focus();
      }
    }, 50);
  };

  const handleKeyboardSubmit = () => {
    if (!device || !keyboardText) return;
    
    deviceService.sendKeyboardInput(device.id, device.ip, keyboardText)
      .catch(err => console.error('Error sending keyboard input:', err));
    
    // Clear the input after sending
    setKeyboardText('');
  };

  if (loading || !device) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>
          {loading ? 'Loading...' : 'Device not found'}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {/* Header with device name and back button */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <ArrowLeft size={24} color="#7c3aed" />
        </TouchableOpacity>
        <Text style={styles.title}>{device.name}</Text>
        <TouchableOpacity onPress={goToSettings} style={styles.settingsButton}>
          <Settings size={22} color="#7c3aed" />
        </TouchableOpacity>
      </View>

      {/* Main content area */}
      <View style={[
        styles.content,
        keyboardVisible && styles.contentWithKeyboard
      ]}>
        {/* Touchpad area */}
        {activeTab !== 'keyboard' && (
          <GestureHandlerRootView style={styles.touchpadWrapper}>
            <PanGestureHandler
              onGestureEvent={onGestureEvent}
              onHandlerStateChange={onHandlerStateChange}
            >
              <Animated.View style={styles.touchpad}>
                {isScrolling ? (
                  <Text style={styles.touchpadText}>Scrolling...</Text>
                ) : (
                  <MousePointer size={32} color="#7c3aed" style={{ opacity: 0.7 }} />
                )}
              </Animated.View>
            </PanGestureHandler>
          </GestureHandlerRootView>
        )}

        {/* Mouse buttons */}
        {activeTab !== 'keyboard' && (
          <View style={styles.mouseButtons}>
            <TouchableOpacity
              style={styles.mouseButton}
              onPress={() => handleMouseClick('left')}
            />
            <TouchableOpacity
              style={styles.mouseButton}
              onPress={() => handleMouseClick('right')}
            />
          </View>
        )}

        {/* Control buttons */}
        <View style={styles.controlButtons}>
          <TouchableOpacity
            style={[styles.controlButton, activeTab === 'mouse' && styles.activeButton]}
            onPress={() => setActiveTab('mouse')}
          >
            <MousePointer size={20} color={activeTab === 'mouse' ? "#7c3aed" : "#a0a0a0"} />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, activeTab === 'keyboard' && styles.activeButton]}
            onPress={showKeyboard}
          >
            <KeyboardIcon size={20} color={activeTab === 'keyboard' ? "#7c3aed" : "#a0a0a0"} />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, activeTab === 'media' && styles.activeButton]}
            onPress={() => setActiveTab('media')}
          >
            <Music size={20} color={activeTab === 'media' ? "#7c3aed" : "#a0a0a0"} />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, activeTab === 'power' && styles.activeButton]}
            onPress={() => setActiveTab('power')}
          >
            <Power size={20} color={activeTab === 'power' ? "#7c3aed" : "#a0a0a0"} />
          </TouchableOpacity>
        </View>

        {/* Conditional content based on active tab */}
        {activeTab === 'media' && renderMediaControls()}
        {activeTab === 'power' && renderPowerControls()}
        
        {/* Keyboard input container */}
        {activeTab === 'keyboard' && (
          <View style={styles.keyboardContainer}>
            <View style={styles.inputWrapper}>
              <TextInput
                ref={keyboardInputRef}
                style={styles.keyboardInput}
                value={keyboardText}
                onChangeText={setKeyboardText}
                placeholder="Type here and press send"
                placeholderTextColor="#a0a0a0"
                autoFocus={true}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.sendButton}
                onPress={handleKeyboardSubmit}
              >
                <Text style={styles.sendButtonText}>Send</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.keyboardHelp}>
              Text will be sent directly to the device
            </Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 30, // Increased padding for status bar
    paddingBottom: 12,
    justifyContent: 'space-between',
    backgroundColor: '#121212', // Match background to ensure opacity
    zIndex: 10, // Ensure header is above other elements
  },
  backButton: {
    marginRight: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  settingsButton: {
    padding: 8,
  },
  loadingText: {
    color: '#ffffff',
    textAlign: 'center',
    marginTop: 20,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  contentWithKeyboard: {
    paddingBottom: 0, // Reduce padding when keyboard is showing
  },
  touchpadWrapper: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
  },
  touchpad: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  touchpadText: {
    color: '#7c3aed',
    fontSize: 18,
    fontWeight: '600',
  },
  mouseButtons: {
    flexDirection: 'row',
    height: 50,
    marginBottom: 12,
  },
  mouseButton: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    marginHorizontal: 4,
    borderRadius: 6,
  },
  controlButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  controlButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e1e1e',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  activeButton: {
    backgroundColor: '#2d2d2d',
    borderWidth: 1,
    borderColor: '#7c3aed',
  },
  mediaContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
  },
  mediaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  mediaButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2d2d2d',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  playButton: {
    backgroundColor: '#7c3aed',
  },
  mediaButtonText: {
    fontSize: 24,
    color: '#ffffff',
  },
  powerContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
  },
  powerButton: {
    width: '48%',
    height: 80,
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  powerButtonText: {
    color: '#ffffff',
    marginTop: 8,
    fontSize: 14,
  },
  keyboardContainer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    flex: 1,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyboardInput: {
    flex: 1,
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 16,
  },
  keyboardHelp: {
    color: '#a0a0a0',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});

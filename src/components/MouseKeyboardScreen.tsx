import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  TextInput,
  ScrollView
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  MousePointer,
  Volume2,
  Volume,
  VolumeX,
  SkipBack,
  SkipForward,
  Play,
  Pause
} from 'lucide-react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

const MouseKeyboardScreen: React.FC = () => {
  useLocalSearchParams();
  const [activePanel, setActivePanel] = useState<'mouse' | 'keyboard' | 'media'>('mouse');
  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const isScrolling = false;
  
  // Animation for keyboard panel
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const mediaHeight = useRef(new Animated.Value(0)).current;
  
  // Toggle panels
  const toggleKeyboard = () => {
    if (activePanel !== 'keyboard') {
      setActivePanel('keyboard');
      Animated.timing(keyboardHeight, {
        toValue: 250,
        duration: 300,
        useNativeDriver: false
      }).start();
      
      // Hide media panel if open
      Animated.timing(mediaHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false
      }).start();
    } else {
      setActivePanel('mouse');
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false
      }).start();
    }
  };
  
  const toggleMedia = () => {
    if (activePanel !== 'media') {
      setActivePanel('media');
      Animated.timing(mediaHeight, {
        toValue: 150,
        duration: 300,
        useNativeDriver: false
      }).start();
      
      // Hide keyboard panel if open
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false
      }).start();
    } else {
      setActivePanel('mouse');
      Animated.timing(mediaHeight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false
      }).start();
    }
  };
  
  // Send commands
  const sendKeyboardInput = () => {
    if (!text) return;
    console.log('Sending keyboard input:', text);
    setText('');
  };
  
  const sendSpecialKey = (key: string) => {
    console.log('Sending special key:', key);
  };
  
  const sendMediaCommand = (command: string) => {
    console.log('Sending media command:', command);
    if (command === 'play_pause') {
      setIsPlaying(!isPlaying);
    }
  };
  
  return (
    <View style={styles.container}>
      {/* Touch Pad */}
      <GestureHandlerRootView style={styles.touchPadContainer}>
        <PanGestureHandler
          onGestureEvent={(event: PanGestureHandlerGestureEvent) => {
            // Handle pan gesture
            console.log('Pan gesture:', event.nativeEvent);
          }}
          onHandlerStateChange={(event: PanGestureHandlerStateChangeEvent) => {
            // Handle state change
            console.log('State change:', event.nativeEvent);
          }}
        >
          <Animated.View style={styles.touchPad}>
            {isScrolling ? (
              <Text style={styles.scrollingText}>Scrolling...</Text>
            ) : (
              <>
                <MousePointer size={32} color="#7c3aed" style={styles.pointerIcon} />
                <Text style={styles.touchPadText}>
                  • Tap for left click
                  {'\n'}• Slide to move cursor
                  {'\n'}• Two fingers to scroll
                </Text>
              </>
            )}
          </Animated.View>
        </PanGestureHandler>
      </GestureHandlerRootView>

      {/* Mouse Buttons */}
      <View style={styles.mouseButtonsContainer}>
        <TouchableOpacity
          style={styles.mouseButton}
          onPress={() => console.log('Left click')}
          activeOpacity={0.6}
        >
          <Text style={styles.mouseButtonText}>Left Click</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.mouseButton}
          onPress={() => console.log('Right click')}
          activeOpacity={0.6}
        >
          <Text style={styles.mouseButtonText}>Right Click</Text>
        </TouchableOpacity>
      </View>
      
      {/* Panel Toggle Buttons */}
      <View style={styles.panelToggles}>
        <TouchableOpacity
          style={[
            styles.panelToggle,
            activePanel === 'keyboard' && styles.activeToggle
          ]}
          onPress={toggleKeyboard}
        >
          <Text style={[
            styles.panelToggleText,
            activePanel === 'keyboard' && styles.activeToggleText
          ]}>Keyboard</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.panelToggle,
            activePanel === 'media' && styles.activeToggle
          ]}
          onPress={toggleMedia}
        >
          <Text style={[
            styles.panelToggleText,
            activePanel === 'media' && styles.activeToggleText
          ]}>Media</Text>
        </TouchableOpacity>
      </View>
      
      {/* Keyboard Panel */}
      <Animated.View 
        style={[
          styles.keyboardPanel,
          { height: keyboardHeight }
        ]}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder="Type here..."
            placeholderTextColor="#6b7280"
            onSubmitEditing={sendKeyboardInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={sendKeyboardInput}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.specialKeysContainer}
        >
          {['Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].map((key) => (
            <TouchableOpacity
              key={key}
              style={styles.specialKey}
              onPress={() => sendSpecialKey(key)}
            >
              <Text style={styles.specialKeyText}>{key}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>
      
      {/* Media Panel */}
      <Animated.View 
        style={[
          styles.mediaPanel,
          { height: mediaHeight }
        ]}
      >
        <View style={styles.mediaControls}>
          <TouchableOpacity
            style={styles.mediaButton}
            onPress={() => sendMediaCommand('previous')}
          >
            <SkipBack size={32} color="#ffffff" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.mediaButton, styles.playButton]}
            onPress={() => sendMediaCommand('play_pause')}
          >
            {isPlaying ? (
              <Pause size={32} color="#ffffff" />
            ) : (
              <Play size={32} color="#ffffff" />
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.mediaButton}
            onPress={() => sendMediaCommand('next')}
          >
            <SkipForward size={32} color="#ffffff" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.volumeControls}>
          <TouchableOpacity
            style={styles.volumeButton}
            onPress={() => sendMediaCommand('mute')}
          >
            <VolumeX size={24} color="#ffffff" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.volumeButton}
            onPress={() => sendMediaCommand('volume_down')}
          >
            <Volume size={24} color="#ffffff" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.volumeButton}
            onPress={() => sendMediaCommand('volume_up')}
          >
            <Volume2 size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  touchPadContainer: {
    flex: 1,
    marginBottom: 16,
    padding: 16,
  },
  touchPad: {
    flex: 1,
    backgroundColor: '#262626',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerIcon: {
    marginBottom: 16,
    opacity: 0.5,
  },
  touchPadText: {
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  scrollingText: {
    color: '#7c3aed',
    fontSize: 18,
    fontWeight: '600',
  },
  mouseButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  mouseButton: {
    backgroundColor: '#2d2d2d',
    borderRadius: 8,
    paddingVertical: 12,
    width: '48%',
    alignItems: 'center',
  },
  mouseButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  panelToggles: {
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  panelToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
    paddingVertical: 8,
  },
  activeToggle: {
    borderBottomWidth: 2,
    borderBottomColor: '#7c3aed',
  },
  panelToggleText: {
    color: '#a0a0a0',
    fontSize: 16,
  },
  activeToggleText: {
    color: '#7c3aed',
  },
  keyboardPanel: {
    backgroundColor: '#262626',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#333333',
    borderRadius: 8,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  specialKeysContainer: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  specialKey: {
    backgroundColor: '#333333',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  specialKeyText: {
    color: '#ffffff',
  },
  mediaPanel: {
    backgroundColor: '#262626',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  mediaControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  mediaButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7c3aed',
  },
  volumeControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 20,
  },
  volumeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333333',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
});

export default MouseKeyboardScreen;

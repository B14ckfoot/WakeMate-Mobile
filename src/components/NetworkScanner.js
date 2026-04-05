import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEnhancedAutoDiscoverServer } from '../hooks/useAutoDiscoverServer';

const NetworkScanner = ({ onServerFound }) => {
  const { 
    serverIp, 
    searching, 
    error, 
    retry, 
    currentSubnet,
    progress 
  } = useEnhancedAutoDiscoverServer();

  // Call the callback when server is found
  useEffect(() => {
    if (serverIp && onServerFound) {
      onServerFound(serverIp);
    }
  }, [serverIp, onServerFound]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Ionicons name="server-outline" size={20} color="#22d3ee" style={styles.icon} />
          <Text style={styles.title}>Server Discovery</Text>
        </View>
        {!searching && (
          <TouchableOpacity
            onPress={retry}
            style={styles.scanButton}
          >
            <Text style={styles.scanButtonText}>Scan Again</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {/* Status display */}
      <View style={styles.statusContainer}>
        {searching ? (
          <View style={styles.statusRow}>
            <Ionicons name="search" size={16} color="#FBBF24" style={[styles.statusIcon, styles.pulsing]} />
            <Text style={styles.scanningText}>
              Scanning network {currentSubnet && `(${currentSubnet}x)`}...
            </Text>
          </View>
        ) : serverIp ? (
          <View style={styles.statusRow}>
            <Ionicons name="checkmark-circle" size={16} color="#34D399" style={styles.statusIcon} />
            <Text style={styles.connectedText}>Server found at {serverIp}</Text>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Ionicons name="alert-circle" size={16} color="#F87171" style={styles.statusIcon} />
            <Text style={styles.errorText}>No server found on your network</Text>
          </View>
        )}
      </View>
      
      {/* Progress bar */}
      {searching && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View 
              style={[styles.progressFill, { width: `${progress}%` }]}
            />
          </View>
          <Text style={styles.progressText}>{progress}% complete</Text>
        </View>
      )}
      
      {/* Server IP display */}
      {serverIp && (
        <View style={styles.serverInfoContainer}>
          <Ionicons name="wifi" size={16} color="#34D399" style={styles.serverInfoIcon} />
          <View>
            <Text style={styles.serverIpText}>{serverIp}:7777</Text>
            <Text style={styles.serverSavedText}>Server address saved</Text>
          </View>
        </View>
      )}
      
      {/* Error message */}
      {error && !serverIp && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Server not found. Please check that:</Text>
          <View style={styles.errorList}>
            <Text style={styles.errorListItem}>• The server application is running on your computer</Text>
            <Text style={styles.errorListItem}>• Your computer and phone are connected to the same network</Text>
            <Text style={styles.errorListItem}>• Firewall settings are not blocking port 7777</Text>
          </View>
        </View>
      )}
      
      {/* Manual IP entry option */}
      {(error || !searching) && (
        <View style={styles.manualEntryContainer}>
          <Text style={styles.manualEntryText}>
            Alternatively, you can manually set your server IP in Settings
          </Text>
          <View style={styles.networkInfoRow}>
            <Text style={styles.networkLabel}>Supported networks:</Text>
            <Text style={styles.networkValue}>10.0.0.x, 192.168.0-5.x</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 8,
  },
  title: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  scanButton: {
    backgroundColor: '#0891b2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 12,
  },
  statusContainer: {
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    marginRight: 8,
  },
  pulsing: {
    opacity: 0.7, // Simple way to simulate pulsing without animation
  },
  scanningText: {
    color: '#FBBF24',
    fontSize: 14,
  },
  connectedText: {
    color: '#34D399',
    fontSize: 14,
  },
  errorText: {
    color: '#F87171',
    fontSize: 14,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 6,
    backgroundColor: '#374151',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#0891b2',
    borderRadius: 3,
  },
  progressText: {
    color: '#9CA3AF',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  serverInfoContainer: {
    backgroundColor: '#374151',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  serverInfoIcon: {
    marginRight: 8,
  },
  serverIpText: {
    color: 'white',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  serverSavedText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  errorContainer: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorTitle: {
    color: '#F87171',
    fontSize: 13,
    marginBottom: 8,
  },
  errorList: {
    marginLeft: 4,
  },
  errorListItem: {
    color: '#D1D5DB',
    fontSize: 12,
    marginBottom: 4,
  },
  manualEntryContainer: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#374151',
    marginTop: 12,
  },
  manualEntryText: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 8,
  },
  networkInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  networkLabel: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  networkValue: {
    color: '#D1D5DB',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});

export default NetworkScanner;

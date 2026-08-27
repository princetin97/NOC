import React from 'react';
import { NetworkDevice, NetworkAlert } from '../types';
import { TopologyEditor } from './TopologyEditor';

interface NetworkTopologyProps {
  devices: NetworkDevice[];
  alerts: NetworkAlert[];
  selectedSiteId: string | null;
  darkMode: boolean;
  onOpenDevice?: (device: NetworkDevice) => void;
}

export const NetworkTopology: React.FC<NetworkTopologyProps> = ({ devices, alerts, selectedSiteId, darkMode, onOpenDevice }) => {
  return (
    <div className="space-y-6 pb-12">
      <TopologyEditor devices={devices} alerts={alerts} selectedSiteId={selectedSiteId} darkMode={darkMode} onOpenDevice={onOpenDevice} />
    </div>
  );
};

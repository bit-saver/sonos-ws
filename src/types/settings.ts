export interface PlayerSettings {
  volumeMode?: string;
  volumeScalingFactor?: number;
  monoMode?: boolean;
  wifiDisable?: boolean;
  [key: string]: unknown;
}

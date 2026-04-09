/** Player-level configuration settings. */
export interface PlayerSettings {
  /** Volume control mode (e.g. "VARIABLE", "FIXED", "PASS_THROUGH"). */
  volumeMode?: string;
  /** Volume scaling multiplier applied to the player's output level. */
  volumeScalingFactor?: number;
  /** Whether mono audio output is enabled (combines stereo channels). */
  monoMode?: boolean;
  /** Whether WiFi is disabled, forcing the player into wired-only mode. */
  wifiDisable?: boolean;
  /** Additional settings not explicitly typed. */
  [key: string]: unknown;
}

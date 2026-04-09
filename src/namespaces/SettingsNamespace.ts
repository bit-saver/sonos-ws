import { BaseNamespace } from './BaseNamespace.js';
import type { PlayerSettings } from '../types/settings.js';

/**
 * Manages player-level settings for an individual Sonos player.
 *
 * Maps to the Sonos WebSocket Control API `settings:1` namespace.
 */
export class SettingsNamespace extends BaseNamespace {
  readonly namespace = 'settings:1';

  /**
   * Gets the current player settings.
   *
   * @returns The player's current settings.
   */
  async getPlayerSettings(): Promise<PlayerSettings> {
    const response = await this.send('getPlayerSettings');
    return this.body(response) as unknown as PlayerSettings;
  }

  /**
   * Updates player settings.
   *
   * Only the properties included in the settings object are changed;
   * omitted properties remain at their current values.
   *
   * @param settings - The player settings to update.
   */
  async setPlayerSettings(settings: Partial<PlayerSettings>): Promise<void> {
    await this.send('setPlayerSettings', settings);
  }
}

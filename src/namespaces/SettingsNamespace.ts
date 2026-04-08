import { BaseNamespace } from './BaseNamespace.js';
import type { PlayerSettings } from '../types/settings.js';

export class SettingsNamespace extends BaseNamespace {
  readonly namespace = 'settings:1';

  async getPlayerSettings(): Promise<PlayerSettings> {
    const response = await this.send('getPlayerSettings');
    return this.body(response) as unknown as PlayerSettings;
  }

  async setPlayerSettings(settings: Partial<PlayerSettings>): Promise<void> {
    await this.send('setPlayerSettings', settings);
  }
}

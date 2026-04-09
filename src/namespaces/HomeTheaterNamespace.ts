import { BaseNamespace } from './BaseNamespace.js';
import type { HomeTheaterOptions } from '../types/homeTheater.js';

/**
 * Manages home theater audio settings such as night mode and dialog enhancement.
 *
 * Maps to the Sonos WebSocket Control API `homeTheater:1` namespace.
 */
export class HomeTheaterNamespace extends BaseNamespace {
  readonly namespace = 'homeTheater:1';

  /**
   * Gets the current home theater settings.
   *
   * @returns The current home theater options (night mode, dialog enhancement, etc.).
   */
  async getOptions(): Promise<HomeTheaterOptions> {
    const response = await this.send('getOptions');
    return this.body(response) as unknown as HomeTheaterOptions;
  }

  /**
   * Updates home theater settings.
   *
   * Only the properties included in the options object are changed;
   * omitted properties remain at their current values.
   *
   * @param options - The home theater settings to update.
   */
  async setOptions(options: Partial<HomeTheaterOptions>): Promise<void> {
    await this.send('setOptions', options);
  }
}

import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { SettingsNamespace } from '../namespaces/SettingsNamespace.js';
import type { PlayerSettings } from '../types/settings.js';

/** Manages player-level settings. */
export class SettingsControl {
  private readonly ns: SettingsNamespace;
  constructor(context: NamespaceContext) { this.ns = new SettingsNamespace(context); }

  /** Gets the current player settings. */
  async get(): Promise<PlayerSettings> { return this.ns.getPlayerSettings(); }

  /**
   * Updates player settings.
   * @param settings - Settings to update.
   */
  async set(settings: Partial<PlayerSettings>): Promise<void> { return this.ns.setPlayerSettings(settings); }
}

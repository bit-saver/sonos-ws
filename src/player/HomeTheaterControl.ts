import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { HomeTheaterNamespace } from '../namespaces/HomeTheaterNamespace.js';
import type { HomeTheaterOptions } from '../types/homeTheater.js';

/** Manages home theater settings (night mode, dialog enhancement). */
export class HomeTheaterControl {
  private readonly ns: HomeTheaterNamespace;
  constructor(context: NamespaceContext) { this.ns = new HomeTheaterNamespace(context); }

  /** Gets the current home theater settings. */
  async get(): Promise<HomeTheaterOptions> { return this.ns.getOptions(); }

  /**
   * Updates home theater settings.
   * @param options - Settings to update (nightMode, enhanceDialog).
   */
  async set(options: Partial<HomeTheaterOptions>): Promise<void> { return this.ns.setOptions(options); }
}

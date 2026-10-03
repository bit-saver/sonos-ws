import type { SonosConnection } from './SonosConnection.js';
import type { Logger } from '../util/logger.js';
import { ConnectionError } from '../errors/ConnectionError.js';
import { ErrorCode } from '../types/errors.js';

/**
 * Runs an owner's setup once per socket its connection brings up. A connect() call sets up the handshake it awaited;
 * the 'connected' listener sets up the reconnect ladder's. Shared by SonosClient and SonosHousehold.
 */
export class ConnectionSetup {
  private readonly connection: SonosConnection;
  private readonly setUp: () => Promise<void>;
  private readonly onSetUp: () => void;
  private readonly log: Logger;
  /** Setup runs, chained so each starts after the previous one settles: a flap mid-setup must not run two at once. */
  private chain: Promise<void> = Promise.resolve();
  /** Handshakes a connect() call is awaiting: their setup is that call's to run, not the 'connected' listener's. */
  private ownedHandshakes = 0;
  /** Counts 'connected' events, so a completed setup can be matched to the socket it ran on. */
  private connectedEpoch = 0;
  /** The connectedEpoch the last completed setup started under. */
  private setupEpoch = -1;
  /** Counts disconnects, so a run parked mid-disconnect can tell one happened while the socket still reads 'connected'. */
  private disconnects = 0;

  /**
   * @param setUp - the owner's setup work; it logs its own failure
   * @param onSetUp - called when a run completes on a live socket; the owner emits 'connected' here
   */
  constructor(connection: SonosConnection, setUp: () => Promise<void>, onSetUp: () => void, log: Logger) {
    this.connection = connection;
    this.setUp = setUp;
    this.onSetUp = onSetUp;
    this.log = log;
    // Returns the run, so a test can await it.
    connection.on('connected', () => this.onConnected());
  }

  /** Set up on the socket that is up now, not merely set up once. */
  private get setUpOnCurrentSocket(): boolean {
    return this.setupEpoch === this.connectedEpoch;
  }

  /** Connects and sets up, unless already set up on the live socket. Rejects if the handshake or the setup fails. */
  async connect(): Promise<void> {
    if (this.setUpOnCurrentSocket && this.connection.state === 'connected') return;
    this.ownedHandshakes++;
    try {
      await this.connection.connect();
    } finally {
      this.ownedHandshakes--;
    }
    // Overlapping calls each queue this; the first to run sets up, the rest find it done.
    await this.enqueue();
  }

  /** Call first in the owner's disconnect(): a run in flight then abandons rather than announcing. */
  noteDisconnect(): void {
    this.disconnects++;
  }

  /** Runs work after any setup in flight, so the two never overlap. A failure rejects this call, never the chain. */
  runAfterSetup(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Sets up after a handshake no connect() call awaits: the reconnect ladder's. */
  private onConnected(): Promise<void> {
    this.connectedEpoch++;
    if (this.ownedHandshakes > 0) return Promise.resolve();
    // The run has logged its failure, and a background run has no caller to tell.
    return this.enqueue().catch(() => {});
  }

  /** Queues a setup run; one queued ahead may already have set this socket up. */
  private enqueue(): Promise<void> {
    return this.runAfterSetup(() => (this.setUpOnCurrentSocket ? Promise.resolve() : this.run()));
  }

  private async run(): Promise<void> {
    const epoch = this.connectedEpoch;
    const disconnects = this.disconnects;
    await this.setUp();
    // Disconnects too, not just state: an owner may close other sockets first, leaving this one 'connected' meanwhile.
    if (this.disconnects !== disconnects || this.connection.state !== 'connected') {
      this.log.debug('Setup abandoned: disconnected during setup');
      throw new ConnectionError(ErrorCode.CONNECTION_LOST, 'Disconnected during setup');
    }
    this.setupEpoch = epoch;
    this.onSetUp();
  }
}

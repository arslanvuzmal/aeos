import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import {
  TelemetryEventType,
  ConsensusStartPayload,
  VoteCastPayload,
  QuorumTallyPayload,
  DeadlockPayload,
  ResolutionPayload,
} from './types.js';
import { ITelemetryBroadcasterFallback } from './council_orchestrator.js';

export interface TelemetryConfig {
  wsUrl?: string;
  reconnectIntervalMs?: number;
  autoConnect?: boolean;
}

export class ConsensusTelemetryStreamer extends EventEmitter implements ITelemetryBroadcasterFallback {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private reconnectIntervalMs: number;
  private isClosed: boolean = false;
  private messageQueue: any[] = [];

  constructor(config: TelemetryConfig = {}) {
    super();
    this.wsUrl = config.wsUrl || 'ws://127.0.0.1:4000/ws';
    this.reconnectIntervalMs = config.reconnectIntervalMs || 5000;
    if (config.autoConnect !== false) {
      this.connect();
    }
  }

  public connect(): void {
    if (this.isClosed) return;
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.emit('connected');
        this.flushQueue();
      });

      this.ws.on('error', (err: any) => {
        this.emit('error', err);
      });

      this.ws.on('close', () => {
        this.emit('disconnected');
        this.ws = null;
        if (!this.isClosed) {
          setTimeout(() => this.connect(), this.reconnectIntervalMs);
        }
      });
    } catch (e: any) {
      this.emit('error', e);
    }
  }

  private send(event: TelemetryEventType, data: any): void {
    const packet = {
      type: 'consensus_telemetry',
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    this.emit('event', packet);
    this.emit(event, data);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(packet));
      } catch (err) {
        this.messageQueue.push(packet);
      }
    } else {
      if (this.messageQueue.length < 1000) {
        this.messageQueue.push(packet);
      }
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === 1) {
      const msg = this.messageQueue.shift();
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        break;
      }
    }
  }

  public emitConsensusStart(payload: ConsensusStartPayload | any): void {
    this.send('consensus_start', payload);
  }

  public emitVoteCast(payload: VoteCastPayload | any): void {
    this.send('council_vote_cast', payload);
  }

  public emitQuorumTally(payload: QuorumTallyPayload | any): void {
    this.send('consensus_quorum_tally', payload);
  }

  public emitDeadlock(payload: DeadlockPayload | any): void {
    this.send('consensus_deadlock', payload);
  }

  public emitResolution(payload: ResolutionPayload | any): void {
    this.send('consensus_resolution', payload);
  }

  public close(): void {
    this.isClosed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
  }
}

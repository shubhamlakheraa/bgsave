// Full data model lands in Task 2. Placeholder to establish the shared module.

import type { SCHEMA_VERSION } from './constants';

export type SchemaVersion = typeof SCHEMA_VERSION;

export interface PingMessage {
  type: 'PING';
}

export interface PongResponse {
  type: 'PONG';
  from: 'background';
  at: number;
}

export type ExtensionMessage = PingMessage;
export type ExtensionResponse = PongResponse;

import type { CardType } from '../engine/types.js';

/** One seat at a table, as everyone in the lobby sees it. */
export interface SeatInfo {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'ended';
  seats: SeatInfo[];
  maxSeats: number;
}

// ------------------------------------------------------------ client -> server

export type ClientMessage =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'createRoom' }
  | { t: 'joinRoom'; code: string }
  | { t: 'leaveRoom' }
  | { t: 'addBot' }
  | { t: 'removeSeat'; seatId: string }
  | { t: 'startMatch' }
  | { t: 'play'; cardId: string; targetPlayerId?: string; lockType?: CardType }
  | { t: 'draw' }
  | { t: 'pass' }
  | { t: 'choose'; choice: string };

// ------------------------------------------------------------ server -> client

export type ServerMessage =
  | { t: 'welcome'; playerId: string; token: string; name: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'left' }
  | { t: 'view'; view: unknown; serverNow: number }
  | { t: 'notice'; message: string };

export const ROOM_CODE_LENGTH = 4;
/** No O/0 or I/1 - people read these out loud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

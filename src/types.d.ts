import { type WebSocket } from 'ws';
import { type Chess } from 'chess.js';
declare global {
  type Game = {
    began: boolean;
    /**
     * 0 - White \
     * 1 - Black
     */
    turn: 0 | 1;
    white: Player;
    black: Player;
    board: Chess;
  };
}

interface Player {
  token: string;
  ws: WebSocket;
  uid: string;
  elo: number;
}

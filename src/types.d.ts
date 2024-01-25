import { type WebSocket } from 'ws';

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
  };
}

interface Player {
  token: string;
  ws: WebSocket;
  uid: string;
}

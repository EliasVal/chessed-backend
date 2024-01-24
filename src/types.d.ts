import { type WebSocket } from 'ws';

declare global {
  type Game = {
    began: boolean;
    turn: 0 | 1;
    white: {
      token: string;
      ws: WebSocket;
    };
    black: {
      token: string;
      ws: WebSocket;
    };
  };
}

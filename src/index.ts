import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import 'dotenv/config';
import { initializeApp as initializeAdmin } from 'firebase-admin/app';
import { initializeApp } from 'firebase/app';
import { getAuth as getClientAuth, signInWithEmailAndPassword } from 'firebase/auth';
import firebaseAdmin from 'firebase-admin';
import bodyParser from 'body-parser';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

console.time('Server started in');
console.log('Server starting...');

const admin = initializeAdmin({
  // @ts-ignore
  credential: firebaseAdmin.credential.cert(JSON.parse(process.env.FRBS_TOKEN)),
  databaseURL: 'https://chessed-ac171-default-rtdb.europe-west1.firebasedatabase.app',
});

const client = initializeApp({
  apiKey: 'AIzaSyDaqEKpSmDf2uIfUtGp0tAuKvneAVUrdhs',
  authDomain: 'chessed-ac171.firebaseapp.com',
  databaseURL: 'https://chessed-ac171-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'chessed-ac171',
  storageBucket: 'chessed-ac171.appspot.com',
  messagingSenderId: '627390308707',
  appId: '1:627390308707:web:7517887fc52d8fd6e93356',
});

const app = express();
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

const wss = new WebSocketServer({
  port: 8080,
});

/*
  began - bool
  white - ws
  black - ws
  turn - int (0 == white)

*/
const game_list: { [index: string]: Game } = {};

wss.on('connection', async function connection(ws, req) {
  /*               */
  /*               */
  /*   USER AUTH   */
  /*               */
  /*               */
  let found = false;
  const games = Object.entries(game_list);

  const params = new URL('ws://localhost:8080' + req.url).searchParams;

  const token = params.get('token') || '';

  if (token) ws.close(4001, JSON.stringify({ type: 'close', data: 'Missing token' }));

  try {
    await getAuth().verifyIdToken(token);
  } catch {
    ws.close(4001, JSON.stringify({ type: 'close', data: 'Invalid token' }));
    return;
  }

  /*               */
  /*               */
  /*  MATCHMAKING  */
  /*               */
  /*               */
  for (const [id, details] of games) {
    // * If found game
    if (!details.began) {
      found = true;
      const game = game_list[id];

      if (game.white) game.black = { ws, token };
      else game.white = { ws, token };

      game.began = true;

      // * Notify both players of a match start
      game.black.ws.send(JSON.stringify({ type: 'match_start', data: id, color: 'black' }));
      game.white.ws.send(JSON.stringify({ type: 'match_start', data: id, color: 'white' }));
    }
  }

  // * If not, create one
  if (!found) {
    // * Make sure this UUID does NOT exist
    let newId = crypto.randomUUID();
    while (game_list[newId]) newId = crypto.randomUUID();

    const isWhite = Math.floor(Math.random() * 2) == 0;

    game_list[newId] = {
      // @ts-ignore
      black: isWhite ? null : { ws, token },
      // @ts-ignore
      white: isWhite ? { ws, token } : null,
      turn: 0,
      began: false,
    };

    ws.send(JSON.stringify({ type: 'match_create', data: newId }));
  }

  ws.on('error', console.error);

  ws.on('message', function message(data) {
    let dt;
    try {
      dt = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { move = '', token, gameId } = dt;

    if (!game_list[gameId]) return;

    if (move.match(/[0-7]{2}-[0-7]{2}/)) {
    }

    const game = game_list[gameId];
    if (game.white.token == token && game.turn == 0) {
      game.black.ws.send(JSON.stringify({ type: 'move', data: move }));
    }
  });

  ws.on('close', () => {});
});

app.listen(3000);

app.post('/login', async (request, response) => {
  const { email, password } = request.body;

  if (!email || !password) {
    response.status(400).json({ message: 'Missing parameters' });

    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(getClientAuth(), email, password);

    await getAuth().revokeRefreshTokens(cred.user.uid);
    response.json({ data: await getClientAuth().currentUser?.getIdToken() });

    await getClientAuth().signOut();

    return;
  } catch (error) {
    // @ts-ignore
    response.status(400).json({ message: error.message });
    return;
  }
});

app.post('/signup', async (request, response) => {
  const { email, password, username } = request.body;

  if (!email || !password) {
    response.status(400).json({ data: 'Missing parameters' });

    return;
  }

  if ((username || '').length < 3) {
    response.status(400).json({ data: 'Username too short' });

    return;
  }

  try {
    const u = await getAuth().createUser({
      email,
      password,
      displayName: username,
    });

    await getDatabase().ref(`users/${u.uid}`).set({ username, elo: 100 });

    response.json({ data: await getClientAuth().currentUser?.getIdToken() });

    await getClientAuth().signOut();

    return;
  } catch (error) {
    // @ts-ignore
    response.status(400).json({ data: error.message });
    return;
  }
});

console.timeEnd('Server started in');

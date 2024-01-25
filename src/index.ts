import { WebSocketServer } from 'ws';
import express from 'express';
import 'dotenv/config';
import { initializeApp as initializeAdmin } from 'firebase-admin/app';
import { initializeApp } from 'firebase/app';
import { getAuth as getClientAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
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

// ! INITIALIZE EXPRESS.JS
const app = express();
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.listen(3000);

const wss = new WebSocketServer({
  port: 8080,
});

const game_list: { [index: string]: Game } = {};

wss.on('connection', async (ws, req) => {
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

  let decodedToken;
  try {
    decodedToken = await getAuth().verifyIdToken(token);
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

      if (game.white) game.black = { ws, token, uid: decodedToken.uid };
      else game.white = { ws, token, uid: decodedToken.uid };

      game.began = true;

      // * Get Player's names
      const blackName = (await getDatabase().ref(`users/${game.black.uid}/username`).get()).val();
      const whiteName = (await getDatabase().ref(`users/${game.white.uid}/username`).get()).val();

      // * Notify both players of a match start
      game.black.ws.send(
        JSON.stringify({
          type: 'match_start',
          data: id,
          color: 'black',
          playerName: whiteName,
        })
      );
      game.white.ws.send(
        JSON.stringify({
          type: 'match_start',
          data: id,
          color: 'white',
          playerName: blackName,
        })
      );
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
      black: isWhite ? null : { ws, token, uid: decodedToken.uid },
      // @ts-ignore
      white: isWhite ? { ws, token, uid: decodedToken.uid } : null,
      turn: 0,
      began: false,
    };

    ws.send(JSON.stringify({ type: 'match_create', data: newId }));
  }

  ws.on('error', console.error);

  ws.on('message', (data) => {
    let dt;
    try {
      dt = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { move = '', token, gameId } = dt;

    if (!game_list[gameId]) return;

    // * | ^ and $ make so the match goes from the start of the string to the end (meaning no extra chars)
    // * | [0-7]{2} matches numbers from 0-7 (inclusive) twice in a row, then seperated by a dash
    // * | (-[qrnb])? is for pawn promotions, Queen, Rook, kNight, Bishop
    if (!move.match(/^([0-7]{2}-[0-7]{2}(-[qrnb])?)$/)) {
      return;
    }

    const game = game_list[gameId];
    // * White's move, notifies black
    if (game.white.token == token && game.turn == 0) {
      game.black.ws.send(JSON.stringify({ type: 'move', data: move }));
    }
    // * Black's move, notifies white
    else if (game.black.token == token && game.turn == 1) {
      game.white.ws.send(JSON.stringify({ type: 'move', data: move }));
    }
  });

  ws.on('close', () => {});
});

app.post('/login', async (request, response) => {
  const { email, password } = request.body;

  // * Check if all params are in place
  if (!email || !password) {
    response.status(400).json({ message: 'Missing parameters' });

    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(getClientAuth(), email, password);

    // * Revoke old token
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

  // * Check if all params were provided
  if (!email || !password) {
    response.status(400).json({ data: 'Missing parameters' });

    return;
  }

  // * Check if username is atleast 3 chars long
  if ((username || '').length < 3) {
    response.status(400).json({ data: 'Username too short' });

    return;
  }

  try {
    const u = await createUserWithEmailAndPassword(getClientAuth(), email, password);

    // * Create user in the DB
    await getDatabase().ref(`users/${u.user.uid}`).set({ username, elo: 100 });

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

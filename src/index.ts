import { WebSocketServer } from 'ws';
import express from 'express';
import 'dotenv/config';
import { initializeApp as initializeAdmin } from 'firebase-admin/app';
import { initializeApp } from 'firebase/app';
import { getAuth as getClientAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import firebaseAdmin from 'firebase-admin';
import bodyParser from 'body-parser';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { Chess } from 'chess.js';

console.time('Server started in');
console.log('Server starting...');

const abc = 'abcdefgh';

initializeAdmin({
  // @ts-expect-error - Firebase token exists in .env, but TS does not know
  credential: firebaseAdmin.credential.cert(JSON.parse(process.env.FRBS_TOKEN)),
  databaseURL: 'https://chessed-ac171-default-rtdb.europe-west1.firebasedatabase.app',
});

initializeApp({
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
  }),
);
app.listen(3000);

const wss = new WebSocketServer({
  port: 8080,
});

const game_list: { [index: string]: Game } = {};

const db = getDatabase();

wss.on('connection', async (ws, req) => {
  /*               */
  /*               */
  /*   USER AUTH   */
  /*               */
  /*               */
  let found = false;

  const params = new URL('ws://localhost:8080' + req.url).searchParams;

  const token = params.get('token') || '';

  if (!token) {
    ws.close(4001, JSON.stringify({ type: 'close', data: 'Missing token' }));
    return;
  }

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
  for (const [id, details] of Object.entries(game_list)) {
    // * If found game
    if (!details.began) {
      found = true;
      const game = game_list[id];

      // * Get Players' data
      const blackData = (await db.ref(`users/${game.black?.uid ?? decodedToken.uid}`).get()).val();
      const whiteData = (await db.ref(`users/${game.white?.uid ?? decodedToken.uid}`).get()).val();

      if (game.white)
        game.black = {
          ws,
          token,
          uid: decodedToken.uid,
          elo: blackData.elo ?? 100,
          wins: blackData.wins ?? 0,
          draws: blackData.draws ?? 0,
          losses: blackData.losses ?? 0,
        };
      else
        game.white = {
          ws,
          token,
          uid: decodedToken.uid,
          elo: whiteData.elo ?? 100,
          wins: whiteData.wins ?? 0,
          draws: whiteData.draws ?? 0,
          losses: whiteData.losses ?? 0,
        };

      game.began = true;

      // * Notify both players of a match start
      game.black.ws.send(
        JSON.stringify({
          type: 'match_start',
          gameId: id,
          color: 'black',
          playerName: whiteData.username,
          playerElo: whiteData.elo.toString(),
        }),
      );
      game.white.ws.send(
        JSON.stringify({
          type: 'match_start',
          gameId: id,
          color: 'white',
          playerName: blackData.username,
          playerElo: blackData.elo.toString(),
        }),
      );
    }
  }

  // * If not, create one
  if (!found) {
    // * Make sure this UUID does NOT exist
    let newId = crypto.randomUUID();
    while (game_list[newId]) newId = crypto.randomUUID();

    const isWhite = Math.floor(Math.random() * 2) == 0;

    const playerData = (await db.ref(`users/${decodedToken.uid}`).get()).val();

    const playerObj = {
      ws,
      token,
      uid: decodedToken.uid,
      elo: playerData.elo ?? 100,
      wins: playerData.wins ?? 0,
      draws: playerData.draws ?? 0,
      losses: playerData.losses ?? 0,
    };

    game_list[newId] = {
      // @ts-expect-error - Await other player
      black: isWhite ? null : playerObj,
      // @ts-expect-error - Await other player
      white: isWhite ? playerObj : null,
      turn: 0,
      began: false,
      board: new Chess(),
      drawOffer: {
        offered: false,
        movesSinceOffered: 11,
        offeredTo: '',
      },
    };

    ws.send(JSON.stringify({ type: 'match_create', data: newId }));
  }

  ws.on('error', console.error);

  ws.on('message', async (data) => {
    let dt;
    try {
      dt = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { move = '', token, gameId, type } = dt;

    // ! No need to revalidate token here because
    // ! it is validated upon match lookup & start.
    // ! It just checks whether the token belongs to one of the players

    if (!game_list[gameId]) return;

    const game = game_list[gameId];

    if (type == 'resign') {
      // if (game.black.ws != ws && game.white.ws != ws) return;

      let whiteScore: 0 | 0.5 | 1 = 0;

      if (game.black.ws == ws) whiteScore = 1;
      else if (game.white.ws == ws) whiteScore = 0;
      else return;

      GameOver(game, gameId, whiteScore, 'null', 'resignation');

      return;
    }

    if (type == 'drawOffer') {
      if (game.drawOffer.offered || game.drawOffer.movesSinceOffered < 10) return;

      if (game.black.ws == ws) {
        game.white.ws.send(JSON.stringify({ type: 'draw_offer' }));
        game.drawOffer.offeredTo = 'white';
      } else if (game.white.ws == ws) {
        game.drawOffer.offeredTo = 'black';
        game.black.ws.send(JSON.stringify({ type: 'draw_offer' }));
      }

      game.drawOffer.movesSinceOffered = 0;
    }

    if (type == 'drawAccept') {
      if (game.drawOffer.offeredTo == 'white' && game.white.ws != ws) return;
      if (game.drawOffer.offeredTo == 'black' && game.black.ws != ws) return;

      GameOver(game, gameId, 0.5, 'null', 'agreement');

      return;
    }

    if (type == 'drawDecline') {
      if (game.drawOffer.offeredTo == 'white' && game.white.ws != ws) return;
      if (game.drawOffer.offeredTo == 'black' && game.black.ws != ws) return;

      if (game.drawOffer.offeredTo == 'white')
        game.black.ws.send(JSON.stringify({ type: 'draw_decline' }));
      if (game.drawOffer.offeredTo == 'black')
        game.white.ws.send(JSON.stringify({ type: 'draw_decline' }));

      return;
    }

    // * | ^ and $ make so the match goes from the start of the string to the end (meaning no extra chars)
    // * | [0-7]{2} matches numbers from 0-7 (inclusive) twice in a row, then seperated by a dash
    // * | (-[qrnb])? is for pawn promotions, Queen, Rook, kNight, Bishop
    if (!move.match(/^([0-7]{2}-[0-7]{2}(-[qrnb])?)$/)) {
      return;
    }

    let madeMove = false;

    const mv = move.split('-');

    const from: string[] = mv[0].split('');
    from[1] = abc[parseInt(from[1])];
    from[0] = (7 - parseInt(from[0]) + 1).toString();
    from.reverse();

    const to: string[] = mv[1].split('');
    // to[0] =
    to[1] = abc[parseInt(to[1])];
    to[0] = (7 - parseInt(to[0]) + 1).toString();
    to.reverse();

    if (
      (game.white.token == token && game.turn === 0) ||
      (game.black.token == token && game.turn === 1)
    ) {
      try {
        game.board.move({ from: from.join(''), to: to.join(''), promotion: mv[2] });
        madeMove = true;
      } catch {
        console.log('ILLEGAL MOVE');
      }
    }

    if (!madeMove) return;

    if (game.board.isGameOver()) {
      let whiteScore: 0 | 0.5 | 1 = 1;
      if (game.board.isCheckmate() && game.turn === 1) {
        whiteScore = 0;
      } else if (game.board.isDraw()) whiteScore = 0.5;

      GameOver(game, gameId, whiteScore, move, 'checkmate');
    } else {
      if (game.turn === 0) game.black.ws.send(JSON.stringify({ type: 'move', data: move }));
      else if (game.turn === 1) game.white.ws.send(JSON.stringify({ type: 'move', data: move }));

      game.turn = game.turn === 0 ? 1 : 0;
    }
  });

  ws.on('close', () => {
    for (const [id, details] of Object.entries(game_list)) {
      if (details.black?.ws == ws || details.white?.ws == ws) {
        if (details.began) {
          const whiteResigned = details.white?.ws == ws ? 0 : 1;
          // Act as if the player resigned
          GameOver(game_list[id], id, whiteResigned, 'null', 'resignation');
        } else {
          delete game_list[id];
        }
      }
    }
  });
});

app.post('/signup', async (request, response) => {
  const { email, password, username } = request.body;

  // * Check if all params were provided
  if (!email || !password) {
    response.status(400).json({ error: 'Missing parameters' });

    return;
  }

  // * Check if username is atleast 3 chars long
  if ((username || '').length < 3) {
    response.status(400).json({ error: 'Username too short' });

    return;
  }

  try {
    const u = await createUserWithEmailAndPassword(getClientAuth(), email, password);

    // * Create user in the DB
    await db
      .ref(`users/${u.user.uid}`)
      .set({ username, elo: 100, wins: 0, losses: 0, draws: 0, uid: u.user.uid });

    response.send({ message: 'Success' });

    await getClientAuth().signOut();

    return;
  } catch (error) {
    // @ts-expect-error - Type of `error` is unkown, but always has a .message
    response.status(400).json({ error: error.message });
    return;
  }
});

app.post('/get_profile', async (req, res) => {
  const { uid } = req.body;

  const needMatches = req.body.needMatches == 'true' ? true : false;

  if (!uid) {
    res.status(400).send({ error: 'Missing UID' });
    return;
  }

  const v: { [index: string]: number | string } = await (await db.ref(`users/${uid}`).get()).val();

  if (needMatches && v != null) {
    v.matches = await (
      await db.ref(`users/${uid}/matches`).orderByValue().limitToFirst(10).get()
    ).val();
  }

  if (v == null) {
    res.status(404).send({ error: 'This user does not exist!' });
    return;
  } else {
    res.status(200).send(v);
  }
});

app.post('/get_matchdata', async (req, res) => {
  const { id } = req.body;

  if (!id) {
    res.status(400).send({ error: 'Missing ID' });
    return;
  }

  const v: { [index: string]: number | string } = await (await db.ref(`matches/${id}`).get()).val();

  if (v == null) {
    res.status(404).send({ error: 'This match does not exist!' });
    return;
  }

  return res.status(200).send(v);
});

const influenceK = 32;
const magicC = 400;

/**
 * Based on https://stanislav-stankovic.medium.com/elo-rating-system-6196cc59941e
 * @param player1Elo The elo of P1
 * @param player2Elo The elo of P2
 * @param outcome Outcome, from P1's perspective (W = 1, L = 0, D = 0.5)
 * @returns The new elo of P1
 */
function CalcNewElo(player1Elo: number, player2Elo: number, outcome: number) {
  const qA = Math.pow(10, player1Elo / magicC);
  const qB = Math.pow(10, player2Elo / magicC);
  const expectedOutcome = qA / (qA + qB);

  // ELO SHOULD NOT BE LOWER THAN 100
  return Math.max(100, Math.ceil(player1Elo + influenceK * (outcome - expectedOutcome)));
}

async function GameOver(
  game: Game,
  id: string,
  whiteScore: 0 | 0.5 | 1,
  finalMove: string = 'null',
  reason: string = 'null',
) {
  const newBlackElo = CalcNewElo(game.black.elo, game.white.elo, 1 - whiteScore);
  const newWhiteElo = CalcNewElo(game.white.elo, game.black.elo, whiteScore);

  game.black.ws.send(
    JSON.stringify({
      type: 'game_over',
      data: game.turn == 1 ? 'null' : finalMove,
      winner: whiteScore === 1 ? 'white' : whiteScore === 0.5 ? 'draw' : 'black',
      newElo: newBlackElo.toString(),
      reason,
    }),
  );
  game.white.ws.send(
    JSON.stringify({
      type: 'game_over',
      data: game.turn == 0 ? 'null' : finalMove,
      winner: whiteScore === 1 ? 'white' : whiteScore === 0.5 ? 'draw' : 'black',
      newElo: newWhiteElo.toString(),
      reason,
    }),
  );

  db.ref(`users/${game.black.uid}/elo`).set(newBlackElo);
  db.ref(`users/${game.white.uid}/elo`).set(newWhiteElo);

  if (whiteScore == 1) {
    db.ref(`users/${game.black.uid}/losses`).set(game.black.losses + 1);
    db.ref(`users/${game.white.uid}/wins`).set(game.white.wins + 1);
  } else if (whiteScore == 0) {
    db.ref(`users/${game.black.uid}/wins`).set(game.black.wins + 1);
    db.ref(`users/${game.white.uid}/losses`).set(game.white.losses + 1);
  } else {
    db.ref(`users/${game.black.uid}/draws`).set(game.black.draws + 1);
    db.ref(`users/${game.white.uid}/draws`).set(game.white.draws + 1);
  }

  game.white.ws.close(4001, JSON.stringify({ type: 'game_over' }));
  game.black.ws.close(4001, JSON.stringify({ type: 'game_over' }));

  await db.ref(`matches/${id}`).set({
    black: {
      id: game.black.uid,
      elo: newBlackElo,
    },
    white: {
      id: game.white.uid,
      elo: newWhiteElo,
    },
    // 1 == White (w)
    // 0 == Black (b)
    // 0.5 == Draw (d)
    winner: whiteScore == 1 ? 'w' : whiteScore == 0 ? 'b' : 'd',
    reason,
    moves: game.board.pgn({ newline: '' }),
    timestamp: Date.now().toString(),
  });

  await db.ref(`users/${game.black.uid}/matches/${id}`).set(Date.now().toString());
  await db.ref(`users/${game.white.uid}/matches/${id}`).set(Date.now().toString());

  delete game_list[id];
}
console.timeEnd('Server started in');

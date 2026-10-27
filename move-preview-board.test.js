const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./move-preview-board.js");

const chess = globalThis.LichessMovePreviewBoard;

test("preview board applies ordinary moves without mutating its source", () => {
  const state = chess.parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const next = chess.applyMove(state, chess.parseSquare("e2"), "e4");

  assert.equal(state.board[6][4], "wP");
  assert.equal(next.board[4][4], "wP");
  assert.equal(next.turn, "b");
  assert.deepEqual(next.enPassant, { row: 5, col: 4 });
  assert.equal(chess.getPlacement(next), "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
});

test("standard opening move counts match legal chess positions", () => {
  const countMoves = state => state.board.flatMap((rank, row) => rank.flatMap((piece, col) =>
    piece ? chess.getLegalMoves(state, { row, col }) : [])).length;
  const start = chess.parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(countMoves(start), 20);
  assert.equal(countMoves(chess.applyMove(start, chess.parseSquare("e2"), "e4")), 20);
});

test("legal move generation rejects self-check and handles castling rights", () => {
  const pinned = chess.parseFen("4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1");
  const bishopMoves = chess.getLegalMoves(pinned, chess.parseSquare("e2"));
  assert.ok(!bishopMoves.some(move => move.row === 5 && move.col === 3));

  const castling = chess.parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const kingMoves = chess.getLegalMoves(castling, chess.parseSquare("e1"));
  assert.ok(kingMoves.some(move => move.special === "castle-kingside"));
  assert.ok(kingMoves.some(move => move.special === "castle-queenside"));
  const afterCastle = chess.applyMove(castling, chess.parseSquare("e1"), "g1");
  assert.equal(afterCastle.board[7][6], "wK");
  assert.equal(afterCastle.board[7][5], "wR");
  assert.ok(!afterCastle.castling.has("K") && !afterCastle.castling.has("Q"));

  const attackedTransit = chess.parseFen("4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1");
  const movesWhileAttacked = chess.getLegalMoves(attackedTransit, chess.parseSquare("e1"));
  assert.ok(!movesWhileAttacked.some(move => move.special === "castle-kingside"));
});

test("en passant and promotion are reflected in the resulting position", () => {
  const enPassant = chess.parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  const capture = chess.applyMove(enPassant, chess.parseSquare("e5"), "d6");
  assert.equal(capture.board[2][3], "wP");
  assert.equal(capture.board[3][3], "");
  assert.ok(!capture.enPassant);

  const pinnedEnPassant = chess.parseFen("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  assert.equal(chess.applyMove(pinnedEnPassant, chess.parseSquare("e5"), "d6"), null);

  const promotion = chess.parseFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  const promoted = chess.applyMove(promotion, chess.parseSquare("a7"), "a8", "N");
  assert.equal(promoted.board[0][0], "wN");
});

test("malformed positions and illegal moves are rejected", () => {
  assert.equal(chess.parseFen("8/8/8/8/8/8/8/8 w - - 0 1"), null);
  const state = chess.parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(chess.applyMove(state, chess.parseSquare("e1"), "e3"), null);
});

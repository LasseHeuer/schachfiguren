(() => {
  const files = "abcdefgh";
  const promotionTypes = new Set(["Q", "R", "B", "N"]);
  const knightSteps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const kingSteps = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const rookSteps = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const bishopSteps = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const allSlides = [...rookSteps, ...bishopSteps];

  const isInside = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;
  const opposite = color => color === "w" ? "b" : "w";
  const parseSquare = key => {
    const match = /^([a-h])([1-8])$/.exec(String(key ?? "").toLowerCase());
    return match ? { row: 8 - Number(match[2]), col: match[1].charCodeAt(0) - 97 } : null;
  };
  const squareKey = ({ row, col }) => `${files[col]}${8 - row}`;
  const cloneBoard = board => board.map(rank => [...rank]);

  function parseFen(fen) {
    if (typeof fen !== "string") return null;
    const [placement, turn = "w", castling = "-", ep = "-", halfmove = "0", fullmove = "1"] = fen.trim().split(/\s+/);
    const ranks = placement?.split("/");
    if (ranks?.length !== 8 || !["w", "b"].includes(turn) || !/^(?:-|K?Q?k?q?)$/.test(castling)) return null;

    const board = Array.from({ length: 8 }, () => Array(8).fill(""));
    for (const [row, rank] of ranks.entries()) {
      let col = 0;
      for (const symbol of rank) {
        if (/^[1-8]$/.test(symbol)) col += Number(symbol);
        else if (/^[pnbrqkPNBRQK]$/.test(symbol) && col < 8) {
          board[row][col++] = `${symbol === symbol.toUpperCase() ? "w" : "b"}${symbol.toUpperCase()}`;
        } else return null;
      }
      if (col !== 8) return null;
    }
    const enPassant = ep === "-" ? null : parseSquare(ep);
    if (ep !== "-" && !enPassant) return null;
    const whiteKings = board.flat().filter(piece => piece === "wK").length;
    const blackKings = board.flat().filter(piece => piece === "bK").length;
    if (whiteKings !== 1 || blackKings !== 1) return null;

    return {
      board,
      turn,
      castling: new Set(castling === "-" ? "" : castling),
      enPassant,
      halfmove: Math.max(0, Number.parseInt(halfmove, 10) || 0),
      fullmove: Math.max(1, Number.parseInt(fullmove, 10) || 1)
    };
  }

  function isSquareAttacked(board, target, byColor) {
    const pawnRow = target.row + (byColor === "w" ? 1 : -1);
    for (const col of [target.col - 1, target.col + 1]) {
      if (isInside(pawnRow, col) && board[pawnRow][col] === `${byColor}P`) return true;
    }
    for (const [dr, dc] of knightSteps) {
      const row = target.row + dr;
      const col = target.col + dc;
      if (isInside(row, col) && board[row][col] === `${byColor}N`) return true;
    }
    for (const [dr, dc] of kingSteps) {
      const row = target.row + dr;
      const col = target.col + dc;
      if (isInside(row, col) && board[row][col] === `${byColor}K`) return true;
    }
    for (const [dr, dc] of allSlides) {
      let row = target.row + dr;
      let col = target.col + dc;
      let distance = 1;
      while (isInside(row, col)) {
        const piece = board[row][col];
        if (piece) {
          if (piece[0] === byColor && (piece[1] === "Q"
            || (distance === 1 && piece[1] === "K")
            || (dr === 0 || dc === 0 ? piece[1] === "R" : piece[1] === "B"))) return true;
          break;
        }
        row += dr;
        col += dc;
        distance++;
      }
    }
    return false;
  }

  function findKing(board, color) {
    for (let row = 0; row < 8; row++) {
      const col = board[row].indexOf(`${color}K`);
      if (col !== -1) return { row, col };
    }
    return null;
  }

  function isInCheck(board, color) {
    const king = findKing(board, color);
    return !king || isSquareAttacked(board, king, opposite(color));
  }

  function applyUnchecked(state, from, move, promotion = "Q") {
    const next = { ...state, board: cloneBoard(state.board), castling: new Set(state.castling) };
    const { row: fromRow, col: fromCol } = from;
    const { row: toRow, col: toCol } = move;
    const piece = next.board[fromRow][fromCol];
    const captured = move.special === "en-passant" ? next.board[fromRow][toCol] : next.board[toRow][toCol];
    next.board[fromRow][fromCol] = "";
    if (move.special === "en-passant") next.board[fromRow][toCol] = "";
    if (move.special === "castle-kingside" || move.special === "castle-queenside") {
      const rookFrom = move.special === "castle-kingside" ? 7 : 0;
      const rookTo = move.special === "castle-kingside" ? 5 : 3;
      next.board[fromRow][rookTo] = next.board[fromRow][rookFrom];
      next.board[fromRow][rookFrom] = "";
    }
    const promoted = piece[1] === "P" && (toRow === 0 || toRow === 7)
      ? `${piece[0]}${promotionTypes.has(promotion) ? promotion : "Q"}`
      : piece;
    next.board[toRow][toCol] = promoted;

    if (piece[1] === "K") {
      next.castling.delete(piece[0] === "w" ? "K" : "k");
      next.castling.delete(piece[0] === "w" ? "Q" : "q");
    }
    const clearRookRight = (color, row, col) => {
      if (row !== (color === "w" ? 7 : 0)) return;
      if (col === 0) next.castling.delete(color === "w" ? "Q" : "q");
      if (col === 7) next.castling.delete(color === "w" ? "K" : "k");
    };
    if (piece[1] === "R") clearRookRight(piece[0], fromRow, fromCol);
    if (captured?.[1] === "R") clearRookRight(captured[0], move.special === "en-passant" ? fromRow : toRow, toCol);

    next.enPassant = piece[1] === "P" && Math.abs(toRow - fromRow) === 2
      ? { row: (fromRow + toRow) / 2, col: fromCol }
      : null;
    next.halfmove = piece[1] === "P" || captured ? 0 : state.halfmove + 1;
    next.fullmove = state.fullmove + Number(state.turn === "b");
    next.turn = opposite(state.turn);
    return next;
  }

  function getPseudoMoves(state, from) {
    const { row, col } = from;
    const piece = state.board[row]?.[col];
    if (!piece || piece[0] !== state.turn) return [];
    const color = piece[0];
    const moves = [];
    const add = (targetRow, targetCol, special = null) => {
      if (!isInside(targetRow, targetCol)) return;
      const target = state.board[targetRow][targetCol];
      if (target && (target[0] === color || target[1] === "K")) return;
      moves.push({ row: targetRow, col: targetCol, ...(special ? { special } : {}) });
    };

    if (piece[1] === "P") {
      const direction = color === "w" ? -1 : 1;
      const nextRow = row + direction;
      if (isInside(nextRow, col) && !state.board[nextRow][col]) {
        add(nextRow, col);
        const startRow = color === "w" ? 6 : 1;
        const doubleRow = row + direction * 2;
        if (row === startRow && !state.board[doubleRow][col]) add(doubleRow, col);
      }
      for (const targetCol of [col - 1, col + 1]) {
        if (!isInside(nextRow, targetCol)) continue;
        const target = state.board[nextRow][targetCol];
        if (target && target[0] !== color && target[1] !== "K") add(nextRow, targetCol);
        else if (state.enPassant?.row === nextRow && state.enPassant.col === targetCol
          && state.board[row][targetCol] === `${opposite(color)}P`) add(nextRow, targetCol, "en-passant");
      }
    } else if (piece[1] === "N") {
      for (const [dr, dc] of knightSteps) add(row + dr, col + dc);
    } else if (piece[1] === "K") {
      for (const [dr, dc] of kingSteps) add(row + dr, col + dc);
      const homeRow = color === "w" ? 7 : 0;
      const enemy = opposite(color);
      if (row === homeRow && col === 4 && !isSquareAttacked(state.board, { row, col }, enemy)) {
        const kingRight = color === "w" ? "K" : "k";
        const queenRight = color === "w" ? "Q" : "q";
        if (state.castling.has(kingRight) && state.board[row][7] === `${color}R`
          && !state.board[row][5] && !state.board[row][6]
          && !isSquareAttacked(state.board, { row, col: 5 }, enemy)
          && !isSquareAttacked(state.board, { row, col: 6 }, enemy)) add(row, 6, "castle-kingside");
        if (state.castling.has(queenRight) && state.board[row][0] === `${color}R`
          && !state.board[row][1] && !state.board[row][2] && !state.board[row][3]
          && !isSquareAttacked(state.board, { row, col: 3 }, enemy)
          && !isSquareAttacked(state.board, { row, col: 2 }, enemy)) add(row, 2, "castle-queenside");
      }
    } else {
      const directions = piece[1] === "R" ? rookSteps : piece[1] === "B" ? bishopSteps : allSlides;
      for (const [dr, dc] of directions) {
        let targetRow = row + dr;
        let targetCol = col + dc;
        while (isInside(targetRow, targetCol)) {
          const target = state.board[targetRow][targetCol];
          if (!target) moves.push({ row: targetRow, col: targetCol });
          else {
            if (target[0] !== color && target[1] !== "K") moves.push({ row: targetRow, col: targetCol });
            break;
          }
          targetRow += dr;
          targetCol += dc;
        }
      }
    }
    return moves;
  }

  function getLegalMoves(state, from) {
    const piece = state.board[from?.row]?.[from?.col];
    if (!piece || piece[0] !== state.turn) return [];
    return getPseudoMoves(state, from).filter(move => !isInCheck(applyUnchecked(state, from, move).board, piece[0]));
  }

  function applyMove(state, from, to, promotion = "Q") {
    const target = typeof to === "string" ? parseSquare(to) : to;
    if (!target || !from) return null;
    const move = getLegalMoves(state, from).find(candidate => candidate.row === target.row && candidate.col === target.col);
    if (!move) return null;
    return applyUnchecked(state, from, move, promotion);
  }

  function getPlacement(state) {
    return state.board.map(rank => {
      let empty = 0;
      let output = "";
      for (const piece of rank) {
        if (!piece) empty++;
        else {
          if (empty) output += empty;
          empty = 0;
          output += piece[0] === "w" ? piece[1] : piece[1].toLowerCase();
        }
      }
      return output + (empty || "");
    }).join("/");
  }

  globalThis.LichessMovePreviewBoard = {
    parseFen,
    parseSquare,
    squareKey,
    getLegalMoves,
    applyMove,
    getPlacement,
    isSquareAttacked
  };
})();

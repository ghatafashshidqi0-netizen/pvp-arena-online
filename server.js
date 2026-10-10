const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true }
});

app.use(express.static("public"));

const rooms = new Map();
const WIDTH = 800;
const HEIGHT = 450;
const SPEED = 210;
const MAX_HP = 100;
const MAX_ROOMS = 500;

function makePlayer(id, x, color) {
  return {
    id, x, y: HEIGHT / 2, color, hp: MAX_HP,
    input: { up: false, down: false, left: false, right: false },
    lastAttack: 0
  };
}

function snapshot(room) {
  return {
    players: room.players.map(p => ({
      id: p.id, x: p.x, y: p.y, color: p.color, hp: p.hp
    })),
    winner: room.winner
  };
}

io.on("connection", socket => {
  socket.on("joinRoom", rawCode => {
    if (socket.data.roomCode) return;
    const code = String(rawCode || "").trim().slice(0, 20);
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(code)) {
      socket.emit("roomError", "Kode room hanya boleh berisi huruf, angka, _ atau -.");
      return;
    }

    let room = rooms.get(code);
    if (room && room.players.length >= 2) {
      socket.emit("roomError", "Room sudah penuh. Gunakan kode lain.");
      return;
    }
    if (!room) {
      if (rooms.size >= MAX_ROOMS) {
        socket.emit("roomError", "Server sedang penuh. Coba lagi nanti.");
        return;
      }
      room = { players: [], winner: null, lastTime: Date.now() };
      rooms.set(code, room);
    }

    socket.join(code);
    socket.data.roomCode = code;
    const index = room.players.length;
    room.players.push(makePlayer(
      socket.id,
      index === 0 ? 100 : WIDTH - 100,
      index === 0 ? "#45d6ff" : "#ff5577"
    ));

    socket.emit("joined", { playerId: socket.id, roomCode: code });
    io.to(code).emit("state", snapshot(room));
  });

  socket.on("input", input => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.winner || !input || typeof input !== "object") return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    for (const key of ["up", "down", "left", "right"]) {
      p.input[key] = input[key] === true;
    }
  });

  socket.on("attack", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.winner) return;
    const p = room.players.find(p => p.id === socket.id);
    const enemy = room.players.find(p => p.id !== socket.id);
    if (!p || !enemy || enemy.hp <= 0) return;

    const now = Date.now();
    if (now - p.lastAttack < 500) return;
    p.lastAttack = now;

    if (Math.hypot(p.x - enemy.x, p.y - enemy.y) <= 65) {
      enemy.hp = Math.max(0, enemy.hp - 20);
      if (enemy.hp <= 0) room.winner = p.id;
      io.to(socket.data.roomCode).emit("state", snapshot(room));
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      room.winner = room.players[0].id;
      io.to(code).emit("state", snapshot(room));
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const dt = Math.min((now - room.lastTime) / 1000, 0.05);
    room.lastTime = now;

    if (!room.winner) {
      for (const p of room.players) {
        let dx = Number(p.input.right) - Number(p.input.left);
        let dy = Number(p.input.down) - Number(p.input.up);
        const length = Math.hypot(dx, dy) || 1;
        if (dx || dy) { dx /= length; dy /= length; }

        p.x = Math.max(20, Math.min(WIDTH - 20, p.x + dx * SPEED * dt));
        p.y = Math.max(20, Math.min(HEIGHT - 20, p.y + dy * SPEED * dt));
      }
    }
    io.to(code).emit("state", snapshot(room));
  }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`PvP Arena berjalan di port ${PORT}`);
});

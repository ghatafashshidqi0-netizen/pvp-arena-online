const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(express.static("public"));

const rooms = new Map();
const WIDTH = 1000;
const HEIGHT = 620;
const SPEED = 230;
const MAX_HP = 100;
const MAX_ROOMS = 500;
const MAX_AMMO = 12;
const RESERVE_AMMO = 60;
const SHOT_COOLDOWN_MS = 250;
const RELOAD_MS = 1100;
const BULLET_SPEED = 700;
const BULLET_DAMAGE = 25;
const BULLET_RADIUS = 5;
const OBSTACLES = [
  { x: 240, y: 120, w: 90, h: 100 },
  { x: 455, y: 235, w: 90, h: 130 },
  { x: 690, y: 120, w: 90, h: 100 },
  { x: 170, y: 420, w: 130, h: 45 },
  { x: 700, y: 420, w: 130, h: 45 }
];

function makePlayer(id, x, color) {
  return {
    id, x, y: HEIGHT / 2, color, hp: MAX_HP, alive: true,
    input: { up: false, down: false, left: false, right: false },
    ammo: MAX_AMMO, reserve: RESERVE_AMMO,
    lastShot: 0, reloadingUntil: 0, kills: 0
  };
}

function snapshot(room) {
  return {
    players: room.players.map(p => ({
      id: p.id, x: p.x, y: p.y, color: p.color,
      hp: p.hp, alive: p.alive, ammo: p.ammo,
      reserve: p.reserve, kills: p.kills
    })),
    bullets: room.bullets.map(b => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, owner: b.owner })),
    winner: room.winner
  };
}
function circleRect(x, y, r, o) {
  const cx = Math.max(o.x, Math.min(o.x + o.w, x));
  const cy = Math.max(o.y, Math.min(o.y + o.h, y));
  return Math.hypot(x - cx, y - cy) < r;
}
function blocked(x, y, r = 16) {
  if (x < r || y < r || x > WIDTH - r || y > HEIGHT - r) return true;
  return OBSTACLES.some(o => circleRect(x, y, r, o));
}
function roomFor(socket) {
  const code = socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function spawnPlayer(p, x) {
  p.x = x; p.y = HEIGHT / 2; p.hp = MAX_HP; p.alive = true;
  p.ammo = MAX_AMMO; p.reserve = RESERVE_AMMO;
  p.reloadingUntil = 0;
  p.input = { up: false, down: false, left: false, right: false };
}
function endRound(room, winnerId) {
  room.winner = winnerId;
  room.bullets = [];
}
function circleHit(a, b, r) { return Math.hypot(a.x - b.x, a.y - b.y) <= r; }

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
      room = { players: [], bullets: [], winner: null, lastTime: Date.now(), nextBulletId: 1 };
      rooms.set(code, room);
    }
    socket.join(code);
    socket.data.roomCode = code;
    const idx = room.players.length;
    const p = makePlayer(socket.id, idx === 0 ? 100 : WIDTH - 100, idx === 0 ? "#45d6ff" : "#ff5577");
    room.players.push(p);
    socket.emit("joined", { playerId: socket.id, roomCode: code });
    io.to(code).emit("state", snapshot(room));
  });

  socket.on("input", input => {
    const room = roomFor(socket);
    if (!room || room.winner || !input || typeof input !== "object") return;
    const p = room.players.find(v => v.id === socket.id);
    if (!p || !p.alive) return;
    for (const key of ["up", "down", "left", "right"]) p.input[key] = input[key] === true;
  });

  socket.on("shoot", () => {
    const room = roomFor(socket);
    if (!room || room.winner) return;
    const p = room.players.find(v => v.id === socket.id);
    const enemy = room.players.find(v => v.id !== socket.id);
    if (!p || !enemy || !p.alive || !enemy.alive) return;
    const now = Date.now();
    if (now - p.lastShot < SHOT_COOLDOWN_MS || p.reloadingUntil > now) return;
    if (p.ammo <= 0) return;
    p.lastShot = now;
    p.ammo--;
    const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x);
    room.bullets.push({
      id: room.nextBulletId++, owner: p.id,
      x: p.x + Math.cos(angle) * 22, y: p.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * BULLET_SPEED, vy: Math.sin(angle) * BULLET_SPEED,
      angle, life: 1.5
    });
  });

  socket.on("reload", () => {
    const room = roomFor(socket);
    if (!room || room.winner) return;
    const p = room.players.find(v => v.id === socket.id);
    if (!p || !p.alive || p.ammo >= MAX_AMMO || p.reserve <= 0 || p.reloadingUntil > Date.now()) return;
    p.reloadingUntil = Date.now() + RELOAD_MS;
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    room.bullets = room.bullets.filter(b => b.owner !== socket.id);
    if (room.players.length === 0) rooms.delete(code);
    else {
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
        if (!p.alive) continue;
        if (p.reloadingUntil && now >= p.reloadingUntil) {
          const amount = Math.min(MAX_AMMO - p.ammo, p.reserve);
          p.ammo += amount;
          p.reserve -= amount;
          p.reloadingUntil = 0;
        }
        let dx = Number(p.input.right) - Number(p.input.left);
        let dy = Number(p.input.down) - Number(p.input.up);
        const len = Math.hypot(dx, dy) || 1;
        if (dx || dy) { dx /= len; dy /= len; }
        const nx = p.x + dx * SPEED * dt;
        const ny = p.y + dy * SPEED * dt;
        if (!blocked(nx, p.y)) p.x = nx;
        if (!blocked(p.x, ny)) p.y = ny;
      }
      for (let i = room.bullets.length - 1; i >= 0; i--) {
        const b = room.bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        let remove = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WIDTH || b.y > HEIGHT ||
          OBSTACLES.some(o => b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h);
        if (!remove) {
          const target = room.players.find(p => p.id !== b.owner && p.alive);
          if (target && circleHit(b, target, 19)) {
            target.hp = Math.max(0, target.hp - BULLET_DAMAGE);
            remove = true;
            if (target.hp <= 0) {
              target.alive = false;
              const attacker = room.players.find(p => p.id === b.owner);
              if (attacker) attacker.kills++;
              endRound(room, b.owner);
            }
          }
        }
        if (remove) room.bullets.splice(i, 1);
      }
      for (const p of room.players) {
        if (p.hp <= 0) p.hp = 0;
      }
    }
    io.to(code).emit("state", snapshot(room));
  }
}, 1000 / 30);

app.get("/health", (_req, res) => res.json({ ok: true, service: "PvP Arena Online 3.0", rooms: rooms.size }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`PvP Arena Online 3.0 berjalan di port ${PORT}`));

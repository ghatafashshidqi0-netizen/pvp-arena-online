const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User terhubung: ${socket.id}`);

    // Buat Room Baru
    socket.on('create-room', (roomName) => {
        const roomId = Math.random().toString(36.substring(2, 7));
        rooms[roomId] = {
            id: roomId,
            name: roomName,
            players: {},
            ball: { x: 400, y: 300, vx: 0, vy: 0, radius: 10 },
            score: { teamA: 0, teamB: 0 },
            status: 'waiting'
        };
        socket.join(roomId);
        rooms[roomId].players[socket.id] = { id: socket.id, x: 100, y: 300, team: 'A', color: '#ff3366' };
        
        socket.emit('room-created', roomId);
        io.emit('room-list', getRoomList());
    });

    // Bergabung ke Room
    socket.on('join-room', (roomId) => {
        if (rooms[roomId] && Object.keys(rooms[roomId].players) < 4) {
            socket.join(roomId);
            const teamCount = Object.values(rooms[roomId].players).filter(p => p.team === 'B').length;
            const team = teamCount === 0 ? 'B' : 'A';
            const color = team === 'B' ? '#3366ff' : '#ff3366';
            const x = team === 'B' ? 700 : 100;

            rooms[roomId].players[socket.id] = { id: socket.id, x: x, y: 300, team: team, color: color };
            
            socket.emit('joined-room', roomId);
            io.to(roomId).emit('update-game', rooms[roomId]);
            io.emit('room-list', getRoomList());
        } else {
            socket.emit('error-msg', 'Room penuh atau tidak ditemukan!');
        }
    });

    // Minta Daftar Room
    socket.on('get-rooms', () => {
        socket.emit('room-list', getRoomList());
    });

    // Kontrol Pemain Bergerak
    socket.on('player-move', (data) => {
        const { roomId, x, y } = data;
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].x = x;
            rooms[roomId].players[socket.id].y = y;

            // Logika sederhana bola memantul jika didekati pemain
            let ball = rooms[roomId].ball;
            let player = rooms[roomId].players[socket.id];
            let dist = Math.hypot(ball.x - player.x, ball.y - player.y);
            if (dist < 25) {
                ball.vx = (ball.x - player.x) * 0.5;
                ball.vy = (ball.y - player.y) * 0.5;
            }
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                if (Object.keys(rooms[roomId].players).length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('update-game', rooms[roomId]);
                }
            }
        }
        io.emit('room-list', getRoomList());
        console.log(`User terputus: ${socket.id}`);
    });
});

// Game Loop Server untuk Bola
setInterval(() => {
    for (let roomId in rooms) {
        let room = rooms[roomId];
        let ball = room.ball;

        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.vx *= 0.98; // Gesekan
        ball.vy *= 0.98;

        // Batas lapangan (pantulan dinding)
        if (ball.y < 50 || ball.y > 550) ball.vy *= -1;
        if (ball.x < 50 || ball.x > 750) {
            if (ball.y > 220 && ball.y < 380) {
                // Gol!
                if (ball.x < 50) room.score.teamB++;
                else room.score.teamA++;
                ball.x = 400; ball.y = 300; ball.vx = 0; ball.vy = 0;
            } else {
                ball.vx *= -1;
            }
        }

        io.to(roomId).emit('update-game', room);
    }
}, 1000 / 60);

function getRoomList() {
    let list = [];
    for (let id in rooms) {
        list.push({ id: id, name: rooms[id].name, players: Object.keys(rooms[id].players).length });
    }
    return list;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

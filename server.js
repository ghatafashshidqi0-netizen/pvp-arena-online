const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Buat Room Baru
    socket.on('createRoom', ({ playerName, carColor }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            host: socket.id,
            players: {},
            status: 'waiting'
        };

        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: playerName,
            color: carColor,
            x: 100,
            y: 300,
            angle: 0,
            speed: 0,
            lap: 0
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    // Bergabung ke Room
    socket.on('joinRoom', ({ roomId, playerName, carColor }) => {
        const room = rooms[roomId];
        if (!room) {
            return socket.emit('errorMsg', 'Room tidak ditemukan!');
        }
        if (room.status === 'playing') {
            return socket.emit('errorMsg', 'Game sedang berlangsung!');
        }

        room.players[socket.id] = {
            id: socket.id,
            name: playerName,
            color: carColor,
            x: 100,
            y: 350 + (Object.keys(room.players).length * 50),
            angle: 0,
            speed: 0,
            lap: 0
        };

        socket.join(roomId);
        io.to(roomId).emit('updatePlayers', room.players);
    });

    // Mulai Game
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id) {
            room.status = 'playing';
            io.to(roomId).emit('gameStarted');
        }
    });

    // Pergerakan Mobil Pemain
    socket.on('playerMove', (data) => {
        const { roomId, x, y, angle, speed, lap } = data;
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].x = x;
            room.players[socket.id].y = y;
            room.players[socket.id].angle = angle;
            room.players[socket.id].speed = speed;
            room.players[socket.id].lap = lap;

            // Broadcast posisi ke pemain lain di room yang sama
            socket.to(roomId).emit('updatePlayerPos', {
                id: socket.id,
                x, y, angle, speed, lap
            });
        }
    });

    // Pemain Keluar / Disconnect
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                if (Object.keys(rooms[roomId].players).length === 0) {
                    delete rooms[roomId]; // Hapus room jika kosong
                } else {
                    io.to(roomId).emit('updatePlayers', rooms[roomId].players);
                }
                break;
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});

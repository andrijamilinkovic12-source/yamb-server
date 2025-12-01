const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs"); // Dodato za proveru fajlova
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// --- DEBUGGING PUTANJA (Ovo će ispisati info u Render Logovima) ---
const publicPath = path.join(__dirname, "public");
console.log("------------------------------------------------");
console.log("SERVER POKRENUT");
console.log("Trenutni direktorijum (__dirname):", __dirname);
console.log("Pokušavam da serviram public iz:", publicPath);

if (fs.existsSync(publicPath)) {
    console.log("✅ Public folder POSTOJI.");
    console.log("Sadržaj public foldera:", fs.readdirSync(publicPath));
} else {
    console.error("❌ GREŠKA: Public folder NE POSTOJI na ovoj putanji!");
    console.log("Sadržaj root foldera:", fs.readdirSync(__dirname));
}
console.log("------------------------------------------------");
// -------------------------------------------------------------

app.use(express.static(publicPath));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// MEMORIJA
let waitingPlayer = null;
let globalHighscores = [
    { name: "YambMaster", score: 1250 },
    { name: "Bot_Hard", score: 1000 },
    { name: "Srećko", score: 950 }
]; 

let roomsData = {};

app.get("/", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
  } else {
      res.status(500).send("Greška: index.html nije pronađen na serveru! Proveri logove.");
  }
});

io.on("connection", (socket) => {
  console.log("Konektovan:", socket.id);

  socket.emit("highscore_update", globalHighscores);

  socket.on("rejoin_request", ({ roomId, nickname }) => {
     const room = io.sockets.adapter.rooms.get(roomId);
     if (room && roomsData[roomId]) {
         if (room.size < 2) {
             socket.join(roomId);
             socket.nickname = nickname;
             socket.currentRoom = roomId;
             console.log(`Igrač ${nickname} se vratio u sobu ${roomId}`);
             socket.emit("rejoin_success", { roomId, players: roomsData[roomId].names });
             socket.to(roomId).emit("remote_chat", ">> IGRAČ SE VRATIO <<");
         } else {
             socket.emit("error_msg", "Soba je već puna.");
         }
     } else {
         socket.emit("rejoin_failed");
     }
  });

  socket.on("find_game", (nickname) => {
    socket.nickname = nickname;
    if (waitingPlayer) {
      if (waitingPlayer.id === socket.id) return;
      const roomId = waitingPlayer.id + "#" + socket.id;
      const players = [waitingPlayer.nickname, nickname];

      socket.join(roomId); waitingPlayer.join(roomId);
      socket.currentRoom = roomId; waitingPlayer.currentRoom = roomId;
      
      roomsData[roomId] = { names: players };

      io.to(roomId).emit("game_start", { roomId, players, myIndex: 1 });
      waitingPlayer.emit("game_start", { roomId, players, myIndex: 0 });
      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
    }
  });

  socket.on("join_room", ({ nickname, roomCode }) => {
    socket.nickname = nickname;
    const room = io.sockets.adapter.rooms.get(roomCode);
    const numClients = room ? room.size : 0;

    if (numClients === 0) {
      socket.join(roomCode);
      socket.currentRoom = roomCode;
      roomsData[roomCode] = { names: [nickname] };
    } else if (numClients === 1) {
      socket.join(roomCode);
      socket.currentRoom = roomCode;
      
      if(roomsData[roomCode]) {
          roomsData[roomCode].names.push(nickname);
          const players = roomsData[roomCode].names;
          io.to(roomCode).emit("game_start", { roomId: roomCode, players, myIndex: 1 });
          socket.to(roomCode).emit("game_start", { roomId: roomCode, players, myIndex: 0 });
      }
    } else {
      socket.emit("error_msg", "Soba je puna!");
    }
  });

  socket.on("player_move", (data) => socket.to(data.roomId).emit("remote_move", data));
  socket.on("chat_msg", (data) => socket.to(data.roomId).emit("remote_chat", data.msg));
  socket.on("game_action", (data) => socket.to(data.roomId).emit("remote_action", data.action));

  socket.on("submit_score", (data) => {
      globalHighscores.push(data);
      globalHighscores.sort((a,b) => b.score - a.score);
      globalHighscores = globalHighscores.slice(0, 20);
      io.emit("highscore_update", globalHighscores);
  });

  socket.on("disconnect", () => {
    if (waitingPlayer === socket) waitingPlayer = null;
    if (socket.currentRoom) {
        socket.to(socket.currentRoom).emit("opponent_left_temp");
        setTimeout(() => {
            const r = io.sockets.adapter.rooms.get(socket.currentRoom);
            if (!r || r.size === 0) {
                delete roomsData[socket.currentRoom];
            }
        }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server radi na portu ${PORT}`));
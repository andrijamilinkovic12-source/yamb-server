import { DICE_SYMBOLS, REDOVI_IGRA, REDOVI_PRIKAZ, KOLONE } from './constants.js';
import { sleep, sum } from './utils.js';
import { SoundManager } from './modules/SoundManager.js';
import { ModalSystem } from './modules/ModalSystem.js';
import { YambAI } from './modules/YambAI.js';

export class YambApp {
    constructor() { 
        this.theme = "dark"; 
        this.players = []; 
        this.allScores = []; 
        this.currentPlayerIdx = 0; 
        this.gameActive = false; 
        this.aiMode = false; 
        this.aiDifficulty = "medium"; 
        this.ai = null; 
        this.kockiceVals = [0,0,0,0,0,0]; 
        this.zadrzane = [false,false,false,false,false,false]; 
        this.brojBacanja = 0; 
        this.najavaAktivna = false; 
        this.najavljenoPolje = null; 
        this.history = null; 
        
        this.localHighscores = [];
        this.globalHighscores = [];
        this.turnTimer = null; 
        
        this.modal = new ModalSystem(); 
        
        // SERVER LINK
        const SERVER_URL = "https://yamb-balkans-api.onrender.com"; 

        // --- SAFE SOCKET INIT ---
        // Provera da li je biblioteka učitana pre nego što je koristimo
        if (typeof io !== 'undefined') {
            this.socket = io(SERVER_URL, { autoConnect: false });
            this.onlineSupported = true;
        } else {
            console.warn("Socket.io nije učitan! Online mod isključen.");
            this.onlineSupported = false;
            // Dummy objekat da ne puca kod
            this.socket = {
                connect: () => {},
                disconnect: () => {},
                on: () => {},
                once: () => {},
                emit: () => {},
                connected: false
            };
        }
        
        this.onlineMode = false; 
        this.myOnlineIndex = 0; 
        this.roomId = null; 
        this.playerName = localStorage.getItem('yamb_player_name') || "Igrač"; 
        this.soundEnabled = localStorage.getItem('yamb_sound') === 'true'; 
        this.stats = JSON.parse(localStorage.getItem('yamb_stats')) || { games: 0, wins: 0, highscore: 0 }; 
        this.diceBtns = []; 
        
        this.uiInit(); 
        this.soundMgr = new SoundManager(); 
        this.applyTheme(); 
        this.loadHighscores(); 
        
        if (this.onlineSupported) {
            this.setupSocketListeners();
            this.checkReconnect();
            this.checkUrlInvite();
        } else {
            // Ako nema socketa, sakrij online dugme
            const onlineBtn = document.querySelector('.menu-btn.online');
            if(onlineBtn) {
                onlineBtn.style.opacity = '0.5';
                onlineBtn.innerText = "🌐 OFFLINE MOD";
                onlineBtn.onclick = () => this.modal.alert("Greška", "Internet konekcija nije dostupna.");
            }
        }

        window.addEventListener('beforeunload', () => {});
    }

    vibrate(pattern) { if (navigator.vibrate) navigator.vibrate(pattern); }

    checkReconnect() {
        const savedState = localStorage.getItem('yamb_active_game');
        if (savedState) {
            try {
                const data = JSON.parse(savedState);
                if (data.onlineMode && data.roomId && this.onlineSupported) {
                    this.socket.connect();
                    this.socket.emit('rejoin_request', { roomId: data.roomId, nickname: this.playerName });
                    this.restoreGameState(data);
                } else if (!data.onlineMode) {
                    this.restoreGameState(data);
                    document.getElementById('menu-screen').classList.add('hidden');
                    document.getElementById('game-screen').classList.remove('hidden');
                }
            } catch(e) { console.error("Reconnect error", e); localStorage.removeItem('yamb_active_game'); }
        }
    }

    saveStateToLocal() {
        if (!this.gameActive) { localStorage.removeItem('yamb_active_game'); return; }
        const state = {
            players: this.players, scores: this.allScores, current: this.currentPlayerIdx,
            aiMode: this.aiMode, diff: this.aiDifficulty, onlineMode: this.onlineMode,
            roomId: this.roomId, myIndex: this.myOnlineIndex, dice: this.kockiceVals,
            held: this.zadrzane, rolls: this.brojBacanja, najava: this.najavaAktivna, naj_f: this.najavljenoPolje
        };
        localStorage.setItem('yamb_active_game', JSON.stringify(state));
    }

    restoreGameState(data) {
        this.players = data.players;
        this.allScores = data.scores;
        this.currentPlayerIdx = data.current;
        this.aiMode = data.aiMode;
        this.aiDifficulty = data.diff;
        this.onlineMode = data.onlineMode;
        this.roomId = data.roomId;
        this.myOnlineIndex = data.myIndex;
        
        this.kockiceVals = data.dice || [0,0,0,0,0,0];
        this.zadrzane = data.held || [false,false,false,false,false,false];
        this.brojBacanja = data.rolls || 0;
        this.najavaAktivna = data.najava || false;
        this.najavljenoPolje = data.naj_f || null;
        
        this.gameActive = true;
        if (this.aiMode) this.ai = new YambAI(this, this.aiDifficulty);
        
        this.createScoreTables();
        this.updateDiceVisuals();
        this.updateTableVisuals();
        
        const btnBacaj = document.getElementById('btn-bacaj');
        const btnNajava = document.getElementById('btn-najava');
        
        if (this.brojBacanja === 0 || this.brojBacanja < 3) btnBacaj.innerText = "BACAJ";
        else btnBacaj.innerText = "UPIŠI";
        
        btnBacaj.disabled = !this.isMyTurn();
        
        if (this.najavaAktivna) {
            btnNajava.innerText = "OPOZOVI";
            btnNajava.style.background = "var(--danger)";
        } else if (this.brojBacanja === 1 && this.isMyTurn()) {
            btnNajava.disabled = false;
        } else {
            btnNajava.disabled = true;
        }

        this.highlightCurrentPlayer();
        
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('ai-menu').classList.add('hidden');
        document.getElementById('online-modal').classList.add('hidden');
        document.getElementById('waiting-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        
        this.sendSystemMessage("Stanje igre vraćeno.");
    }
    
    isMyTurn() {
        if(this.onlineMode) return this.currentPlayerIdx === this.myOnlineIndex;
        return !this.players[this.currentPlayerIdx].includes("AI");
    }

    setupSocketListeners() {
        if(!this.onlineSupported) return;

        this.socket.on('highscore_update', (data) => {
            this.globalHighscores = data;
            if (!document.getElementById('highscore-modal').classList.contains('hidden')) {
                this.updateHighscoresUI(true);
            }
        });

        this.socket.on('rejoin_success', (data) => {
            this.roomId = data.roomId;
            this.onlineMode = true;
            this.sendSystemMessage("Uspešno ste se vratili u igru!");
            document.getElementById('menu-screen').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');
        });
        
        this.socket.on('rejoin_failed', () => {
            this.sendSystemMessage("Nije moguće vratiti se u igru.");
            this.gameActive = false;
            localStorage.removeItem('yamb_active_game');
            this.showMainMenu();
        });

        this.socket.on('game_start', (data) => { 
            this.roomId = data.roomCode || data.roomId; 
            this.myOnlineIndex = data.myIndex; 
            this.onlineMode = true; 
            const opponentName = data.players.find(p => p !== this.playerName) || "Protivnik";
            this.players = this.myOnlineIndex === 0 ? [this.playerName, opponentName] : [opponentName, this.playerName]; 
            
            this.allScores = []; 
            this.players.forEach(() => { 
                let sheet = {}; 
                KOLONE.forEach(c => { 
                    sheet[c] = {}; 
                    REDOVI_IGRA.forEach(r => sheet[c][r] = null); 
                }); 
                this.allScores.push(sheet); 
            }); 
            
            this.currentPlayerIdx = 0; 
            this.saveStateToLocal();
            this.startGame(); 
        }); 

        this.socket.on('remote_move', (data) => { 
            const opIndex = (this.myOnlineIndex === 0) ? 1 : 0; 
            this.allScores[opIndex][data.col][data.row] = data.points; 
            this.updateTableVisuals(); 
            this.switchPlayer(); 
            this.sendSystemMessage(`Protivnik: ${data.points} (${data.col}-${data.row})`); 
            this.vibrate(200); 
        }); 

        this.socket.on('remote_action', (action) => {
            const statusLabel = document.getElementById('lbl-turn');
            if (action === 'rolling') {
                statusLabel.innerText = "PROTIVNIK BACA...";
                statusLabel.style.color = "var(--primary)";
                this.animateDiceRemote(); 
            } else if (action === 'thinking') {
                statusLabel.innerText = "Protivnik razmišlja...";
            } else if (action === 'holding') {
                statusLabel.innerText = "Protivnik bira kocke...";
            }
        });

        this.socket.on('remote_chat', (msg) => { 
            const opName = this.players[(this.myOnlineIndex === 0) ? 1 : 0]; 
            this.appendChat(opName, msg, "msg-ai"); 
            this.soundMgr.chat(); 
            this.vibrate([100, 50, 100]);
        }); 

        this.socket.on('opponent_left_temp', () => {
            this.sendSystemMessage("Protivnik je izgubio vezu. Čekamo povratak...");
        });

        this.socket.on('opponent_left', () => { 
            this.gameActive = false; 
            this.appendChat("SYSTEM", `IGRAČ JE IZAŠAO!`, "msg-error"); 
            localStorage.removeItem('yamb_active_game');
            setTimeout(() => {
                this.modal.alert("KRAJ", "Protivnik je napustio igru!\n\nVI STE POBEDNIK! 🏆").then(() => {
                    this.cancelOnline();
                });
            }, 500);
        }); 

        this.socket.on('error_msg', (msg) => { 
            this.modal.alert("Greška", msg).then(() => this.showMainMenu());
        }); 
    }

    async animateDiceRemote() {
        const dice = document.querySelectorAll('.dice');
        dice.forEach(d => d.classList.add('rolling'));
        await sleep(500);
        dice.forEach(d => d.classList.remove('rolling'));
    }

    checkUrlInvite() {
        if(!this.onlineSupported) return;
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        if (roomCode) {
            setTimeout(() => { 
                this.modal.confirm("Poziv za igru", `Želiš li da uđeš u sobu: ${roomCode}?`)
                    .then(yes => {
                        if (yes) {
                            window.history.replaceState({}, document.title, window.location.pathname);
                            if (!this.playerName || this.playerName === "Igrač") {
                                this.modal.prompt("Ime", "Unesite Vaš nadimak:")
                                    .then(name => {
                                        if(name) {
                                            this.playerName = name;
                                            localStorage.setItem('yamb_player_name', name);
                                            this.connectAndFindGame(this.playerName, roomCode);
                                        }
                                    });
                            } else {
                                this.connectAndFindGame(this.playerName, roomCode);
                            }
                        }
                    });
            }, 500);
        }
    }
    
    uiInit() { 
        const diceCont = document.getElementById('dice-container'); 
        for (let i = 0; i < 6; i++) { 
            let btn = document.createElement('div'); btn.className = 'dice'; btn.innerText = ''; btn.onclick = () => this.toggleHold(i); diceCont.appendChild(btn); this.diceBtns.push(btn); 
        } 
        document.getElementById('chat-input-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendChatFromModal(); }); 
    }
    applyTheme() { if (this.theme === 'light') document.body.classList.add('light-theme'); else document.body.classList.remove('light-theme'); }
    toggleTheme() { this.theme = this.theme === 'dark' ? 'light' : 'dark'; this.applyTheme(); }

    openChat() { document.getElementById('chat-modal').classList.remove('hidden'); document.getElementById('chat-fab').classList.remove('alert'); }
    closeChat() { document.getElementById('chat-modal').classList.add('hidden'); }
    
    sendQuickChat(text) {
        if (!this.gameActive) return;
        const sender = this.players[this.currentPlayerIdx].split(" ")[0];
        this.appendChat(sender, text, "msg-user");
        this.soundMgr.chat(); 
        if (this.onlineMode && this.socket) this.socket.emit('chat_msg', {roomId: this.roomId, msg: text});
    }

    sendChatFromModal() { const inp = document.getElementById('chat-input-modal'); const msg = inp.value.trim(); if (!msg) return; const sender = this.players[this.currentPlayerIdx].split(" ")[0]; this.appendChat(sender, msg, "msg-user"); inp.value = ""; this.soundMgr.chat(); if (this.onlineMode && this.socket) this.socket.emit('chat_msg', {roomId: this.roomId, msg: msg}); else if (this.aiMode && this.gameActive && this.ai) setTimeout(() => this.aiChatResponse(), 1500); }
    appendChat(sender, msg, cls) { 
        const box = document.getElementById('chat-display-modal'); 
        const d = document.createElement('div'); 
        d.style.marginBottom = "5px"; 
        const strong = document.createElement('strong');
        strong.style.color = "var(--primary)";
        strong.textContent = sender + ": ";
        const span = document.createElement('span');
        span.textContent = msg;
        d.appendChild(strong);
        d.appendChild(span);
        box.appendChild(d); box.scrollTop = box.scrollHeight; if(document.getElementById('chat-modal').classList.contains('hidden')) document.getElementById('chat-fab').classList.add('alert'); 
    }
    sendSystemMessage(msg) { this.appendChat("INFO", msg, "msg-system"); }
    aiChatResponse() { const responses = ["Zanimljivo...", "Dobar pokušaj.", "Pratim te.", "Samo polako.", "Neće ti to proći."]; if (this.aiDifficulty === 'insane') responses.push(...this.ai.chatPhrases); this.appendChat("🤖 AI", responses[Math.floor(Math.random()*responses.length)], "msg-ai"); this.soundMgr.chat(); }

    showSettings() { document.getElementById('settings-modal').classList.remove('hidden'); document.getElementById('settings-modal').style.display = 'flex'; document.getElementById('setting-name').value = this.playerName; document.getElementById('setting-sound').checked = this.soundEnabled; }
    saveSettings() { const newName = document.getElementById('setting-name').value.trim(); if(newName) this.playerName = newName; this.soundEnabled = document.getElementById('setting-sound').checked; localStorage.setItem('yamb_player_name', this.playerName); localStorage.setItem('yamb_sound', this.soundEnabled); document.getElementById('settings-modal').classList.add('hidden'); }
    showStats() { 
        try { this.stats = JSON.parse(localStorage.getItem('yamb_stats')) || { games: 0, wins: 0, highscore: 0 }; } catch(e) {}
        document.getElementById('stats-modal').classList.remove('hidden'); document.getElementById('stats-modal').style.display = 'flex'; 
        document.getElementById('stat-games').innerText = this.stats.games; 
        document.getElementById('stat-wins').innerText = this.stats.wins; 
        document.getElementById('stat-high').innerText = this.stats.highscore; 
    }
    
    showHighscores() { 
        document.getElementById('highscore-modal').classList.remove('hidden'); 
        document.getElementById('highscore-modal').style.display = 'flex'; 
        this.updateHighscoresUI(true); 
    }
    
    updateStats(score, isWin) { 
        this.stats.games = (this.stats.games || 0) + 1; 
        if(isWin) this.stats.wins = (this.stats.wins || 0) + 1; 
        const currentHigh = this.stats.highscore || 0;
        if(score > currentHigh) { this.stats.highscore = score; }
        localStorage.setItem('yamb_stats', JSON.stringify(this.stats)); 
        
        if (this.socket && this.socket.connected && score > 0) {
            this.socket.emit('submit_score', { name: this.playerName, score: score });
        }
    }

    showMainMenu() { document.getElementById('menu-screen').classList.remove('hidden'); document.getElementById('game-screen').classList.add('hidden'); document.getElementById('ai-menu').classList.add('hidden'); document.getElementById('waiting-screen').classList.add('hidden'); document.getElementById('rules-screen').classList.add('hidden'); document.getElementById('online-modal').classList.add('hidden'); }
    showRules() { document.getElementById('menu-screen').classList.add('hidden'); document.getElementById('rules-screen').classList.remove('hidden'); }
    showAiMenu() { this.soundMgr.resume(); document.getElementById('menu-screen').classList.add('hidden'); document.getElementById('ai-menu').classList.remove('hidden'); document.getElementById('ai-menu').style.display = 'flex'; }
    
    async quitToMenu() { 
        const sure = await this.modal.confirm("Izlaz", "Prekinuti igru i vratiti se u meni?");
        if (sure) { 
            if (this.turnTimer) clearTimeout(this.turnTimer);
            if(this.onlineMode && this.socket) {
                this.socket.emit('leave_room', {roomId: this.roomId}); 
                this.socket.disconnect(); 
            }
            this.gameActive = false;
            localStorage.removeItem('yamb_active_game');
            this.showMainMenu(); 
        } 
    }
    
    quitApp() { 
        if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
        } else if (navigator.device && navigator.device.exitApp) {
            navigator.device.exitApp();
        } else {
            window.close();
            this.modal.alert("Izlaz", "Pritisnite 'Home' dugme na telefonu za izlaz.");
        }
    }
    
    async startOnlineRandom() { 
        if(!this.onlineSupported) return this.modal.alert("Greška", "Online mod nije dostupan (fale biblioteke).");
        const nickname = await this.modal.prompt("Online", "Unesite Vaš nadimak:", this.playerName);
        if (!nickname) return; 
        this.connectAndFindGame(nickname, null); 
    }

    async createPrivateGame() { 
        if(!this.onlineSupported) return this.modal.alert("Greška", "Online mod nije dostupan.");
        const nickname = await this.modal.prompt("Nova Soba", "Unesite Vaš nadimak:", this.playerName);
        if (!nickname) return; 
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        const shareLink = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
        
        if (navigator.share) {
            try { await navigator.share({ title: 'Igramo Yamb!', text: `Kod sobe: ${roomCode}`, url: shareLink }); this.connectAndFindGame(nickname, roomCode); } 
            catch (err) { this.connectAndFindGame(nickname, roomCode); }
        } else {
            try { await navigator.clipboard.writeText(shareLink); await this.modal.alert("Link Kopiran!", `Kod sobe: ${roomCode}\nLink je u memoriji.`); this.connectAndFindGame(nickname, roomCode); } 
            catch (err) { await this.modal.alert("Kod Sobe", `KOD SOBE: ${roomCode}`); this.connectAndFindGame(nickname, roomCode); }
        }
    }

    async joinPrivateGame() { 
        if(!this.onlineSupported) return this.modal.alert("Greška", "Online mod nije dostupan.");
        const nickname = await this.modal.prompt("Ulazak", "Unesite Vaš nadimak:", this.playerName);
        if (!nickname) return; 
        const roomCode = document.getElementById('friend-code').value.trim().toUpperCase(); 
        if (!roomCode) return this.modal.alert("Greška", "Unesi kod sobe!"); 
        this.connectAndFindGame(nickname, roomCode); 
    }
    
    connectAndFindGame(nickname, roomCode) { 
        document.getElementById('menu-screen').classList.add('hidden'); 
        document.getElementById('online-modal').classList.add('hidden'); 
        document.getElementById('waiting-screen').classList.remove('hidden'); 
        
        const waitMsg = document.getElementById('wait-msg');
        waitMsg.innerText = "Povezivanje na server...";
        let slowConnectTimer = setTimeout(() => { waitMsg.innerText = "Budim server (može potrajati)..."; }, 3000);

        if (!this.socket.connected) this.socket.connect();

        const sendRequest = () => {
            clearTimeout(slowConnectTimer);
            waitMsg.innerText = roomCode ? `Čekam u sobi: ${roomCode}` : "Tražim protivnika..."; 
            if (roomCode) this.socket.emit('join_room', {nickname: nickname, roomCode: roomCode});
            else this.socket.emit('find_game', nickname);
        };

        if (this.socket.connected) sendRequest();
        else this.socket.once('connect', () => sendRequest());
    }
    cancelOnline() { if(this.socket && this.onlineSupported) this.socket.disconnect(); this.showMainMenu(); }
    
    setupGame(numPlayers, aiMode=false, diff='medium') { this.soundMgr.resume(); this.onlineMode = false; this.players = []; this.allScores = []; this.aiMode = aiMode; this.aiDifficulty = diff; if (aiMode) { let name = this.playerName; this.players.push(name); const labels = {easy:"Lak", medium:"Srednji", hard:"Težak", insane:"Ultra"}; this.players.push(`🤖 AI (${labels[diff]})`); this.ai = new YambAI(this, diff); } else { this.ai = null; if (numPlayers === 1) { this.players.push(this.playerName); } } this.players.forEach(() => { let sheet = {}; KOLONE.forEach(c => { sheet[c] = {}; REDOVI_IGRA.forEach(r => sheet[c][r] = null); }); this.allScores.push(sheet); }); this.currentPlayerIdx = 0; this.startGame(); }
    
    startGame() { 
        document.getElementById('menu-screen').classList.add('hidden'); 
        document.getElementById('ai-menu').classList.add('hidden'); 
        document.getElementById('waiting-screen').classList.add('hidden'); 
        document.getElementById('game-screen').classList.remove('hidden'); 
        document.getElementById('online-modal').classList.add('hidden'); 
        
        this.createScoreTables(); 
        document.getElementById('chat-display-modal').innerHTML = ""; 
        this.resetTurnLogic(); 
        this.gameActive = true; 
        
        this.saveStateToLocal(); // Save initial state

        const chatFab = document.getElementById('chat-fab');
        if (this.players.length === 1 && !this.onlineMode) chatFab.classList.add('hidden');
        else chatFab.classList.remove('hidden');

        if (this.onlineMode) this.sendSystemMessage("Online igra je počela!"); 
        else this.sendSystemMessage("Dobrodošli!"); 
    }
    
    createScoreTables() { 
        const container = document.getElementById('tables-container'); container.innerHTML = ''; 
        this.players.forEach((player, pIdx) => { 
            const tableDiv = document.createElement('div'); tableDiv.className = 'player-table'; tableDiv.id = `ptable-${pIdx}`; 
            
            const nameDiv = document.createElement('div'); nameDiv.className = 'player-name'; 
            nameDiv.innerText = (this.onlineMode && pIdx === this.myOnlineIndex) ? player + " (TI)" : player; 
            tableDiv.appendChild(nameDiv); 
            
            const scrollWrapper = document.createElement('div'); scrollWrapper.className = 'table-responsive';
            const grid = document.createElement('div'); grid.className = 'grid-container'; 
            const syms = ["", "↓", "S", "⇅", "↑", "R", "📢"]; 
            const classes = ["", "c-nadole", "c-slobodna", "c-sredina", "c-nagore", "c-rucno", "c-najava"]; 
            syms.forEach((s, i) => { let d = document.createElement('div'); d.className = 'grid-cell col-header ' + classes[i]; d.innerText = s; grid.appendChild(d); }); 
            REDOVI_PRIKAZ.forEach(row => { 
                let lbl = document.createElement('div'); lbl.className = 'grid-cell row-header' + (row.includes("ZBIR") ? " sum" : ""); lbl.innerText = row; grid.appendChild(lbl); 
                KOLONE.forEach(col => { 
                    let cell = document.createElement('div'); cell.className = 'grid-cell'; 
                    if (row.includes("ZBIR")) { cell.style.fontWeight = 'bold'; cell.innerText = "0"; cell.id = `sum-${pIdx}-${col}-${row}`; } 
                    else { let btn = document.createElement('button'); btn.className = 'score-btn'; btn.id = `btn-${pIdx}-${col}-${row}`; btn.onclick = () => this.writeScore(row, col, pIdx); btn.disabled = true; cell.appendChild(btn); } 
                    grid.appendChild(cell); 
                }); 
            }); 
            scrollWrapper.appendChild(grid); tableDiv.appendChild(scrollWrapper); 
            let totalDiv = document.createElement('div'); totalDiv.className = 'total-score'; totalDiv.id = `total-${pIdx}`; totalDiv.innerText = "0"; tableDiv.appendChild(totalDiv); 
            container.appendChild(tableDiv); 
        }); 
    }
    
    resetTurnLogic() { 
        this.kockiceVals = [0,0,0,0,0,0]; 
        this.zadrzane = [false,false,false,false,false,false]; 
        this.brojBacanja = 0; 
        this.najavaAktivna = false; 
        this.najavljenoPolje = null; 
        this.history = null; 
        document.getElementById('lbl-status').innerText = "Bacanje: 0/3"; 
        
        let labelTurn = document.getElementById('lbl-turn');
        labelTurn.innerText = this.players[this.currentPlayerIdx]; 
        labelTurn.style.color = "var(--text-main)";

        let isMyTurn = (this.currentPlayerIdx === this.myOnlineIndex); 
        if (!this.onlineMode) isMyTurn = true; 
        const isAi = this.players[this.currentPlayerIdx].includes("AI"); 
        
        let controlsEnabled = true; 
        if (isAi) controlsEnabled = false; 
        if (this.onlineMode && !isMyTurn) controlsEnabled = false; 

        if (this.onlineMode && isMyTurn) {
             this.socket.emit('game_action', { roomId: this.roomId, action: 'thinking' });
             this.vibrate(200); 
        }

        document.getElementById('btn-bacaj').disabled = !controlsEnabled; 
        document.getElementById('btn-bacaj').innerText = "BACAJ"; 
        document.getElementById('btn-najava').disabled = true; 
        document.getElementById('btn-najava').innerText = "NAJAVA"; 
        document.getElementById('btn-najava').style.background = "var(--bg-grid)"; 
        document.getElementById('btn-najava').style.color = "var(--text-main)"; 
        document.getElementById('btn-undo').disabled = true; 
        this.diceBtns.forEach(b => { b.innerText = ""; b.className = 'dice'; }); 
        
        this.highlightCurrentPlayer(); 
        this.updateTableVisuals(); 
        
        // Save state on turn start
        this.saveStateToLocal();

        if (isAi) setTimeout(() => this.runAiTurn(), Math.random() * 1500 + 1000); 
    }

    highlightCurrentPlayer() { document.querySelectorAll('.player-table').forEach(el => el.classList.remove('active')); document.getElementById(`ptable-${this.currentPlayerIdx}`).classList.add('active'); }
    
    toggleHold(i) { 
        if (this.brojBacanja === 0) return; 
        if (this.onlineMode && this.currentPlayerIdx !== this.myOnlineIndex) return; 
        this.zadrzane[i] = !this.zadrzane[i]; 
        this.updateDiceVisuals(); 
        this.soundMgr.click(); 
        this.vibrate(30); 
        if (this.onlineMode) {
             this.socket.emit('game_action', { roomId: this.roomId, action: 'holding' });
        }
    }
    
    updateDiceVisuals() { this.diceBtns.forEach((b, i) => { if (this.brojBacanja > 0) { b.innerText = DICE_SYMBOLS[this.kockiceVals[i]]; b.className = this.zadrzane[i] ? 'dice held' : 'dice active'; } else { b.innerText = ""; b.className = 'dice'; } }); }
    
    async throwDice() { 
        if (this.brojBacanja >= 3) return; 
        
        // Javljamo protivniku da bacamo
        if (this.onlineMode) {
             this.socket.emit('game_action', { roomId: this.roomId, action: 'rolling' });
        }

        const btnBacaj = document.getElementById('btn-bacaj');
        btnBacaj.disabled = true; 
        document.getElementById('btn-undo').disabled = true; 
        
        this.soundMgr.roll(); 
        this.vibrate(100);
        this.diceBtns.forEach((b, i) => { if (!this.zadrzane[i]) { b.classList.add('rolling'); b.innerText = ""; } });

        await sleep(600);

        for(let i=0; i<6; i++) { if (!this.zadrzane[i]) { this.kockiceVals[i] = Math.floor(Math.random()*6)+1; } } 
        
        this.brojBacanja++; 
        document.getElementById('lbl-status').innerText = `Bacanje: ${this.brojBacanja}/3`; 
        
        this.diceBtns.forEach(b => b.classList.remove('rolling'));
        this.updateDiceVisuals(); 
        this.updateTableVisuals(); 

        if (this.onlineMode) {
             this.socket.emit('game_action', { roomId: this.roomId, action: 'thinking' });
        }

        const isAi = this.players[this.currentPlayerIdx].includes("AI"); 
        const isOnlineTurn = this.onlineMode && (this.currentPlayerIdx === this.myOnlineIndex); 
        
        if (!isAi && (!this.onlineMode || isOnlineTurn)) { 
            if (this.brojBacanja < 3) { btnBacaj.disabled = false; } else { btnBacaj.disabled = true; btnBacaj.innerText = "UPIŠI"; } 
            
            const btnNajava = document.getElementById('btn-najava'); 
            if (this.brojBacanja === 1) { btnNajava.disabled = false; btnNajava.style.background = "var(--col-najava)"; btnNajava.style.color = "black"; } 
            else if (!this.najavaAktivna) { btnNajava.disabled = true; btnNajava.style.background = "var(--bg-grid)"; btnNajava.style.color = "var(--text-muted)"; } 
        } 
        
        this.saveStateToLocal();
    }
    
    clickNajava() { 
        if (this.brojBacanja !== 1) return; 
        const btn = document.getElementById('btn-najava'); 
        const btnBacaj = document.getElementById('btn-bacaj'); 
        
        if (!this.najavaAktivna) { 
            this.najavaAktivna = true; btn.innerText = "OPOZOVI"; btn.style.background = "var(--danger)"; btn.style.color = "white"; btnBacaj.disabled = true;
            this.sendSystemMessage("NAJAVA: Klikni polje."); 
        } else { 
            this.najavaAktivna = false; btn.innerText = "NAJAVA"; btn.style.background = "var(--col-najava)"; btn.style.color = "black"; btnBacaj.disabled = false; 
            this.sendSystemMessage("Najava opozvana."); 
        } 
    }
    
    isValidColumnOrder(row, col, sheet) { if (col === "Nadole") { const idx = REDOVI_IGRA.indexOf(row); if (idx > 0 && sheet["Nadole"][REDOVI_IGRA[idx-1]] === null) return false; } if (col === "Nagore") { const idx = REDOVI_IGRA.indexOf(row); if (idx < REDOVI_IGRA.length-1 && sheet["Nagore"][REDOVI_IGRA[idx+1]] === null) return false; } if (col === "Sredina") { const up = ["Max", "6", "5", "4", "3", "2", "1"]; const down = ["Min", "Triling", "Kenta", "Ful", "Poker", "Yamb"]; if (up.includes(row)) { const idx = up.indexOf(row); if (idx > 0 && sheet["Sredina"][up[idx-1]] === null) return false; } else if (down.includes(row)) { const idx = down.indexOf(row); if (idx > 0 && sheet["Sredina"][down[idx-1]] === null) return false; } } return true; }
    
    async writeScore(row, col, pIdx) { 
        if (pIdx !== this.currentPlayerIdx) return; 
        if (this.onlineMode && pIdx !== this.myOnlineIndex) return; 
        if (this.brojBacanja === 0) { this.soundMgr.error(); return this.modal.alert("Greška", "Prvo baci kockice!"); } 
        const sheet = this.allScores[pIdx]; 
        if (sheet[col][row] !== null) { this.soundMgr.error(); return this.modal.alert("Greška", "Popunjeno!"); } 
        const isHuman = !this.players[pIdx].includes("AI"); 
        
        if (isHuman && this.najavaAktivna) { 
            if (col !== "Najava" || this.najavljenoPolje) { this.soundMgr.error(); return this.modal.alert("Greška", "Moraš u NAJAVU!"); } 
            this.najavljenoPolje = {row, col}; this.najavaAktivna = false; 
            document.getElementById(`btn-${pIdx}-${col}-${row}`).classList.add('highlight-najava'); 
            const btnN = document.getElementById('btn-najava'); btnN.innerText = `NAJAVA: ${row}`; btnN.disabled = true; btnN.style.background = "var(--bg-grid)"; 
            document.getElementById('btn-bacaj').disabled = false; 
            return; 
        } 
        
        let forcedZero = false; 
        if (col === "Ručno" && this.brojBacanja > 1) { 
            if (isHuman) {
                const confirmZero = await this.modal.confirm("Upozorenje", "Ručno je dozvoljeno samo u 1. bacanju. Upisom ovde dobijaš 0 poena. Nastavi?");
                if (!confirmZero) return;
            }
            forcedZero = true; 
        } 
        
        if (col === "Najava" && (!this.najavljenoPolje || this.najavljenoPolje.row !== row)) { this.soundMgr.error(); return this.modal.alert("Greška", "Samo najavljeno!"); } 
        if (!this.isValidColumnOrder(row, col, sheet)) { this.soundMgr.error(); return this.modal.alert("Greška", "Pogrešan redosled!"); } 
        
        if (isHuman && !this.onlineMode) { this.history = { coords: {row, col, pIdx}, dice: [...this.kockiceVals], cnt: this.brojBacanja, held: [...this.zadrzane], naj: this.najavaAktivna, naj_f: this.najavljenoPolje }; } 
        
        const best5 = this.getBest5(row, this.kockiceVals); 
        let pts = this.calcPoints(row, best5); 
        if (forcedZero) pts = 0; 
        sheet[col][row] = pts; 
        
        this.soundMgr.score(); 
        if (this.onlineMode && isHuman) { this.socket.emit('player_move', { roomId: this.roomId, row: row, col: col, points: pts }); } 
        if (this.aiMode && this.ai && !isHuman) { const react = this.ai.getReaction(pts); if (react) setTimeout(() => { this.appendChat("🤖 AI", react, "msg-ai"); this.soundMgr.chat(); }, 1000); } 
        
        this.updateTableVisuals(); 
        this.saveStateToLocal();
        
        if (isHuman) { 
            if (!this.onlineMode) document.getElementById('btn-undo').disabled = false; 
            const inputs = document.querySelectorAll(`#ptable-${pIdx} .score-btn`); inputs.forEach(b => b.disabled = true); 

            let isPlayerDone = true;
            KOLONE.forEach(c => { REDOVI_IGRA.forEach(r => { if (sheet[c][r] === null) isPlayerDone = false; }); });
            
            if (isPlayerDone) {
                document.getElementById('btn-undo').disabled = true; 
                if (this.players.length === 1) { setTimeout(() => this.handleGameOver(), 2000); return; }
            }

            if (this.turnTimer) clearTimeout(this.turnTimer);
            this.turnTimer = setTimeout(() => { this.switchPlayer(); this.turnTimer = null; }, isPlayerDone ? 2000 : 700); 
        } else { 
            this.switchPlayer(); 
        } 
    }
    
    undoMove() { 
        if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
        if (this.onlineMode) return; 
        if (!this.history) return; 
        
        const {row, col, pIdx} = this.history.coords; 
        this.allScores[pIdx][col][row] = null; 
        this.kockiceVals = this.history.dice; 
        this.brojBacanja = this.history.cnt; 
        this.zadrzane = this.history.held; 
        this.najavaAktivna = this.history.naj; 
        this.najavljenoPolje = this.history.naj_f; 
        
        document.getElementById('lbl-status').innerText = `Bacanje: ${this.brojBacanja}/3`; 
        this.updateDiceVisuals(); 
        this.updateTableVisuals(); 
        
        const btnBacaj = document.getElementById('btn-bacaj'); 
        const btnNajava = document.getElementById('btn-najava'); 
        
        if (this.brojBacanja < 3) { btnBacaj.disabled = false; btnBacaj.innerText = "BACAJ"; } else { btnBacaj.disabled = true; btnBacaj.innerText = "UPIŠI"; } 
        
        if (this.najavaAktivna) { btnNajava.disabled = false; btnNajava.innerText = "OPOZOVI"; btnNajava.style.background = "var(--danger)"; btnBacaj.disabled = true; } 
        else if (this.brojBacanja === 1) { btnNajava.disabled = false; btnNajava.innerText = "NAJAVA"; btnNajava.style.background = "var(--col-najava)"; btnBacaj.disabled = false; } 
        else { btnNajava.disabled = true; } 
        this.history = null; 
        document.getElementById('btn-undo').disabled = true; 
        this.saveStateToLocal();
    }
    
    switchPlayer() { 
        let gameOver = true; 
        this.allScores.forEach(s => { KOLONE.forEach(c => { REDOVI_IGRA.forEach(r => { if (s[c][r] === null) gameOver = false; }); }); }); 
        if (gameOver) { this.handleGameOver(); return; } 
        this.currentPlayerIdx = (this.currentPlayerIdx + 1) % this.players.length; 
        this.resetTurnLogic(); 
    }
    
    async handleGameOver() { 
        this.gameActive = false; 
        document.getElementById('btn-undo').disabled = true;
        localStorage.removeItem('yamb_active_game'); 
        
        const results = []; 
        this.players.forEach((name, i) => { 
            let total = parseInt(document.getElementById(`total-${i}`).innerText); 
            results.push({name, score: total}); 
            this.localHighscores.push([name, total]); 
        }); 
        
        results.sort((a,b) => b.score - a.score); 
        
        const myName = this.players[0]; 
        const myResultObj = results.find(r => r.name === myName);
        const myScore = myResultObj ? myResultObj.score : 0;
        
        let isWin = (this.players.length > 1 && results[0].name === myName);
        
        this.updateStats(myScore, isWin); 

        this.localHighscores.sort((a,b) => b[1] - a[1]); 
        this.saveHighscores(); 
        this.updateHighscoresUI(); 
        
        let isNewRecord = (this.players.length === 1 && myScore > 0 && myScore >= this.stats.highscore);
        try { this.soundMgr.win(); } catch(e){}

        let title = "KRAJ IGRE"; let msg = "";
        if (this.players.length === 1) {
            if (isNewRecord) { title = "🏆 NOVI REKORD! 🏆"; msg = `BRAVO!\nPostavili ste novi lični rekord: ${myScore} poena!`; try { if(typeof confetti === 'function') confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } }); } catch(e){} } 
            else { title = "Čestitamo!"; msg = `Uspešno ste završili igru.\n\nOsvojeni bodovi: ${myScore}`; try { if(myScore > 800 && typeof confetti === 'function') confetti({ particleCount: 100, spread: 60, origin: { y: 0.6 } }); } catch(e){} }
        } else {
            if (isWin) { title = "🎉 POBEDA! 🎉"; msg = `ČESTITAMO!\nPobedili ste sa ${myScore} poena!`; try { if(typeof confetti === 'function') confetti({ particleCount: 200, spread: 90, origin: { y: 0.6 } }); } catch(e){} } 
            else { title = "Više sreće drugi put"; msg = `Pobednik je ${results[0].name} (${results[0].score} poena).`; }
        }
        await this.modal.alert(title, msg);
        if(this.onlineMode) this.cancelOnline(); else this.showMainMenu(); 
    }
    
    async runAiTurn() { 
        const aiIdx = this.currentPlayerIdx; 
        const sheet = this.allScores[aiIdx]; 
        
        const myScore = parseInt(document.getElementById(`total-${aiIdx}`).innerText);
        const playerIdx = (aiIdx + 1) % this.players.length;
        const opponentScore = parseInt(document.getElementById(`total-${playerIdx}`).innerText);

        if (this.brojBacanja === 0) { 
            await this.throwDice(); 
            setTimeout(() => this.runAiTurn(), Math.random() * 1000 + 800); 
            return; 
        } 
        
        const decision = this.ai.decideRoll(this.kockiceVals, this.brojBacanja, sheet, myScore, opponentScore); 
        
        if (decision.type === 'write') { 
            this.writeScore(decision.row, decision.col, aiIdx); 
        } else if (decision.type === 'hold') { 
            this.zadrzane = decision.hold; 
            this.updateDiceVisuals(); 
            await this.throwDice(); 
            setTimeout(() => this.runAiTurn(), Math.random() * 1000 + 800); 
        } 
    }
    
    getBest5(row, dice) { const d = [...dice]; if (row === "Min") return d.sort((a,b)=>a-b).slice(0,5); if (row === "Max") return d.sort((a,b)=>b-a).slice(0,5); if (row === "Kenta") { const u = [...new Set(d)].sort((a,b)=>a-b); if ([2,3,4,5,6].every(v=>u.includes(v))) return [2,3,4,5,6]; if ([1,2,3,4,5].every(v=>u.includes(v))) return [1,2,3,4,5]; return d.sort((a,b)=>b-a).slice(0,5); } if (row === "Ful") { const c = {}; d.forEach(x => c[x] = (c[x]||0)+1); const k = Object.keys(c).map(Number); if (k.some(x => c[x] >= 5)) return Array(5).fill(k.find(x => c[x]>=5)); const threes = k.filter(x => c[x]>=3); const pairs = k.filter(x => c[x]>=2); let cands = []; threes.forEach(t => { pairs.forEach(p => { if (t!==p) cands.push([...Array(3).fill(t), ...Array(2).fill(p)]); }); }); if (cands.length > 0) return cands.sort((a,b) => sum(b)-sum(a))[0]; } if (["1","2","3","4","5","6"].includes(row)) { const t = parseInt(row); const match = d.filter(x => x===t); const rest = d.filter(x => x!==t).sort((a,b)=>b-a); return [...match, ...rest].slice(0,5); } const c = {}; d.forEach(x => c[x] = (c[x]||0)+1); d.sort((a,b) => { if (c[b] !== c[a]) return c[b] - c[a]; return b - a; }); return d.slice(0,5); }
    calcPoints(row, v) { const s = sum(v); if (["1","2","3","4","5","6"].includes(row)) return v.filter(x => x===parseInt(row)).length * parseInt(row); if (row === "Max" || row === "Min") return s; if (row === "Triling") { const c={}; v.forEach(x=>c[x]=(c[x]||0)+1); if(Object.values(c).some(cnt=>cnt>=3)) return (3*Number(Object.keys(c).find(k=>c[k]>=3)))+20; return 0; } if (row === "Kenta") { const u = [...new Set(v)].sort((a,b)=>a-b); const k1 = [1,2,3,4,5].every(x=>u.includes(x)); const k2 = [2,3,4,5,6].every(x=>u.includes(x)); if (k1 || k2) { if (this.brojBacanja === 1) return 66; if (this.brojBacanja === 2) return 56; return 46; } return 0; } if (row === "Ful") { const c={}; v.forEach(x=>c[x]=(c[x]||0)+1); if (Object.values(c).includes(5) || (Object.values(c).includes(3) && Object.values(c).includes(2))) return s + 30; return 0; } if (row === "Poker") { const c={}; v.forEach(x=>c[x]=(c[x]||0)+1); if(Object.values(c).some(cnt=>cnt>=4)) return (Number(Object.keys(c).find(k=>c[k]>=4))*4)+40; return 0; } if (row === "Yamb") { const c={}; v.forEach(x=>c[x]=(c[x]||0)+1); if(Object.values(c).some(cnt=>cnt>=5)) return (Number(Object.keys(c).find(k=>c[k]>=5))*5)+50; return 0; } return 0; }
    
    updateTableVisuals() { 
        this.players.forEach((p, idx) => { 
            const isTurn = (idx === this.currentPlayerIdx && !p.includes("AI")); const data = this.allScores[idx]; let grandTotal = 0; 
            KOLONE.forEach(col => { 
                let sum1 = 0; ["1","2","3","4","5","6"].forEach(r => { if(data[col][r]!==null) sum1 += data[col][r]; }); if(sum1 >= 60) sum1 += 30; document.getElementById(`sum-${idx}-${col}-ZBIR 1`).innerText = sum1; 
                let sum2 = 0; const vMax = data[col]["Max"]; const vMin = data[col]["Min"]; const v1 = data[col]["1"]; if (vMax!==null && vMin!==null && v1!==null) sum2 = (vMax - vMin) * v1; document.getElementById(`sum-${idx}-${col}-ZBIR 2`).innerText = sum2; 
                let sum3 = 0; ["Triling","Kenta","Ful","Poker","Yamb"].forEach(r => { if(data[col][r]!==null) sum3 += data[col][r]; }); document.getElementById(`sum-${idx}-${col}-ZBIR 3`).innerText = sum3; 
                grandTotal += sum1 + sum2 + sum3; 
                REDOVI_IGRA.forEach(row => { 
                    const btn = document.getElementById(`btn-${idx}-${col}-${row}`); const val = data[col][row]; btn.classList.remove('highlight-najava'); 
                    if (val !== null) { btn.innerText = val; btn.classList.add('filled'); btn.disabled = true; } 
                    else { btn.innerText = ""; btn.classList.remove('filled'); const isMyTurnOnline = (this.onlineMode && this.currentPlayerIdx === this.myOnlineIndex && idx === this.myOnlineIndex); const isLocalTurn = (!this.onlineMode && isTurn); if ((isMyTurnOnline || isLocalTurn) && this.brojBacanja > 0) btn.disabled = false; else btn.disabled = true; if (this.najavljenoPolje && this.najavljenoPolje.row === row && this.najavljenoPolje.col === col) btn.classList.add('highlight-najava'); } 
                }); 
            }); 
            document.getElementById(`total-${idx}`).innerText = grandTotal; 
        }); 
    }
    
    loadHighscores() { try { const saved = localStorage.getItem('yamb_highscores'); if (saved) this.localHighscores = JSON.parse(saved); else this.localHighscores = [["YambMaster", 1250], ["Srećko", 1100], ["Ana", 980]]; } catch(e) { this.localHighscores = []; } this.localHighscores.sort((a,b) => b[1] - a[1]); }
    saveHighscores() { localStorage.setItem('yamb_highscores', JSON.stringify(this.localHighscores.slice(0, 20))); }
    
    updateHighscoresUI(isModal=false) { 
        const list = isModal ? document.getElementById('hs-list-modal') : document.getElementById('hs-list'); 
        if (!list) return;
        list.innerHTML = ""; 
        const source = (this.globalHighscores.length > 0) ? this.globalHighscores : this.localHighscores;
        
        if (this.globalHighscores.length > 0) {
            let h3 = document.createElement("h3");
            h3.innerText = "🌍 GLOBALNA LISTA";
            h3.style.color = "var(--primary)";
            h3.style.margin = "0 0 10px 0";
            h3.style.fontSize = "14px";
            list.appendChild(h3);
        }

        source.slice(0, 15).forEach((hs, i) => { 
            let li = document.createElement('li'); 
            li.style.padding="5px 0"; li.style.borderBottom="1px solid var(--bg-grid)"; 
            let name, score;
            if (Array.isArray(hs)) { name = hs[0]; score = hs[1]; }
            else { name = hs.name; score = hs.score; }
            li.innerText = `${i+1}. ${name} - ${score}`; 
            list.appendChild(li); 
        }); 
    }
    
    async saveGame() { 
        const data = { players: this.players, scores: this.allScores, current: this.currentPlayerIdx, aiMode: this.aiMode, diff: this.aiDifficulty, onlineMode: this.onlineMode, roomId: this.roomId, myIndex: this.myOnlineIndex }; 
        const jsonStr = JSON.stringify(data, null, 2);

        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Yamb Save',
                    text: jsonStr
                });
                return;
            } catch(e) {}
        }

        try {
            await navigator.clipboard.writeText(jsonStr);
            this.modal.alert("Kopirano!", "Kod igre je kopiran! \nMožete ga nalepiti u beleške ili poslati porukom.");
        } catch (err) {
            this.modal.alert("Greška", "Nije moguće sačuvati igru na ovom uređaju.");
        }
    }

    loadGameFromFile() { 
        this.modal.confirm("Učitaj Igru", "Želite li da nalepite kod igre iz memorije?", "NALEPI", "OTKAŽI").then(choice => {
            if (choice === true) {
                navigator.clipboard.readText().then(text => {
                     try { const data = JSON.parse(text); this.restoreGameState(data); this.sendSystemMessage("Igra učitana!"); } catch(e) { this.modal.alert("Greška", "Nevažeći kod u memoriji!"); }
                }).catch(() => {
                    this.modal.prompt("Učitaj Kod", "Nalepite kod igre ovde:").then(text => {
                        if(text) { try { const data = JSON.parse(text); this.restoreGameState(data); } catch(e) { this.modal.alert("Greška", "Nevažeći kod!"); } }
                    });
                });
            }
        });
    }
    
    donate() { const url = "https://www.paypal.com"; window.open(url, '_blank'); }
}
export class SoundManager {
    constructor() { 
        this.ctx = window.AudioContext ? new window.AudioContext() : new window.webkitAudioContext();
        this.resumed = false;
    }
    
    // Provera da li je zvuk uključen preko globalne app instance
    isEnabled() {
        return window.app && window.app.soundEnabled;
    }

    resume() {
        if (!this.resumed && this.ctx) {
            this.ctx.resume().then(() => {
                this.resumed = true;
            });
        }
    }
    
    playTone(freq, type, duration, vol=0.1) { 
        if (!this.isEnabled()) return; 
        if (!this.resumed) this.resume();
        try { 
            const osc = this.ctx.createOscillator(); 
            const gain = this.ctx.createGain(); 
            osc.type = type; 
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime); 
            gain.gain.setValueAtTime(vol, this.ctx.currentTime); 
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration); 
            osc.connect(gain); 
            gain.connect(this.ctx.destination); 
            osc.start(); 
            osc.stop(this.ctx.currentTime + duration); 
        } catch(e) {} 
    }
    
    click() { this.playTone(800, 'sine', 0.05, 0.05); }
    
    roll() { 
        if (!this.isEnabled()) return; 
        try { 
            const bufferSize = this.ctx.sampleRate * 0.1; 
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate); 
            const data = buffer.getChannelData(0); 
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1; 
            const noise = this.ctx.createBufferSource(); 
            const gain = this.ctx.createGain(); 
            noise.buffer = buffer; 
            gain.gain.setValueAtTime(0.05, this.ctx.currentTime); 
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1); 
            noise.connect(gain); 
            gain.connect(this.ctx.destination); 
            noise.start(); 
        } catch(e){} 
    }
    
    score() { this.playTone(600, 'sine', 0.3, 0.1); setTimeout(()=>this.playTone(900, 'sine', 0.4, 0.1), 100); }
    error() { this.playTone(150, 'sawtooth', 0.3, 0.1); }
    win() { if(!this.isEnabled()) return; [0, 200, 400, 600].forEach((t, i) => setTimeout(() => this.playTone(400 + (i*100), 'square', 0.2, 0.1), t)); }
    chat() { this.playTone(1200, 'sine', 0.1, 0.05); }
}
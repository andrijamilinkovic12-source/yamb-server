import { KOLONE, REDOVI_IGRA } from '../constants.js';
import { sum } from '../utils.js';

export class YambAI {
    constructor(appInstance, difficulty) { 
        this.app = appInstance; 
        this.difficulty = difficulty; 
        this.chatPhrases = ["Gađam bonus.", "Ovo ide u Max.", "Min mora biti mali.", "Moram da rizikujem najavu."]; 
        // Osnovni težinski koeficijenti
        this.baseWeights = { "Nadole": 2.5, "Nagore": 2.5, "Najava": 2.2, "Ručno": 1.7, "Sredina": 1.1, "Slobodna": 1.0 }; 
    }
    
    getGameProgress(sheet) { let filled = 0; let total = 0; KOLONE.forEach(c => { REDOVI_IGRA.forEach(r => { total++; if (sheet[c][r] !== null) filled++; }); }); return filled / total; }
    countEmptyFields(sheet, col) { let cnt = 0; REDOVI_IGRA.forEach(r => { if (sheet[col][r] === null) cnt++; }); return cnt; }
    getUpperSum(sheet, col) { let s = 0; ["1", "2", "3", "4", "5", "6"].forEach(r => { if (sheet[col][r] !== null) s += sheet[col][r]; }); return s; }
    
    analyzeHand(dice) { const counts = {}; dice.forEach(x => counts[x] = (counts[x] || 0) + 1); const keys = Object.keys(counts).map(Number); const maxCount = Math.max(...Object.values(counts)); const valMaxCount = Number(Object.keys(counts).find(key => counts[key] === maxCount)); const uniqueDice = [...new Set(dice)].sort((a,b)=>a-b); let bestStraight = []; let maxStraightLen = 0; [[1,2,3,4,5], [2,3,4,5,6]].forEach(seq => { const match = seq.filter(x => uniqueDice.includes(x)); if (match.length > maxStraightLen) { maxStraightLen = match.length; bestStraight = match; } }); return { counts, maxCount, valMaxCount, pairs: keys.filter(k => counts[k] >= 2), triples: keys.filter(k => counts[k] >= 3), kenta: [1,2,3,4,5].every(x => uniqueDice.includes(x)) || [2,3,4,5,6].every(x => uniqueDice.includes(x)), nearKenta: maxStraightLen >= 3 ? bestStraight : [], sum: sum(dice), unique: uniqueDice }; }
    
    // --- NOVO: decideRoll prima i skorove ---
    decideRoll(dice, turnNum, sheet, myScore, opScore) { 
        const an = this.analyzeHand(dice); 
        const progress = this.getGameProgress(sheet); 
        
        // Dinamički prilagodi agresivnost
        let weights = {...this.baseWeights};
        const scoreDiff = myScore - opScore;
        
        // Ako gubimo kasno u igri, povećaj rizik
        if (progress > 0.6 && scoreDiff < -50) {
            weights["Ručno"] = 3.0; // Agresivnije na ručno
            weights["Najava"] = 3.0; 
        }

        if (turnNum === 1) { 
            const bestManual = this.checkManualWin(dice, sheet, an, weights); // Prosledi weights
            if (bestManual) return { type: 'write', row: bestManual, col: 'Ručno' }; 
            
            if (!this.app.najavaAktivna) { 
                const call = this.evaluateCall(dice, sheet, an, progress, scoreDiff); // Prosledi scoreDiff
                if (call) { 
                    this.app.clickNajava(); 
                    this.app.najavljenoPolje = { row: call, col: 'Najava' }; 
                    this.app.sendSystemMessage(`AI Najavljuje: ${call}`); 
                    return { type: 'hold', hold: this.decideHold(dice, turnNum, sheet, progress) }; 
                } 
            } 
        } 
        if (turnNum === 3) return this.findBestScore(dice, sheet, weights); // Prosledi weights
        return { type: 'hold', hold: this.decideHold(dice, turnNum, sheet, progress) }; 
    }
    
    evaluateCall(dice, sheet, an, progress, scoreDiff) { 
        // Agresivnija najava ako gubi
        const riskFactor = scoreDiff < -30 ? 0.8 : 1.0;

        if (an.maxCount >= 4) { 
            if (this.isAvail("Yamb", "Najava", sheet) && an.maxCount >= 5) return "Yamb"; 
            if (this.isAvail("Poker", "Najava", sheet)) return "Poker"; 
            if (this.isAvail(String(an.valMaxCount), "Najava", sheet)) return String(an.valMaxCount); 
        } 
        if (an.maxCount === 3) { 
            if (progress < (0.7 / riskFactor)) { // Spremniji na rizik ako gubi
                if ([4,5,6].includes(an.valMaxCount) && this.isAvail(String(an.valMaxCount), "Najava", sheet)) return String(an.valMaxCount); 
                if (this.isAvail("Triling", "Najava", sheet)) return "Triling"; 
            } else { 
                if (an.valMaxCount >= 4 && this.isAvail("Yamb", "Najava", sheet)) return "Yamb"; 
            } 
        } 
        const emptyNajava = this.countEmptyFields(sheet, "Najava"); 
        const emptyOthers = this.countEmptyFields(sheet, "Slobodna") + this.countEmptyFields(sheet, "Nadole") + this.countEmptyFields(sheet, "Nagore"); 
        if (emptyNajava > 0 && (emptyOthers < 4 || progress > 0.85)) { 
            if (this.isAvail(String(an.valMaxCount), "Najava", sheet)) return String(an.valMaxCount); 
            if (this.isAvail("Min", "Najava", sheet)) return "Min"; 
            if (this.isAvail("Max", "Najava", sheet)) return "Max"; 
            for (let r of REDOVI_IGRA) { if (this.isAvail(r, "Najava", sheet)) return r; } 
        } 
        return null; 
    }
    
    checkManualWin(dice, sheet, an, weights) { 
        // Ako je težina 'insane' ili gubi, pokušaj Yamb iz prve ako ima 4
        if (an.maxCount >= 5 && sheet["Ručno"]["Yamb"] === null) return "Yamb"; 
        if (an.kenta && sheet["Ručno"]["Kenta"] === null) return "Kenta"; 
        if (an.maxCount >= 4 && sheet["Ručno"]["Poker"] === null) return "Poker"; 
        if (an.sum >= 26 && sheet["Ručno"]["Max"] === null) return "Max"; 
        if (an.sum <= 8 && sheet["Ručno"]["Min"] === null) return "Min"; 
        return null; 
    }
    
    decideHold(dice, turnNum, sheet, progress) { const an = this.analyzeHand(dice); let targetRow = this.app.najavaAktivna && this.app.najavljenoPolje ? this.app.najavljenoPolje.row : null; if (targetRow) return this.holdForTarget(dice, targetRow, an); let prioritizeBonus = false; let bonusVal = 0; ["Slobodna", "Nadole", "Nagore"].forEach(col => { const s = this.getUpperSum(sheet, col); if (s < 60 && [4,5,6].includes(an.valMaxCount) && an.maxCount >= 2 && sheet[col][String(an.valMaxCount)] === null) { prioritizeBonus = true; bonusVal = an.valMaxCount; } }); if (prioritizeBonus && turnNum < 3) return dice.map(d => d === bonusVal); if (an.sum >= 22 && (sheet["Slobodna"]["Max"] === null || sheet["Nadole"]["Max"] === null)) return dice.map(d => d >= 5); if (an.sum <= 10 && (sheet["Slobodna"]["Min"] === null || sheet["Nagore"]["Min"] === null)) return dice.map(d => d <= 2); if (an.maxCount >= 3) return dice.map(d => d === an.valMaxCount); if (an.nearKenta.length >= 4 && sheet["Slobodna"]["Kenta"] === null) return dice.map(d => an.nearKenta.includes(d)); if (an.maxCount === 2 && an.valMaxCount >= 4) return dice.map(d => d === an.valMaxCount); return [false, false, false, false, false, false]; }
    
    holdForTarget(dice, target, an) { if (["1","2","3","4","5","6"].includes(target) || target === "Triling" || target === "Poker" || target === "Yamb") { let val = parseInt(target); if (isNaN(val)) val = an.valMaxCount; return dice.map(d => d === val); } if (target === "Kenta") { const needed = an.nearKenta.length > 0 ? an.nearKenta : [1,2,3,4,5]; const used = []; return dice.map(d => { if (needed.includes(d) && !used.includes(d)) { used.push(d); return true; } return false; }); } if (target === "Ful") { if (an.maxCount >= 3) return dice.map(d => d === an.valMaxCount || (an.pairs.length > 0 && d === an.pairs.find(p=>p!==an.valMaxCount))); return dice.map(d => d === an.valMaxCount); } if (target === "Max") return dice.map(d => d >= 4); if (target === "Min") return dice.map(d => d <= 2); return dice.map(d => false); }
    
    findBestScore(dice, sheet, weights = this.baseWeights) { 
        if (this.app.najavaAktivna && this.app.najavljenoPolje) { return { type: 'write', row: this.app.najavljenoPolje.row, col: this.app.najavljenoPolje.col }; } 
        let possible = []; 
        KOLONE.forEach(col => { 
            if (col === "Ručno" || col === "Najava") return; 
            const currentUpperSum = this.getUpperSum(sheet, col); 
            REDOVI_IGRA.forEach(row => { 
                if (sheet[col][row] === null && this.app.isValidColumnOrder(row, col, sheet)) { 
                    const best5 = this.app.getBest5(row, dice); 
                    const raw = this.app.calcPoints(row, best5); 
                    
                    // Koristimo dinamičke težine
                    let val = raw * (weights[col] || 1); 
                    
                    if (["1","2","3","4","5","6"].includes(row)) { const rowVal = parseInt(row); if (currentUpperSum < 60 && (currentUpperSum + raw) >= 60) val += 200; if (raw >= 3 * rowVal) val += 30; if (currentUpperSum < 60 && raw < 2 * rowVal) val -= 100; } if (row === "Max") { if (raw >= 25) val += 50; } if (row === "Min") { if (raw <= 8) val += 80; } if (row === "Yamb" && raw > 0) val += 150; if (row === "Poker" && raw > 0) val += 80; if (row === "Kenta" && raw > 0) val += 70; if (row === "Ful" && raw > 0) val += 40; if (raw === 0) { if (col === "Nadole" || col === "Nagore") val -= 1000; else val -= 200; } possible.push({val, row, col}); } }); }); possible.sort((a,b) => b.val - a.val); if (possible.length > 0 && possible[0].val > -100) return { type: 'write', row: possible[0].row, col: possible[0].col }; return this.findLeastBadScratch(sheet); }
    
    findLeastBadScratch(sheet) { const scratchOrder = [{r: "1", c: "Slobodna"}, {r: "1", c: "Sredina"}, {r: "2", c: "Slobodna"}, {r: "Min", c: "Sredina"}, {r: "Min", c: "Slobodna"}]; for (let opt of scratchOrder) { if (this.isAvail(opt.r, opt.c, sheet)) return { type: 'write', row: opt.r, col: opt.c }; } for (let col of KOLONE) { if (col === "Ručno" || col === "Najava") continue; for (let row of REDOVI_IGRA) { if (this.isAvail(row, col, sheet)) return { type: 'write', row: row, col: col }; } } for (let col of ["Najava", "Ručno"]) { for (let row of REDOVI_IGRA) { if (this.isAvail(row, col, sheet)) return { type: 'write', row: row, col: col }; } } return { type: 'pass' }; }
    isAvail(row, col, sheet) { return sheet[col][row] === null && this.app.isValidColumnOrder(row, col, sheet); }
    getReaction(points) { if (points >= 60) return "Sjajno!"; if (points >= 40) return "Dobar potez."; return null; }
}
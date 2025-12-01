import { YambApp } from './YambApp.js';

// Odmah pravimo instancu i kačimo je na window
// Moduli su po prirodi "deferred" (odloženi), tako da će HTML već biti spreman
window.app = new YambApp();

console.log("Yamb aplikacija inicijalizovana!"); // Ovo služi da vidimo u konzoli da li radi
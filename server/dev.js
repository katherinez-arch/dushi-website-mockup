'use strict';
// Levanta un VELARIS de prueba y el sitio con su backend (4000) a la vez.
//   npm run dev           VELARIS de la propuesta del 31/10 (4010): reservas y tickets.
//   npm run dev:catalogo  VELARIS con la forma de la API real (4011): catálogo y facturas de mentira, nada llega a Hacienda.
const { spawn } = require('node:child_process');
const catalogo = process.argv[2] === 'catalogo';
const env = catalogo ? { ...process.env, VELARIS_URL: 'http://127.0.0.1:4011', VELARIS_API: 'catalogo', VELARIS_CLIENT_ID: '', VELARIS_CLIENT_SECRET: '' } : process.env;
const hijos = [catalogo ? 'velaris-catalogo-mock.js' : 'velaris-mock.js', 'web-backend.js'].map((f) => spawn(process.execPath, [f], { cwd: __dirname, stdio: 'inherit', env }));
const salir = () => { hijos.forEach((h) => h.kill()); process.exit(0); };
process.on('SIGINT', salir); process.on('SIGTERM', salir);
hijos.forEach((h) => h.on('exit', salir));

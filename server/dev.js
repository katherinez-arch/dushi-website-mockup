'use strict';
// Levanta el VELARIS de prueba (4010) y el sitio con su backend (4000) a la vez.
const { spawn } = require('node:child_process');
const hijos = ['velaris-mock.js', 'web-backend.js'].map((f) => spawn(process.execPath, [f], { cwd: __dirname, stdio: 'inherit' }));
const salir = () => { hijos.forEach((h) => h.kill()); process.exit(0); };
process.on('SIGINT', salir); process.on('SIGTERM', salir);
hijos.forEach((h) => h.on('exit', salir));

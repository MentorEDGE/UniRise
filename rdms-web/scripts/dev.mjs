// Starts the API (port 5190) and the Vite dev server (port 5180) together; Ctrl+C stops both.
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const api = run('node_modules/.bin/tsx', ['watch', '--clear-screen=false', 'server/index.ts']);
const web = run('node_modules/.bin/vite', []);
const stop = () => { api.kill(); web.kill(); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (c) => { if (c) { console.error('API server stopped'); web.kill(); process.exit(c); } });

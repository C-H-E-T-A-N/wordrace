import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on 0.0.0.0 so other devices on the Wi-Fi can connect
    port: 5173,
    // The browser talks to Socket.IO on the same origin it loaded the page from (LAN IP or localhost);
    // Vite forwards it to the game server.
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});

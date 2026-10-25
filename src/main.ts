import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { syncService } from './services/SyncService';
import './style.css';

createApp(App).use(router).mount('#app');

// Kick off the background sync engine (no-op until a teacher signs in).
syncService.start();

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  GraduationCap,
  LayoutDashboard,
  FileSpreadsheet,
  BookOpenCheck,
  History,
  Camera,
  Sun,
  Moon,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertCircle,
  LogIn,
  LogOut,
} from 'lucide-vue-next';
import { useTheme } from '@/composables/useTheme';
import { useAuth } from '@/services/firebase';
import { syncService } from '@/services/SyncService';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { haptic } from '@/services/haptics';

const route = useRoute();
const router = useRouter();

const { isDark, toggleTheme } = useTheme();
const { user, isSignedIn, signInWithGoogle, signOut } = useAuth();

const isScannerActive = computed(() => route.name === 'scanner');

const syncStatus = syncService.status;
const pendingCount = useLiveQuery(() => syncService.countPending(), 0);

const navItems = [
  { name: 'Dashboard', route: '/', icon: LayoutDashboard },
  { name: 'Exam Maker', route: '/maker', icon: FileSpreadsheet },
  { name: 'Exam Bank', route: '/exams', icon: BookOpenCheck },
  { name: 'Score History', route: '/history', icon: History },
];

function navigate(path: string) {
  void haptic.light();
  router.push(path);
}

function openScanner() {
  void haptic.medium();
  router.push('/scan');
}

async function handleSyncClick() {
  void haptic.light();
  await syncService.syncNow();
}

async function handleAuthClick() {
  void haptic.medium();
  if (isSignedIn.value) {
    await signOut();
  } else {
    await signInWithGoogle();
  }
}
</script>

<template>
  <!-- Hide completely on ScannerView and when printing -->
  <div v-if="!isScannerActive" class="no-print">
    <!-- Top Bar Navigation (Desktop & Mobile Header) -->
    <header class="app-header sticky top-0 z-40 border-b border-black/5 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/80">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <!-- Logo & Title -->
        <router-link
          to="/"
          class="flex min-h-[44px] items-center gap-2.5 rounded-xl px-2 py-1 transition active:scale-95"
          @click="haptic.light()"
        >
          <div class="grid size-9 place-items-center rounded-xl bg-neutral-900 text-white shadow-sm dark:bg-white dark:text-neutral-950">
            <GraduationCap class="size-5" />
          </div>
          <div>
            <span class="text-base font-bold tracking-tight text-neutral-900 dark:text-white">Grasschecker</span>
            <span class="hidden sm:inline-block ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              Offline OMR
            </span>
          </div>
        </router-link>

        <!-- Desktop Navigation Links -->
        <nav class="hidden md:flex items-center gap-1">
          <router-link
            v-for="item in navItems"
            :key="item.route"
            :to="item.route"
            class="flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition"
            :class="[
              route.path === item.route
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white',
            ]"
            @click="haptic.light()"
          >
            <component :is="item.icon" class="size-4" />
            <span>{{ item.name }}</span>
          </router-link>
        </nav>

        <!-- Right Action Controls (Theme, Sync, Profile) -->
        <div class="flex items-center gap-2">
          <!-- Theme Toggle (Min 44x44px Touch Target) -->
          <button
            id="theme-toggle-btn"
            class="grid size-11 place-items-center rounded-xl border border-neutral-200/80 bg-neutral-50/80 text-neutral-700 shadow-sm backdrop-blur-md transition hover:bg-neutral-100 active:scale-90 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700"
            :aria-label="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
            title="Toggle Dark / Light Theme"
            @click="toggleTheme"
          >
            <Sun v-if="isDark" class="size-5 text-amber-400 transition-transform duration-300 rotate-0" />
            <Moon v-else class="size-5 text-indigo-600 transition-transform duration-300 rotate-0" />
          </button>

          <!-- Sync Status Button (Min 44x44px Touch Target) -->
          <button
            id="global-sync-btn"
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm backdrop-blur-md transition hover:bg-neutral-100 active:scale-95 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300"
            :title="`Sync Status: ${syncStatus}. Pending writes: ${pendingCount}`"
            @click="handleSyncClick"
          >
            <RefreshCw v-if="syncStatus === 'syncing'" class="size-4 animate-spin text-sky-500" />
            <CloudOff v-else-if="syncStatus === 'offline'" class="size-4 text-amber-500" />
            <AlertCircle v-else-if="syncStatus === 'error'" class="size-4 text-rose-500" />
            <Cloud v-else-if="syncStatus === 'signed-out'" class="size-4 text-neutral-400" />
            <Cloud v-else class="size-4 text-emerald-500" />

            <span v-if="pendingCount > 0" class="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-bold text-amber-700 dark:text-amber-400">
              {{ pendingCount }}
            </span>
            <span class="hidden sm:inline-block capitalize text-[11px]">
              {{ syncStatus === 'idle' ? 'Synced' : syncStatus }}
            </span>
          </button>

          <!-- Profile / Sign In (Min 44x44px Touch Target) -->
          <button
            id="global-auth-btn"
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-95 dark:border-neutral-800 dark:bg-white dark:text-neutral-950"
            :title="isSignedIn ? `Signed in as ${user?.displayName || user?.email}` : 'Sign in with Google'"
            @click="handleAuthClick"
          >
            <template v-if="isSignedIn">
              <img
                v-if="user?.photoURL"
                :src="user.photoURL"
                class="size-5 rounded-full object-cover"
                alt="Avatar"
              />
              <span class="max-w-[70px] truncate text-[11px]">{{ user?.displayName?.split(' ')[0] || 'Teacher' }}</span>
              <LogOut class="size-3.5 opacity-60" />
            </template>
            <template v-else>
              <LogIn class="size-4" />
              <span class="hidden sm:inline">Sign In</span>
            </template>
          </button>
        </div>
      </div>
    </header>

    <!-- Mobile Floating Bottom Tab Bar -->
    <nav class="app-tabbar md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-white/90 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/90">
      <div class="grid grid-cols-5 items-center px-2">
        <!-- Dashboard -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/' ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/')"
        >
          <LayoutDashboard class="size-5" />
          <span>Dashboard</span>
        </button>

        <!-- Exam Maker -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/maker' ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/maker')"
        >
          <FileSpreadsheet class="size-5" />
          <span>Maker</span>
        </button>

        <!-- Central Scanner Action Button (Elevated) -->
        <div class="flex justify-center -translate-y-2">
          <button
            id="mobile-scan-tab-btn"
            class="grid size-12 place-items-center rounded-full bg-neutral-900 text-white shadow-xl transition hover:scale-105 active:scale-95 dark:bg-white dark:text-neutral-950 dark:shadow-[0_8px_24px_rgba(255,255,255,0.25)]"
            aria-label="Open Scanner"
            @click="openScanner"
          >
            <Camera class="size-6" />
          </button>
        </div>

        <!-- Exam Bank -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/exams' ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/exams')"
        >
          <BookOpenCheck class="size-5" />
          <span>Exams</span>
        </button>

        <!-- Score History -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/history' ? 'text-neutral-900 dark:text-white' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/history')"
        >
          <History class="size-5" />
          <span>History</span>
        </button>
      </div>
    </nav>
  </div>
</template>

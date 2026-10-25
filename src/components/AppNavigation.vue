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
import { ref } from 'vue';
import { useTheme } from '@/composables/useTheme';
import { useAuth } from '@/services/firebase';
import { syncService } from '@/services/SyncService';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { haptic } from '@/services/haptics';

const route = useRoute();
const router = useRouter();

const { isDark, toggleTheme } = useTheme();
const { user, displayName, isSignedIn, isNative, isAuthModalOpen, openAuthModal, closeAuthModal, signInAsTeacher, signInWithGoogle, signOut } = useAuth();

const isScannerActive = computed(() => route.name === 'scanner');

const syncStatus = syncService.status;
const pendingCount = useLiveQuery(() => syncService.countPending(), 0);

const teacherNameInput = ref('Thầy Long');
const authError = ref('');
const isLoggingIn = ref(false);

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

async function loginAsTeacher() {
  authError.value = '';
  isLoggingIn.value = true;
  void haptic.medium();
  try {
    await signInAsTeacher(teacherNameInput.value.trim() || 'Giáo Viên');
    closeAuthModal();
  } catch (e) {
    authError.value = (e as Error)?.message || 'Sign in failed';
  } finally {
    isLoggingIn.value = false;
  }
}

async function loginWithGoogle() {
  authError.value = '';
  isLoggingIn.value = true;
  void haptic.medium();
  try {
    await signInWithGoogle();
    closeAuthModal();
  } catch (e) {
    authError.value = (e as Error)?.message || 'Google sign in failed';
  } finally {
    isLoggingIn.value = false;
  }
}

async function handleSignOut() {
  void haptic.light();
  await signOut();
  closeAuthModal();
}
</script>

<template>
  <!-- Hide completely on ScannerView and when printing -->
  <div v-if="!isScannerActive" class="no-print">
    <!-- Top Bar Navigation (Desktop & Mobile Header) -->
    <header class="app-header sticky top-0 z-40 border-b border-neutral-200/80 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl dark:border-neutral-800 dark:bg-[#121214]/95">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <!-- Logo & Title -->
        <router-link
          to="/"
          class="flex min-h-[44px] items-center gap-2.5 rounded-xl px-2 py-1 transition active:scale-95"
          @click="haptic.light()"
        >
          <div class="grid size-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30">
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
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
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
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-500/25 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 active:scale-95 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            :title="isSignedIn ? `Signed in as ${displayName}` : 'Sign in'"
            @click="openAuthModal"
          >
            <template v-if="isSignedIn">
              <img
                v-if="user?.photoURL"
                :src="user.photoURL"
                class="size-5 rounded-full object-cover"
                alt="Avatar"
              />
              <span v-else class="size-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">
                {{ displayName.slice(0, 1).toUpperCase() }}
              </span>
              <span class="max-w-[75px] truncate text-[11px] font-bold">{{ displayName.split(' ')[0] }}</span>
              <LogOut class="size-3.5 opacity-60 ml-0.5" />
            </template>
            <template v-else>
              <LogIn class="size-4 text-emerald-600 dark:text-emerald-400" />
              <span class="font-bold">Sign In</span>
            </template>
          </button>
        </div>
      </div>
    </header>

    <!-- Mobile Floating Bottom Tab Bar -->
    <nav class="app-tabbar md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200/80 bg-white/95 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl dark:border-neutral-800/80 dark:bg-[#121214]/95">
      <div class="grid grid-cols-5 items-center px-2">
        <!-- Dashboard -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/')"
        >
          <LayoutDashboard class="size-5" />
          <span>Dashboard</span>
        </button>

        <!-- Exam Maker -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/maker' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/maker')"
        >
          <FileSpreadsheet class="size-5" />
          <span>Maker</span>
        </button>

        <!-- Central Scanner Action Button (Elevated) -->
        <div class="flex justify-center -translate-y-2">
          <button
            id="mobile-scan-tab-btn"
            class="grid size-12 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 transition hover:scale-105 active:scale-95"
            aria-label="Open Scanner"
            @click="openScanner"
          >
            <Camera class="size-6" />
          </button>
        </div>

        <!-- Exam Bank -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/exams' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/exams')"
        >
          <BookOpenCheck class="size-5" />
          <span>Exams</span>
        </button>

        <!-- Score History -->
        <button
          class="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition active:scale-90"
          :class="route.path === '/history' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-neutral-400 dark:text-neutral-500'"
          @click="navigate('/history')"
        >
          <History class="size-5" />
          <span>History</span>
        </button>
      </div>
    </nav>

    <!-- ── Teacher Auth Modal Dialog ────────────────────────────────────────── -->
    <div
      v-if="isAuthModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="closeAuthModal"
    >
      <div class="w-full max-w-sm rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xl transition-all dark:border-neutral-800 dark:bg-neutral-900">
        <!-- Close button -->
        <div class="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
          <div class="flex items-center gap-2">
            <div class="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <GraduationCap class="size-4" />
            </div>
            <h3 class="text-sm font-bold">Teacher Profile</h3>
          </div>
          <button
            class="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            @click="closeAuthModal"
          >
            ✕
          </button>
        </div>

        <!-- Signed in view -->
        <div v-if="isSignedIn" class="mt-4 space-y-4">
          <div class="rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-800/60 flex items-center gap-3">
            <div class="size-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
              {{ displayName.slice(0, 1).toUpperCase() }}
            </div>
            <div class="overflow-hidden">
              <h4 class="text-sm font-bold truncate">{{ displayName }}</h4>
              <p class="text-xs text-neutral-500 truncate">
                {{ user?.email || 'Offline Teacher Session' }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 rounded-xl px-3 py-2">
            <span>✓ Active and ready to scan & sync.</span>
          </div>

          <button
            class="w-full flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 py-3 text-xs font-bold text-rose-600 transition hover:bg-rose-100 active:scale-98 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300"
            @click="handleSignOut"
          >
            <LogOut class="size-4" /> Sign Out
          </button>
        </div>

        <!-- Not signed in form -->
        <div v-else class="mt-4 space-y-4">
          <div>
            <label class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Quick Presets (1-Tap Login)</label>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button
                v-for="preset in ['Thầy Long', 'Cô Hương', 'Thầy Minh', 'Teacher Demo']"
                :key="preset"
                type="button"
                class="rounded-xl border border-emerald-500/20 bg-emerald-50/70 p-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                @click="teacherNameInput = preset; loginAsTeacher()"
              >
                {{ preset }}
              </button>
            </div>
          </div>

          <div>
            <label class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Or Enter Custom Name</label>
            <div class="mt-1 flex gap-2">
              <input
                v-model="teacherNameInput"
                type="text"
                placeholder="e.g. Cô Mai, Thầy Tuấn"
                class="flex-1 rounded-2xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-emerald-500 dark:border-neutral-800 dark:bg-neutral-800"
                @keyup.enter="loginAsTeacher"
              />
              <button
                class="rounded-2xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                :disabled="isLoggingIn"
                @click="loginAsTeacher"
              >
                Go
              </button>
            </div>
          </div>

          <p class="text-[11px] text-neutral-500 text-center">
            100% offline-ready. Does not require internet or Google credentials.
          </p>

          <div class="relative flex items-center justify-center">
            <span class="absolute inset-x-0 h-px bg-neutral-200 dark:bg-neutral-800"></span>
            <span class="relative bg-white px-3 text-[10px] font-bold text-neutral-400 uppercase dark:bg-neutral-900">Or</span>
          </div>

          <button
            v-if="!isNative"
            class="w-full rounded-2xl border border-neutral-200 bg-neutral-50 py-2.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 active:scale-98 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 flex items-center justify-center gap-2"
            :disabled="isLoggingIn"
            @click="loginWithGoogle"
          >
            <span>Sign in with Google (Web)</span>
          </button>
          <div v-else class="text-[10px] text-amber-600 dark:text-amber-400 text-center bg-amber-500/10 rounded-xl p-2">
            Native iOS app runs in high-security mode. Use Teacher Login above.
          </div>

          <div v-if="authError" class="text-xs text-rose-500 text-center font-medium">
            {{ authError }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

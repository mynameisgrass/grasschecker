import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInAnonymously,
  updateProfile,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { computed, readonly, ref, shallowRef } from 'vue';

const firebaseConfig = {
  apiKey: 'AIzaSyBJl86muHrfXxg7XW9iE_LvnyeaY-sO2fc',
  authDomain: 'auto-fcf6f.firebaseapp.com',
  projectId: 'auto-fcf6f',
  storageBucket: 'auto-fcf6f.firebasestorage.app',
  messagingSenderId: '944992092539',
  appId: '1:944992092539:web:307a047f2a3a5b2f17bdde',
  measurementId: 'G-2HN5T60PNY',
};

export const firebaseApp = initializeApp(firebaseConfig);

/**
 * IndexedDB persistence keeps the teacher "signed in" across restarts and while offline,
 * so the app never blocks on the network to know who the user is.
 */
export const auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

/**
 * Dexie is the source of truth, so Firestore runs with its default in-memory cache.
 * `ignoreUndefinedProperties` lets us push optional fields (e.g. studentSBD) without crashing.
 */
export const firestore = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });

// ── Mobile Safari / Touch Detection ──────────────────────────────────────────
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (isTouch && /Macintosh/i.test(ua));
}

function getInitialUser(): User | null {
  if (typeof window === 'undefined') return null;
  if (auth.currentUser) return auth.currentUser;
  try {
    const saved = localStorage.getItem('grasschecker_offline_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        uid: parsed.uid,
        displayName: parsed.displayName,
        isAnonymous: true,
        email: null,
        photoURL: null,
      } as unknown as User;
    }
  } catch {}
  return null;
}

// ── Reactive auth state ──────────────────────────────────────────────────────
const user = shallowRef<User | null>(getInitialUser());
const isReady = ref(!!user.value);
const isAuthModalOpen = ref(false);

export function openAuthModal() {
  isAuthModalOpen.value = true;
}

export function closeAuthModal() {
  isAuthModalOpen.value = false;
}

let resolveReady!: (u: User | null) => void;
/** Resolves once Firebase has restored the persisted session (works offline). */
export const authReady = new Promise<User | null>((r) => (resolveReady = r));

onAuthStateChanged(auth, (u) => {
  if (u) {
    user.value = u;
    localStorage.setItem('grasschecker_offline_user', JSON.stringify({ uid: u.uid, displayName: u.displayName || 'Teacher' }));
  } else if (typeof window !== 'undefined' && !user.value) {
    try {
      const saved = localStorage.getItem('grasschecker_offline_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        user.value = {
          uid: parsed.uid,
          displayName: parsed.displayName,
          isAnonymous: true,
          email: null,
          photoURL: null,
        } as unknown as User;
      }
    } catch {}
  }
  if (!isReady.value) {
    isReady.value = true;
    resolveReady(user.value);
  }
});

// Process redirect result on app boot (critical for iOS Safari after redirect back)
if (typeof window !== 'undefined') {
  getRedirectResult(auth)
    .then((cred) => {
      if (cred?.user) {
        user.value = cred.user;
        localStorage.setItem('grasschecker_offline_user', JSON.stringify({ uid: cred.user.uid, displayName: cred.user.displayName || 'Teacher' }));
      }
    })
    .catch((err) => {
      if (err && (err as { code?: string }).code !== 'auth/redirect-cancelled-by-user') {
        console.warn('[firebase auth] redirect result notice:', err);
      }
    });
}

import { Capacitor } from '@capacitor/core';

/**
 * Sign in as a local Teacher (Offline & Capacitor compatible).
 * Sets user immediately so UI reacts with 0 latency, and registers Firebase in background.
 */
export async function signInAsTeacher(teacherName = 'Giáo Viên'): Promise<User> {
  const cleanName = teacherName.trim() || 'Giáo Viên';
  const offlineUid = 'teacher-' + Math.random().toString(36).slice(2, 9);
  const teacherUser = {
    uid: offlineUid,
    displayName: cleanName,
    isAnonymous: true,
    email: null,
    photoURL: null,
  } as unknown as User;

  // 1. Immediately activate teacher user in reactive state and storage
  user.value = teacherUser;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('grasschecker_offline_user', JSON.stringify({ uid: offlineUid, displayName: cleanName }));
  }

  // 2. Register with Firebase in the background without blocking the UI
  try {
    const cred = await signInAnonymously(auth);
    if (cred.user) {
      await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
      user.value = cred.user;
      localStorage.setItem('grasschecker_offline_user', JSON.stringify({ uid: cred.user.uid, displayName: cleanName }));
      return cred.user;
    }
  } catch (err) {
    console.warn('[auth] Firebase anonymous sign-in fallback to local offline session:', err);
  }
  return teacherUser;
}

/**
 * Google Sign-In:
 * - On native Capacitor iOS/Android, Google blocks WebView redirects.
 * - On Mobile Safari, uses signInWithRedirect.
 * - On Desktop, uses signInWithPopup.
 */
export async function signInWithGoogle(): Promise<User | null> {
  // If running inside Capacitor native app, Google OAuth is blocked by Google policy (disallowed_useragent)
  if (Capacitor.isNativePlatform()) {
    throw new Error('Google Sign-In is blocked in native iOS WebViews by Google. Please use Teacher Sign-In below.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // 1. Mobile browsers (iOS Safari, Android Chrome) must use redirect
  if (isMobileBrowser()) {
    await signInWithRedirect(auth, provider);
    return null; // Page will redirect to Google
  }

  // 2. Desktop browsers: use popup with graceful fallback
  try {
    const cred = await signInWithPopup(auth, provider);
    if (cred.user) {
      user.value = cred.user;
      localStorage.setItem('grasschecker_offline_user', JSON.stringify({ uid: cred.user.uid, displayName: cred.user.displayName || 'Teacher' }));
    }
    return cred.user;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return null;
    }
    throw err;
  }
}

export async function signOut(): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('grasschecker_offline_user');
  }
  user.value = null;
  try {
    await firebaseSignOut(auth);
  } catch {}
}

export function useAuth() {
  return {
    user: computed(() => user.value),
    uid: computed(() => user.value?.uid ?? null),
    displayName: computed(() => user.value?.displayName || (user.value?.isAnonymous ? 'Teacher' : 'Guest')),
    isSignedIn: computed(() => !!user.value),
    isReady: readonly(isReady),
    isMobile: isMobileBrowser(),
    isNative: Capacitor.isNativePlatform(),
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    signInAsTeacher,
    signInWithGoogle,
    signOut,
  };
}

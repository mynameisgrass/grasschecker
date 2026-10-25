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

// ── Reactive auth state ──────────────────────────────────────────────────────
const user = shallowRef<User | null>(auth.currentUser);
const isReady = ref(false);

let resolveReady!: (u: User | null) => void;
/** Resolves once Firebase has restored the persisted session (works offline). */
export const authReady = new Promise<User | null>((r) => (resolveReady = r));

onAuthStateChanged(auth, (u) => {
  user.value = u;
  if (!isReady.value) {
    isReady.value = true;
    resolveReady(u);
  }
});

// Process redirect result on app boot (critical for iOS Safari after redirect back)
if (typeof window !== 'undefined') {
  getRedirectResult(auth)
    .then((cred) => {
      if (cred?.user) {
        user.value = cred.user;
      }
    })
    .catch((err) => {
      if (err && (err as { code?: string }).code !== 'auth/redirect-cancelled-by-user') {
        console.warn('[firebase auth] redirect result notice:', err);
      }
    });
}

/**
 * Google Sign-In:
 * - Mobile Safari & WebViews strictly use signInWithRedirect (Safari aggressively blocks popups).
 * - Desktop browsers use signInWithPopup with automatic fallback to signInWithRedirect.
 */
export async function signInWithGoogle(): Promise<User | null> {
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

export function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

export function useAuth() {
  return {
    user: computed(() => user.value),
    uid: computed(() => user.value?.uid ?? null),
    isSignedIn: computed(() => !!user.value),
    isReady: readonly(isReady),
    isMobile: isMobileBrowser(),
    signInWithGoogle,
    signOut,
  };
}

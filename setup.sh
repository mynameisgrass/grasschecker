#!/usr/bin/env bash
# Grasschecker — project bootstrap (pnpm version).
set -euo pipefail

APP_NAME="${1:-grasschecker}"

# Kiểm tra pnpm
command -v pnpm >/dev/null || { echo "❌ pnpm is required. Install with: npm i -g pnpm"; exit 1; }
command -v node >/dev/null || { echo "❌ Node.js >= 20 is required."; exit 1; }

# ── 1. Scaffold Vite + Vue 3 + TypeScript ────────────────────────────────────
if [[ ! -f package.json ]]; then
  pnpm create vite "$APP_NAME" --template vue-ts
  cd "$APP_NAME"
fi
pnpm install

# ── 2. Tailwind CSS (v4) ─────────────────────────────────────────────────────
pnpm add -D tailwindcss @tailwindcss/vite

# ── 3. App dependencies ──────────────────────────────────────────────────────
pnpm add firebase dexie vue-router @vueuse/core lucide-vue-next
pnpm add -D @types/node @vue/tsconfig

# ── 4. Capacitor ─────────────────────────────────────────────────────────────
pnpm add @capacitor/core @capacitor/camera @capacitor/haptics
pnpm add -D @capacitor/cli
[[ -f capacitor.config.ts ]] || pnpm exec cap init "Grasschecker" "com.grasschecker.app" --web-dir dist

# ── 5. OpenCV.js — Tải file WASM bản chuẩn từ jsDelivr ───────────────
mkdir -p public/opencv
if [[ ! -f public/opencv/opencv.js ]]; then
  echo "Downloading OpenCV.js..."
  curl -fL "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/opencv.js" -o public/opencv/opencv.js
fi

echo ""
echo "✅ Done. Next steps:"
echo "   pnpm run dev                              # web dev server"
echo "   pnpm add @capacitor/android && pnpm exec cap add android   # native Android"
echo "   pnpm run build && pnpm exec cap sync"
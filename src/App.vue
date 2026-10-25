<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNavigation from '@/components/AppNavigation.vue';
</script>

<template>
  <div class="min-h-screen bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 transition-colors duration-200">
    <!-- Global Navigation & Status Bar -->
    <AppNavigation />

    <!-- Main View with Route Transition -->
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </div>
</template>

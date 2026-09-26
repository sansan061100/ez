<template>
    <desktop-app v-if="DesktopApp">
        <nuxt-layout>
            <nuxt-page />
        </nuxt-layout>
    </desktop-app>
    <nuxt-layout v-else>
        <nuxt-page />
    </nuxt-layout>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

import { getUiMode } from '@/lib/web.ts';

// the root component of the desktop version wraps all the desktop pages
const DesktopApp = getUiMode() === 'desktop' ? defineAsyncComponent(() => import('@/DesktopApp.vue')) : null;
</script>

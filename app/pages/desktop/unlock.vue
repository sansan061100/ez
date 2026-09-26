<template>
    <unlock-page />
</template>

<script setup lang="ts">
import UnlockPage from '@/views/desktop/UnlockPage.vue';

definePageMeta({
    middleware: 'desktop-require-locked'
});
</script>

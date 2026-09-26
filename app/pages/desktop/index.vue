<template>
    <home-page />
</template>

<script setup lang="ts">
import HomePage from '@/views/desktop/HomePage.vue';

definePageMeta({
    middleware: 'desktop-require-login'
});
</script>

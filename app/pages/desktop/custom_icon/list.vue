<template>
    <user-custom-icon-list-page />
</template>

<script setup lang="ts">
import UserCustomIconListPage from '@/views/desktop/customicons/ListPage.vue';

definePageMeta({
    middleware: 'desktop-require-login',
    layout: 'desktop-settings'
});
</script>

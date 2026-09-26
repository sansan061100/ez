<template>
    <overview-layout-editor-page />
</template>

<script setup lang="ts">
import OverviewLayoutEditorPage from '@/views/desktop/overview/LayoutEditorPage.vue';

definePageMeta({
    middleware: 'desktop-require-login'
});
</script>

<template>
    <div></div>
</template>

<script setup lang="ts">
import uaParser from 'ua-parser-js';

import { navigateToHomePage } from '@/lib/web.ts';

function isMobileDevice(): boolean {
    if (!navigator.userAgent) {
        return false;
    }

    const uaParseRet = uaParser(navigator.userAgent);

    if (!uaParseRet || !uaParseRet.device) {
        return false;
    }

    const device = uaParseRet.device;

    if (device.type === 'mobile' || device.type === 'wearable' || device.type === 'embedded') {
        return true;
    }

    return false;
}

if (isMobileDevice()) {
    navigateToHomePage('mobile');
} else {
    navigateToHomePage('desktop');
}
</script>

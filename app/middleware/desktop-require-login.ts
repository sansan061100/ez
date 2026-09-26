import { isUserLogined, isUserUnlocked } from '@/lib/userstate.ts';

// the pages which require user logged in and unlocked
export default defineNuxtRouteMiddleware(() => {
    if (!isUserLogined()) {
        return navigateTo('/login', { replace: true });
    }

    if (!isUserUnlocked()) {
        return navigateTo('/unlock', { replace: true });
    }
});

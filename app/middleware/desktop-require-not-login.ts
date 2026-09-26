import { isUserLogined, isUserUnlocked } from '@/lib/userstate.ts';

// the pages which require user not logged in (e.g. login page, sign up page)
export default defineNuxtRouteMiddleware(() => {
    if (isUserLogined() && !isUserUnlocked()) {
        return navigateTo('/unlock', { replace: true });
    }

    if (isUserLogined()) {
        return navigateTo('/', { replace: true });
    }
});

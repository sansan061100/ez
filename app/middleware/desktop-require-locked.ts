import { isUserLogined, isUserUnlocked } from '@/lib/userstate.ts';

// the pages which require user logged in but locked (e.g. unlock page)
export default defineNuxtRouteMiddleware(() => {
    if (!isUserLogined()) {
        return navigateTo('/login', { replace: true });
    }

    if (isUserUnlocked()) {
        return navigateTo('/', { replace: true });
    }
});

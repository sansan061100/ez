import type { RouterConfig } from 'nuxt/schema';
import type { RouteRecordRaw } from 'vue-router';
import { createWebHistory } from 'vue-router';

import { getUiMode, getUiModeBasePath } from '@/lib/web.ts';

// The desktop version and the mobile version are two separate applications in one nuxt application,
// the pages of each version are in "pages/desktop" and "pages/mobile", and the routes of current version are mounted
// at the base path of the version (e.g. "pages/desktop/transaction/list.vue" is "/transaction/list" in the router whose base
// path is "/desktop"), so the pages and the components of each version can use the route paths relative to the version.
// Switching between the versions always reloads the whole page, so the version is decided when the application starts.

function removeRoutePathPrefix(routes: readonly RouteRecordRaw[], prefix: string): RouteRecordRaw[] {
    const result: RouteRecordRaw[] = [
        // nuxt resolves the initial route by the url path without the base path of the version (e.g. "/desktop/transaction/list"),
        // so redirects it to the route path relative to the version (e.g. "/transaction/list")
        {
            path: `${prefix}/:pathMatch(.*)*`,
            redirect: to => ({
                path: '/' + ([] as string[]).concat(to.params['pathMatch'] ?? []).join('/'),
                query: to.query,
                hash: to.hash
            })
        },
        {
            path: prefix,
            redirect: to => ({
                path: '/',
                query: to.query,
                hash: to.hash
            })
        }
    ];

    for (const route of routes) {
        if (route.path !== prefix && !route.path.startsWith(prefix + '/')) {
            continue;
        }

        result.push({
            ...route,
            path: route.path.substring(prefix.length) || '/'
        } as RouteRecordRaw);
    }

    return result;
}

export default {
    routes: (routes): RouteRecordRaw[] => {
        const uiMode = getUiMode();

        if (uiMode === 'desktop') {
            return removeRoutePathPrefix(routes, '/desktop');
        } else if (uiMode === 'mobile') {
            return removeRoutePathPrefix(routes, '/mobile');
        } else {
            return routes.filter(route => route.path !== '/desktop' && !route.path.startsWith('/desktop/')
                && route.path !== '/mobile' && !route.path.startsWith('/mobile/'));
        }
    },
    history: () => {
        const uiMode = getUiMode();

        if (uiMode === 'desktop') {
            const basePath = getUiModeBasePath('desktop');

            // redirects the url of the old hash mode desktop version (e.g. "/desktop#/transaction/list") to the current url
            if (window.location.hash.startsWith('#/')) {
                window.history.replaceState(null, '', basePath + window.location.hash.substring(1));
            }

            return createWebHistory(basePath);
        } else if (uiMode === 'mobile') {
            return createWebHistory(getUiModeBasePath('mobile'));
        } else {
            return undefined;
        }
    }
} satisfies RouterConfig;

export type UiMode = 'index' | 'desktop';

type NuxtWindow = typeof window & {
    __NUXT__?: {
        config?: {
            app?: {
                baseURL?: string;
            };
        };
    };
};

// getBasePath returns the base path of the application (without the trailing slash, e.g. "" or "/ezbookkeeping")
export function getBasePath(): string {
    const baseURL = (window as NuxtWindow).__NUXT__?.config?.app?.baseURL || '/';
    return baseURL.endsWith('/') ? baseURL.substring(0, baseURL.length - 1) : baseURL;
}

// getUiMode returns whether the current page is the desktop application or the index (redirect) page
export function getUiMode(): UiMode {
    const path = window.location.pathname.substring(getBasePath().length);

    if (path === '/desktop' || path.startsWith('/desktop/')) {
        return 'desktop';
    } else {
        return 'index';
    }
}

// getUiModeBasePath returns the base path of the routes of the desktop application
export function getUiModeBasePath(type: 'desktop'): string {
    return `${getBasePath()}/${type}`;
}

export function navigateToHomePage(type: 'desktop'): void {
    window.location.replace(`${getUiModeBasePath(type)}/`);
}

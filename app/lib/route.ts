import type { RouteLocationNormalizedLoaded } from 'vue-router';

// getRouteQueryValue returns the raw value of the route query parameter, which is passed to the page component property
// (same as the original router props functions, the value is not converted)
export function getRouteQueryValue<T extends string = string>(route: RouteLocationNormalizedLoaded, name: string): T {
    return route.query[name] as T;
}

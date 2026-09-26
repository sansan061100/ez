import { defineNotFoundRoute } from '~~/server/lib/web/bind';

// all the other requests to /api return api not found error
export default defineNotFoundRoute();

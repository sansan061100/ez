import * as twofactorAuthorizations from '~~/server/lib/api/twofactor_authorizations';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.enableTwoFactor,
    handler: bindApi(twofactorAuthorizations.twoFactorEnableRequestHandler),
});

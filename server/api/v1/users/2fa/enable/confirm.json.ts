import * as twofactorAuthorizations from '~~/server/lib/api/twofactor_authorizations';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.enableTwoFactor,
    handler: bindApiWithTokenUpdate(twofactorAuthorizations.twoFactorEnableConfirmHandler),
});

import * as authorizations from '~~/server/lib/api/authorizations';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { twoFactorApiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: twoFactorApiGroup,
    enabled: config => config.enableInternalAuth && config.enableTwoFactor,
    handler: bindApiWithTokenUpdate(authorizations.twoFactorAuthorizeByRecoveryCodeHandler),
});

import * as authorizations from '~~/server/lib/api/authorizations';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { oauth2CallbackApiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: oauth2CallbackApiGroup,
    enabled: config => config.enableOAuth2Login,
    handler: bindApiWithTokenUpdate(authorizations.oauth2CallbackAuthorizeHandler),
});

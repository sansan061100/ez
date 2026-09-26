import * as oauth2Authentications from '~~/server/lib/api/oauth2_authentications';
import { bindRedirect, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiGroup,
    enabled: config => config.enableOAuth2Login,
    handler: bindRedirect(oauth2Authentications.loginHandler),
});

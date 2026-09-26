import * as userExternalAuths from '~~/server/lib/api/user_external_auths';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiV1Group,
    enabled: config => config.enableOAuth2Login,
    handler: bindApi(userExternalAuths.externalAuthListHandler),
});

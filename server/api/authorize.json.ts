import * as authorizations from '~~/server/lib/api/authorizations';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiGroup,
    enabled: config => config.enableInternalAuth,
    handler: bindApiWithTokenUpdate(authorizations.authorizeHandler),
});

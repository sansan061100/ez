import * as tokens from '~~/server/lib/api/tokens';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiGroup,
    handler: bindApiWithTokenUpdate(tokens.tokenRevokeCurrentHandler),
});

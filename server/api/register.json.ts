import * as users from '~~/server/lib/api/users';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiGroup,
    enabled: config => config.enableInternalAuth && config.enableUserRegister,
    handler: bindApiWithTokenUpdate(users.userRegisterHandler),
});

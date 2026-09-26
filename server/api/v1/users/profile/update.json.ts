import * as users from '~~/server/lib/api/users';
import { bindApiWithTokenUpdate, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    handler: bindApiWithTokenUpdate(users.userUpdateProfileHandler),
});

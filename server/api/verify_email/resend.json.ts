import * as users from '~~/server/lib/api/users';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiGroup,
    enabled: config => config.enableUserVerifyEmail,
    handler: bindApi(users.userSendVerifyEmailByUnloginUserHandler),
});

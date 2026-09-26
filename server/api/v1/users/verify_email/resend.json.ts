import * as users from '~~/server/lib/api/users';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.enableUserVerifyEmail,
    handler: bindApi(users.userSendVerifyEmailByLoginedUserHandler),
});

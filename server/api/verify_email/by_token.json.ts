import * as users from '~~/server/lib/api/users';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { emailVerifyApiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: emailVerifyApiGroup,
    enabled: config => config.enableUserVerifyEmail,
    handler: bindApi(users.userEmailVerifyHandler),
});

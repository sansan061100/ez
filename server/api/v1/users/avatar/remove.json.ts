import * as users from '~~/server/lib/api/users';
import { USER_AVATAR_PROVIDER_INTERNAL } from '~~/server/lib/core/types';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiV1Group,
    enabled: config => config.avatarProvider === USER_AVATAR_PROVIDER_INTERNAL,
    handler: bindApi(users.userRemoveAvatarHandler),
});

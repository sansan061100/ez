import * as forgetPasswords from '~~/server/lib/api/forget_passwords';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['POST'],
    middlewares: apiGroup,
    enabled: config => config.enableInternalAuth && config.enableUserForgetPassword,
    handler: bindApi(forgetPasswords.userForgetPasswordRequestHandler),
});

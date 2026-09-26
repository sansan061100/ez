import * as userAppCloudSettings from '~~/server/lib/api/user_app_cloud_settings';
import { bindApi, defineRoute } from '~~/server/lib/web/bind';
import { apiV1Group } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: apiV1Group,
    handler: bindApi(userAppCloudSettings.applicationSettingsGetHandler),
});

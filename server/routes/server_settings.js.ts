import * as serverSettings from '~~/server/lib/api/server_settings';
import { bindCachedJs, defineRoute } from '~~/server/lib/web/bind';

export default defineRoute({
    methods: ['GET'],
    handler: bindCachedJs(serverSettings.serverSettingsJavascriptHandler),
});

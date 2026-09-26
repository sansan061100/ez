import * as defaults from '~~/server/lib/api/default';
import * as modelContextProtocols from '~~/server/lib/api/model_context_protocols';
import { bindApi, bindJSONRPCApi, defineRoute } from '~~/server/lib/web/bind';
import { mcpGroup } from '~~/server/lib/web/groups';

const jsonRPCHandler = bindJSONRPCApi({
    'initialize': modelContextProtocols.initializeHandler,
    'resources/list': modelContextProtocols.listResourcesHandler,
    'resources/read': modelContextProtocols.readResourceHandler,
    'tools/list': modelContextProtocols.listToolsHandler,
    'tools/call': modelContextProtocols.callToolHandler,
    'ping': modelContextProtocols.pingHandler,
}, {
    'notifications/initialized': 202,
});

const methodNotAllowedHandler = bindApi(defaults.methodNotAllowed);

export default defineRoute({
    methods: ['GET', 'POST'],
    middlewares: mcpGroup,
    enabled: config => config.enableMCPServer,
    handler: async c => (c.method === 'POST' ? jsonRPCHandler(c) : methodNotAllowedHandler(c)),
});

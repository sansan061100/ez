import * as mapImageProxies from '~~/server/lib/api/map_image_proxies';
import { CustomProvider, TianDiTuProvider } from '~~/server/lib/settings/settings';
import { bindProxy, defineRoute } from '~~/server/lib/web/bind';
import { queryStringTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: queryStringTokenGroup,
    enabled: config => config.enableMapDataFetchProxy && (config.mapProvider === TianDiTuProvider || (config.mapProvider === CustomProvider && config.customMapTileServerAnnotationLayerUrl !== '')),
    handler: bindProxy(mapImageProxies.mapAnnotationImageProxyHandler),
});

import * as mapImageProxies from '~~/server/lib/api/map_image_proxies';
import { CartoDBMapProvider, CustomProvider, CyclOSMMapProvider, OpenStreetMapHumanitarianStyleProvider, OpenStreetMapProvider, OpenTopoMapProvider, OPNVKarteMapProvider, TianDiTuProvider, TomTomMapProvider } from '~~/server/lib/settings/settings';
import { bindProxy, defineRoute } from '~~/server/lib/web/bind';
import { queryStringTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: queryStringTokenGroup,
    enabled: config => config.enableMapDataFetchProxy && [OpenStreetMapProvider, OpenStreetMapHumanitarianStyleProvider, OpenTopoMapProvider, OPNVKarteMapProvider, CyclOSMMapProvider, CartoDBMapProvider, TomTomMapProvider, TianDiTuProvider, CustomProvider].includes(config.mapProvider),
    handler: bindProxy(mapImageProxies.mapTileImageProxyHandler),
});

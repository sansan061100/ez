import * as amapApiProxies from '~~/server/lib/api/amap_api_proxies';
import { AmapProvider, AmapSecurityVerificationInternalProxyMethod } from '~~/server/lib/settings/settings';
import { bindProxy, defineRoute } from '~~/server/lib/web/bind';
import { cookieTokenGroup } from '~~/server/lib/web/groups';

export default defineRoute({
    methods: ['GET'],
    middlewares: cookieTokenGroup,
    enabled: config => config.mapProvider === AmapProvider && config.amapSecurityVerificationMethod === AmapSecurityVerificationInternalProxyMethod,
    handler: bindProxy(amapApiProxies.amapApiProxyHandler),
});

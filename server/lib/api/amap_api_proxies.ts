import type { WebContext } from '../web/context';
import { reverseProxy } from '../web/proxy';
import { currentConfig } from './base';

const amapCustomMapStylesUrl = 'https://webapi.amap.com/v4/map/styles';
const amapOverseasMapUrl = 'https://fmap01.amap.com/v3/vectormap';
const amapRestApiUrl = 'https://restapi.amap.com/';

// amapApiProxyHandler returns amap api response
export async function amapApiProxyHandler(c: WebContext): Promise<Response> {
    const path = c.path;
    const requestUri = c.rawQuery !== '' ? `${path}?${c.rawQuery}` : path;
    let targetUrl: string;

    if (requestUri.startsWith('/_AMapService/v4/map/styles')) {
        targetUrl = amapCustomMapStylesUrl + path.replace(/^\/_AMapService\/v4\/map\/styles/, '');
    } else if (requestUri.startsWith('/_AMapService/v3/vectormap')) {
        targetUrl = amapOverseasMapUrl + path.replace(/^\/_AMapService\/v3\/vectormap/, '');
    } else {
        targetUrl = amapRestApiUrl + path.replace(/^\/_AMapService\//, '');
    }

    const targetRawUrl = `${targetUrl}?${c.rawQuery}&jscode=${currentConfig().amapApplicationSecret}`;

    return reverseProxy(c, targetRawUrl, null, headers => {
        const cookieHeader = headers['cookie'];
        delete headers['cookie'];

        if (!cookieHeader) {
            return;
        }

        const cookies = (Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader)
            .split(';')
            .map(item => item.trim())
            .filter(item => item !== '' && !item.split('=')[0]!.startsWith('ebk_'));

        if (cookies.length > 0) {
            headers['cookie'] = cookies.join('; ');
        }
    });
}

import type { Dispatcher } from 'undici';

import * as errs from '../errs/index';
import {
    CartoDBMapProvider,
    CustomProvider,
    CyclOSMMapProvider,
    OpenStreetMapHumanitarianStyleProvider,
    OpenStreetMapProvider,
    OpenTopoMapProvider,
    OPNVKarteMapProvider,
    TianDiTuProvider,
    TomTomMapProvider,
} from '../settings/settings';
import type { WebContext } from '../web/context';
import { createProxyDispatcher, reverseProxy } from '../web/proxy';
import { currentConfig } from './base';

const openStreetMapTileImageUrlFormat = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const openStreetMapHumanitarianStyleTileImageUrlFormat = 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
const openTopoMapTileImageUrlFormat = 'https://tile.opentopomap.org/{z}/{x}/{y}.png';
const opnvKarteMapTileImageUrlFormat = 'https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png';
const cyclOSMMapTileImageUrlFormat = 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png';
const cartoDBMapTileImageUrlFormat = 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{scale}.png';
const tomtomMapTileImageUrlFormat = 'https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png';
const tianDiTuMapTileImageUrlFormat = 'https://t0.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const tianDiTuMapAnnotationUrlFormat = 'https://t0.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

let dispatcher: Dispatcher | null = null;

function getDispatcher(): Dispatcher {
    if (!dispatcher) {
        dispatcher = createProxyDispatcher(currentConfig().mapProxy);
    }

    return dispatcher;
}

type TargetUrlFunc = (c: WebContext, mapProvider: string) => string;

async function mapImageProxyHandler(c: WebContext, fn: TargetUrlFunc): Promise<Response> {
    const mapProvider = c.query('provider').replace(/-/g, '_');

    if (mapProvider !== currentConfig().mapProvider) {
        throw errs.ErrMapProviderNotCurrent;
    }

    const zoomLevel = c.param('zoomLevel');
    const coordinateX = c.param('coordinateX');
    const fileNameParts = c.param('fileName').split('.');
    const coordinateY = fileNameParts[0] ?? '';
    const scale = c.query('scale');

    if (fileNameParts.length !== 2 || fileNameParts[fileNameParts.length - 1] !== 'png') {
        throw errs.ErrImageExtensionNotSupported;
    }

    const targetUrl = fn(c, mapProvider)
        .replaceAll('{z}', zoomLevel)
        .replaceAll('{x}', coordinateX)
        .replaceAll('{y}', coordinateY)
        .replaceAll('{scale}', scale);

    return reverseProxy(c, targetUrl, getDispatcher());
}

// mapTileImageProxyHandler returns map tile image
export async function mapTileImageProxyHandler(c: WebContext): Promise<Response> {
    return mapImageProxyHandler(c, (c, mapProvider) => {
        const config = currentConfig();

        if (mapProvider === OpenStreetMapProvider) {
            return openStreetMapTileImageUrlFormat;
        } else if (mapProvider === OpenStreetMapHumanitarianStyleProvider) {
            return openStreetMapHumanitarianStyleTileImageUrlFormat;
        } else if (mapProvider === OpenTopoMapProvider) {
            return openTopoMapTileImageUrlFormat;
        } else if (mapProvider === OPNVKarteMapProvider) {
            return opnvKarteMapTileImageUrlFormat;
        } else if (mapProvider === CyclOSMMapProvider) {
            return cyclOSMMapTileImageUrlFormat;
        } else if (mapProvider === CartoDBMapProvider) {
            return cartoDBMapTileImageUrlFormat;
        } else if (mapProvider === TomTomMapProvider) {
            let targetUrl = tomtomMapTileImageUrlFormat + '?key=' + config.tomTomMapAPIKey;
            const language = c.query('language');

            if (language !== '') {
                targetUrl = targetUrl + '&language=' + language;
            }

            return targetUrl;
        } else if (mapProvider === TianDiTuProvider) {
            return tianDiTuMapTileImageUrlFormat + '&tk=' + config.tianDiTuAPIKey;
        } else if (mapProvider === CustomProvider) {
            return config.customMapTileServerTileLayerUrl;
        }

        throw errs.ErrParameterInvalid;
    });
}

// mapAnnotationImageProxyHandler returns map annotation image
export async function mapAnnotationImageProxyHandler(c: WebContext): Promise<Response> {
    return mapImageProxyHandler(c, (_c, mapProvider) => {
        const config = currentConfig();

        if (mapProvider === TianDiTuProvider) {
            return tianDiTuMapAnnotationUrlFormat + '&tk=' + config.tianDiTuAPIKey;
        } else if (mapProvider === CustomProvider) {
            return config.customMapTileServerAnnotationLayerUrl;
        }

        throw errs.ErrParameterInvalid;
    });
}

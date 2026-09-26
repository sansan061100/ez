import {
    AmapProvider,
    AmapSecurityVerificationExternalProxyMethod,
    AmapSecurityVerificationPlainTextMethod,
    BaiduMapProvider,
    CartoDBMapProvider,
    CustomProvider,
    CyclOSMMapProvider,
    GoogleMapProvider,
    type MultiLanguageContentConfig,
    OAuth2ProviderOIDC,
    OpenStreetMapHumanitarianStyleProvider,
    OpenStreetMapProvider,
    OpenTopoMapProvider,
    OPNVKarteMapProvider,
    TianDiTuProvider,
    TomTomMapProvider,
} from '../settings/settings';
import type { WebContext } from '../web/context';
import { currentConfig } from './base';

const globalVariableFullName = 'window.EZBOOKKEEPING_SERVER_SETTINGS';
const globalVariableAlias = '_';
const javascriptFileHeader = '(function () {\n' +
    globalVariableFullName + '=' + globalVariableFullName + '||{};\n' +
    'const ' + globalVariableAlias + '=' + globalVariableFullName + ';\n';
const javascriptFileFooter = '})();\n';

function encodeString(content: string): string {
    let ret = '\'';

    for (const ch of content) {
        switch (ch) {
            case '\\': ret += '\\\\'; break;
            case '\'': ret += '\\\''; break;
            case '\n': ret += '\\n'; break;
            case '\r': ret += '\\r'; break;
            case '\t': ret += '\\t'; break;
            case '\f': ret += '\\f'; break;
            case '\b': ret += '\\b'; break;
            default: ret += ch;
        }
    }

    return ret + '\'';
}

class SettingsBuilder {
    private content = javascriptFileHeader;

    public string(key: string, value: string): void {
        this.content += `${globalVariableAlias}[${encodeString(key)}]=${encodeString(value)};\n`;
    }

    public boolean(key: string, value: boolean): void {
        this.content += `${globalVariableAlias}[${encodeString(key)}]=${value ? '1' : '0'};\n`;
    }

    public integer(key: string, value: number): void {
        this.content += `${globalVariableAlias}[${encodeString(key)}]=${Math.trunc(value)};\n`;
    }

    public multiLanguageTip(key: string, value: MultiLanguageContentConfig): void {
        this.content += `${globalVariableAlias}[${encodeString(key)}]={\n'default':${encodeString(value.defaultContent)}`;

        for (const [languageTag, content] of Object.entries(value.multiLanguageContent)) {
            this.content += `,\n${encodeString(languageTag)}:${encodeString(content)}`;
        }

        this.content += '\n};\n';
    }

    public build(): string {
        return this.content + javascriptFileFooter;
    }
}

// serverSettingsJavascriptHandler returns the server settings javascript file
export async function serverSettingsJavascriptHandler(_c: WebContext): Promise<[Buffer, string]> {
    const config = currentConfig();
    const builder = new SettingsBuilder();

    builder.boolean('a', config.enableInternalAuth);
    builder.boolean('o', config.enableOAuth2Login);
    builder.boolean('r', config.enableInternalAuth && config.enableUserRegister);
    builder.boolean('f', config.enableInternalAuth && config.enableUserForgetPassword);
    builder.boolean('t', config.enableAPIToken);
    builder.boolean('v', config.enableUserVerifyEmail);
    builder.boolean('c', config.enableUserCustomIcon);
    builder.boolean('p', config.enableTransactionPictures);
    builder.boolean('s', config.enableScheduledTransaction);
    builder.boolean('e', config.enableDataExport);
    builder.boolean('i', config.enableDataImport);
    builder.string('op', config.oauth2Provider);

    if (config.oauth2Provider === OAuth2ProviderOIDC && config.oauth2OIDCCustomDisplayNameConfig.enabled) {
        builder.multiLanguageTip('ocn', config.oauth2OIDCCustomDisplayNameConfig);
    }

    if (config.enableMCPServer) {
        builder.boolean('mcp', config.enableMCPServer);
    }

    if (config.textRecognitionLLMConfig && config.textRecognitionLLMConfig.llmProvider !== '' && config.transactionFromAITextRecognition) {
        builder.boolean('llmtr', config.transactionFromAITextRecognition);
    }

    if (config.receiptImageRecognitionLLMConfig && config.receiptImageRecognitionLLMConfig.llmProvider !== '' && config.transactionFromAIImageRecognition) {
        builder.boolean('llmir', config.transactionFromAIImageRecognition);
    }

    if (config.loginPageTips.enabled) {
        builder.multiLanguageTip('lpt', config.loginPageTips);
    }

    builder.string('m', config.mapProvider);

    if (config.enableMapDataFetchProxy &&
        (config.mapProvider === OpenStreetMapProvider ||
            config.mapProvider === OpenStreetMapHumanitarianStyleProvider ||
            config.mapProvider === OpenTopoMapProvider ||
            config.mapProvider === OPNVKarteMapProvider ||
            config.mapProvider === CyclOSMMapProvider ||
            config.mapProvider === CartoDBMapProvider ||
            config.mapProvider === TomTomMapProvider ||
            config.mapProvider === TianDiTuProvider ||
            config.mapProvider === CustomProvider)) {
        builder.boolean('mp', config.enableMapDataFetchProxy);
    }

    if (config.mapProvider === CustomProvider) {
        builder.string('cmzl', `${config.customMapTileServerMinZoomLevel}-${config.customMapTileServerMaxZoomLevel}-${config.customMapTileServerDefaultZoomLevel}`);

        if (!config.enableMapDataFetchProxy) {
            builder.string('cmsu', config.customMapTileServerTileLayerUrl);

            if (config.customMapTileServerAnnotationLayerUrl !== '') {
                builder.string('cmau', config.customMapTileServerAnnotationLayerUrl);
            }
        } else if (config.customMapTileServerAnnotationLayerUrl !== '') {
            builder.boolean('cmap', config.enableMapDataFetchProxy);
        }
    }

    if (config.mapProvider === TomTomMapProvider && config.tomTomMapAPIKey !== '' && !config.enableMapDataFetchProxy) {
        builder.string('tmak', config.tomTomMapAPIKey);
    }

    if (config.mapProvider === TianDiTuProvider && config.tianDiTuAPIKey !== '' && !config.enableMapDataFetchProxy) {
        builder.string('tdak', config.tianDiTuAPIKey);
    }

    if (config.mapProvider === GoogleMapProvider && config.googleMapAPIKey !== '') {
        builder.string('gmak', config.googleMapAPIKey);
    }

    if (config.mapProvider === BaiduMapProvider && config.baiduMapAK !== '') {
        builder.string('bmak', config.baiduMapAK);
    }

    if (config.mapProvider === AmapProvider && config.amapApplicationKey !== '') {
        builder.string('amak', config.amapApplicationKey);
    }

    if (config.mapProvider === AmapProvider && config.amapSecurityVerificationMethod !== '') {
        builder.string('amsv', config.amapSecurityVerificationMethod);

        if (config.amapSecurityVerificationMethod === AmapSecurityVerificationExternalProxyMethod) {
            builder.string('amep', config.amapApiExternalProxyUrl);
        }

        if (config.amapSecurityVerificationMethod === AmapSecurityVerificationPlainTextMethod) {
            builder.string('amas', config.amapApplicationSecret);
        }
    }

    if (config.exchangeRatesRequestTimeoutExceedDefaultValue) {
        builder.integer('errt', config.exchangeRatesRequestTimeout);
    }

    return [Buffer.from(builder.build(), 'utf8'), ''];
}

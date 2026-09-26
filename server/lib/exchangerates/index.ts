import { type Zone } from 'luxon';

import type { Context } from '../core/context';
import { getOutgoingUserAgent } from '../core/types';
import * as errs from '../errs/index';
import { type HttpClient, newHttpClient } from '../httpclient/index';
import * as log from '../log/index';
import { type LatestExchangeRate, type LatestExchangeRateResponse, toLatestExchangeRate } from '../models/index';
import { UserCustomExchangeRates } from '../services/user_custom_exchange_rates';
import { Users } from '../services/users';
import {
    BankOfCanadaDataSource,
    BankOfIsraelDataSource,
    BankOfRussiaDataSource,
    CentralBankOfArgentinaDataSource,
    CentralBankOfHungaryDataSource,
    CentralBankOfMyanmarDataSource,
    CentralBankOfUzbekistanDataSource,
    type Config,
    CzechNationalBankDataSource,
    DanmarksNationalbankDataSource,
    EuroCentralBankDataSource,
    NationalBankOfGeorgiaDataSource,
    NationalBankOfKazakhstanDataSource,
    NationalBankOfPolandDataSource,
    NationalBankOfRomaniaDataSource,
    NationalBankOfUkraineDataSource,
    NorgesBankDataSource,
    SwissNationalBankDataSource,
    UserCustomExchangeRatesDataSource,
} from '../settings/settings';
import { float64ToString, stringToFloat64, stringToInt, stringToInt64Number } from '../utils/converter';
import { loadLocation } from '../utils/datetimes';
import { parseGoTime } from '../utils/golayout';
import { parseXml, xmlAttr, xmlChildren, type XmlElement, xmlFind, xmlFirst, xmlText } from '../utils/xml';
import { allCurrencyNames } from '../web/binding';

// ExchangeRatesDataProvider defines the structure of exchange rates data provider
export interface ExchangeRatesDataProvider {
    getLatestExchangeRates(c: Context, uid: bigint, currentConfig: Config): Promise<LatestExchangeRateResponse>;
}

interface HttpRequestDefinition {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
}

// HttpExchangeRatesDataSource defines the structure of http exchange rates data source
interface HttpExchangeRatesDataSource {
    buildRequests(): HttpRequestDefinition[];
    parse(c: Context, content: Buffer): LatestExchangeRateResponse;
}

function isValidCurrency(currency: string): boolean {
    return allCurrencyNames.has(currency);
}

function tryParseFloat(value: string): number | null {
    try {
        return stringToFloat64(value);
    } catch {
        return null;
    }
}

function goFloat(value: number): string {
    return value.toFixed(6);
}

function parseTimeInZone(layout: string, value: string, zoneName: string): number | null {
    const zone = loadLocation(zoneName) as Zone | null;

    if (!zone) {
        return null;
    }

    try {
        return Math.floor(parseGoTime(layout, value, zone).toSeconds());
    } catch {
        return null;
    }
}

function parseTimeUtc(layout: string, value: string): number | null {
    try {
        return Math.floor(parseGoTime(layout, value, null).toSeconds());
    } catch {
        return null;
    }
}

function parseXmlRoot(c: Context, content: Buffer, rootName: string, prefix: string): XmlElement {
    try {
        const root = parseXml(content);

        if (root.name !== rootName) {
            throw new Error(`expected element type <${rootName}> but have <${root.name}>`);
        }

        return root;
    } catch (err) {
        log.errorf(c, `[${prefix}.Parse] failed to parse xml data, content is ${content.toString('utf8')}, because ${(err as Error).message}`);
        throw errs.ErrFailedToRequestRemoteApi;
    }
}

function parseJsonContent<T>(c: Context, content: Buffer, prefix: string, dataType: string = 'json', validate?: (data: unknown) => boolean): T {
    try {
        const data = JSON.parse(content.toString('utf8')) as unknown;

        if (validate && !validate(data)) {
            throw new Error('json: cannot unmarshal into go value');
        }

        return data as T;
    } catch (err) {
        log.errorf(c, `[${prefix}.Parse] failed to parse ${dataType} data, content is ${content.toString('utf8')}, because ${(err as Error).message}`);
        throw errs.ErrFailedToRequestRemoteApi;
    }
}

function failedToParseLatest(c: Context, content: Buffer, prefix: string): never {
    log.errorf(c, `[${prefix}.Parse] failed to parse latest exchange rate data, content is ${content.toString('utf8')}`);
    throw errs.ErrFailedToRequestRemoteApi;
}

function newResponse(dataSource: string, referenceUrl: string, updateTime: number, baseCurrency: string, exchangeRates: LatestExchangeRate[]): LatestExchangeRateResponse {
    return { dataSource, referenceUrl, updateTime, baseCurrency, exchangeRates };
}

function rateOf(currency: string, finalRate: number): LatestExchangeRate | null {
    if (!Number.isFinite(finalRate)) {
        return null;
    }

    return { currency: currency, rate: float64ToString(finalRate) };
}

// unitDividedByRate returns unit / rate, both are validated to be positive
function unitDividedByRate(c: Context, prefix: string, currency: string, rateText: string, unitText: string | null, unitLabel: string = 'unit'): LatestExchangeRate | null {
    const rate = tryParseFloat(rateText);

    if (rate === null) {
        log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
        return null;
    }

    if (rate <= 0) {
        log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
        return null;
    }

    let unit = 1;

    if (unitText !== null) {
        const parsedUnit = tryParseFloat(unitText);

        if (parsedUnit === null) {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse ${unitLabel}, currency is ${currency}, ${unitLabel} is ${unitText}`);
            return null;
        }

        if (parsedUnit <= 0) {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] ${unitLabel} is less or equal zero, currency is ${currency}, ${unitLabel} is ${unitText}`);
            return null;
        }

        unit = parsedUnit;
    }

    return rateOf(currency, unit / rate);
}

// European Central Bank
class EuroCentralBankExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'euro_central_bank_datasource';
        const root = parseXmlRoot(c, content, 'Envelope', prefix);
        const allExchangeRates = xmlFind(root, 'Cube>Cube');
        const result = ((): LatestExchangeRateResponse | null => {
            const latest = allExchangeRates[0];

            if (!latest) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const rates = xmlChildren(latest, 'Cube');

            if (rates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const rate of rates) {
                const currency = xmlAttr(rate, 'currency');
                const rateText = xmlAttr(rate, 'rate');

                if (!isValidCurrency(currency) || tryParseFloat(rateText) === null) {
                    continue;
                }

                exchangeRates.push({ currency: currency, rate: rateText });
            }

            const updateDateTime = xmlAttr(latest, 'time') + ' 16';
            const updateTime = parseTimeInZone('2006-01-02 15', updateDateTime, 'Europe/Berlin');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('European Central Bank', 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', updateTime, 'EUR', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Bank of Canada
class BankOfCanadaExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'bank_of_canada_datasource';
        const data = parseJsonContent<{ observations?: Record<string, unknown>[] | null }>(c, content, prefix, 'json', d => d === null || (typeof d === 'object' && !Array.isArray(d)));
        const observations = Array.isArray(data?.observations) ? data.observations : [];

        const result = ((): LatestExchangeRateResponse | null => {
            if (observations.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] observations is empty`);
                return null;
            }

            const exchangeRateMap = new Map<string, string>();
            let latestUpdateDate = '';

            for (const observation of observations) {
                if (!observation || typeof observation !== 'object') {
                    continue;
                }

                const updateDate = observation['d'];

                if (typeof updateDate === 'string' && (latestUpdateDate === '' || updateDate > latestUpdateDate)) {
                    latestUpdateDate = updateDate;
                }

                for (const [typeName, exchangeRateData] of Object.entries(observation)) {
                    if (typeName.length < 8 || !typeName.startsWith('FX') || !typeName.endsWith('CAD')) {
                        continue;
                    }

                    const currencyCode = typeName.substring(2, 5);

                    if (exchangeRateData && typeof exchangeRateData === 'object') {
                        const value = (exchangeRateData as Record<string, unknown>)['v'];

                        if (typeof value === 'string') {
                            exchangeRateMap.set(currencyCode, value);
                        }
                    }
                }
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const [currencyCode, exchangeRate] of exchangeRateMap) {
                if (!isValidCurrency(currencyCode)) {
                    continue;
                }

                const rate = tryParseFloat(exchangeRate);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse rate, rate is ${exchangeRate}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRateResponse] rate is invalid, rate is ${exchangeRate}`);
                    continue;
                }

                const finalRate = rateOf(currencyCode, 1 / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = latestUpdateDate + ' 16:30';
            const updateTime = parseTimeInZone('2006-01-02 15:04', updateDateTime, 'America/Toronto');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Bank of Canada', 'https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/', updateTime, 'CAD', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Bank of Israel
class BankOfIsraelExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://boi.org.il/PublicApi/GetExchangeRates?asXml=true' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'bank_of_israel_datasource';
        const root = parseXmlRoot(c, content, 'ExchangeRatesResponseCollectioDTO', prefix);
        const allExchangeRates = xmlFind(root, 'ExchangeRates>ExchangeRateResponseDTO');

        const result = ((): LatestExchangeRateResponse | null => {
            if (allExchangeRates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            let latestUpdateDate = '';
            const exchangeRates: LatestExchangeRate[] = [];

            for (const item of allExchangeRates) {
                const currency = xmlText(item, 'Key');

                if (latestUpdateDate === '') {
                    latestUpdateDate = xmlText(item, 'LastUpdate');
                }

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const finalRate = unitDividedByRate(c, prefix, currency, xmlText(item, 'CurrentExchangeRate'), xmlText(item, 'Unit'));

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateTime = parseTimeUtc('2006-01-02T15:04:05.9999999Z', latestUpdateDate);

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${latestUpdateDate}`);
                return null;
            }

            return newResponse('בנק ישראל', 'https://www.boi.org.il/en/economic-roles/financial-markets/exchange-rates/', updateTime, 'ILS', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Bank of Russia
class BankOfRussiaExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://cbr.ru/scripts/XML_daily_eng.asp' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'bank_of_russia_datasource';
        const root = parseXmlRoot(c, content, 'ValCurs', prefix);
        const items = xmlChildren(root, 'Valute');

        const result = ((): LatestExchangeRateResponse | null => {
            if (items.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const item of items) {
                const currency = xmlText(item, 'CharCode');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const rateText = xmlText(item, 'VunitRate');
                const rate = tryParseFloat(rateText.replaceAll(',', '.'));

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                const finalRate = rateOf(currency, 1 / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = xmlAttr(root, 'Date') + ' 15:30';
            const updateTime = parseTimeInZone('02.01.2006 15:04', updateDateTime, 'Europe/Moscow');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Банк России', 'https://www.cbr.ru/eng/currency_base/daily/', updateTime, 'RUB', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Central Bank of Argentina
class CentralBankOfArgentinaExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'central_bank_of_argentina_datasource';
        const data = parseJsonContent<{ results?: { fecha?: string; detalle?: Record<string, unknown>[] | null } | null } | null>(c, content, prefix, 'json', d => d === null || (typeof d === 'object' && !Array.isArray(d)));
        const date = typeof data?.results?.fecha === 'string' ? data.results.fecha : '';
        const details = Array.isArray(data?.results?.detalle) ? data.results.detalle : [];

        const result = ((): LatestExchangeRateResponse | null => {
            if (details.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] detalle is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const detail of details) {
                const currencyCode = String(detail?.['codigoMoneda'] ?? '');

                if (!isValidCurrency(currencyCode)) {
                    continue;
                }

                const arsQuoteRate = Number(detail['tipoCotizacion'] ?? 0);
                const description = String(detail['descripcion'] ?? '');

                if (!(arsQuoteRate > 0)) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currencyCode}, rate is ${goFloat(arsQuoteRate)}`);
                    continue;
                }

                let unit = 1;

                if (description !== '') {
                    const matches = /C\/(\d+(?:\.\d+)*)\s+UNIDADES/.exec(description);

                    if (matches && matches[1]) {
                        const parsedUnit = tryParseFloat(matches[1].replaceAll('.', ''));

                        if (parsedUnit === null) {
                            log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse per-unit quantity, currency is ${currencyCode}, descripcion is ${description}`);
                            continue;
                        }

                        if (parsedUnit <= 0) {
                            log.warnf(c, `[${prefix}.ToLatestExchangeRate] per-unit quantity is invalid, currency is ${currencyCode}, descripcion is ${description}`);
                            continue;
                        }

                        unit = parsedUnit;
                    }
                }

                const finalRate = rateOf(currencyCode, unit / arsQuoteRate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateTime = parseTimeInZone('2006-01-02', date, 'America/Buenos_Aires');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                return null;
            }

            return newResponse('Banco Central de la República Argentina', 'https://www.bcra.gob.ar/en/central-bank-api-catalog/', updateTime, 'ARS', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Central Bank of Hungary
class CentralBankOfHungaryExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{
            method: 'POST',
            url: 'http://www.mnb.hu/arfolyamok.asmx',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.mnb.hu/webservices/MNBArfolyamServiceSoap/GetCurrentExchangeRates',
            },
            body: '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
                '<s:Body>' +
                '<GetCurrentExchangeRates xmlns="http://www.mnb.hu/webservices/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"/>' +
                '</s:Body>' +
                '</s:Envelope>',
        }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'central_bank_of_hungary_datasource';
        let serviceResult: string;

        try {
            const root = parseXml(content);

            if (root.name !== 'Envelope') {
                throw new Error(`expected element type <Envelope> but have <${root.name}>`);
            }

            serviceResult = xmlText(root, 'Body>GetCurrentExchangeRatesResponse>GetCurrentExchangeRatesResult');
        } catch (err) {
            log.errorf(c, `[${prefix}.Parse] failed to parse service response xml data, content is ${content.toString('utf8')}, because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        if (serviceResult.length < 1) {
            log.errorf(c, `[${prefix}.Parse] exchange rates response is empty`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        let resultRoot: XmlElement;

        try {
            resultRoot = parseXml(serviceResult);

            if (resultRoot.name !== 'MNBCurrentExchangeRates') {
                throw new Error(`expected element type <MNBCurrentExchangeRates> but have <${resultRoot.name}>`);
            }
        } catch (err) {
            log.errorf(c, `[${prefix}.Parse] failed to parse exchange rates response xml data, content is ${content.toString('utf8')}, because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const result = ((): LatestExchangeRateResponse | null => {
            const days = xmlChildren(resultRoot, 'Day');
            const latest = days[0];

            if (!latest) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const rates = xmlChildren(latest, 'Rate');

            if (rates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const rate of rates) {
                const currency = xmlAttr(rate, 'curr');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const finalRate = unitDividedByRate(c, prefix, currency, rate.text.replaceAll(',', '.'), xmlAttr(rate, 'unit'));

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = xmlAttr(latest, 'date') + ' 11';
            const updateTime = parseTimeInZone('2006-01-02 15', updateDateTime, 'Europe/Budapest');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Magyar Nemzeti Bank', 'https://www.mnb.hu/en/arfolyamok', updateTime, 'HUF', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Central Bank of Myanmar
const centralBankOfMyanmarSpecialCurrencyUnits: Record<string, number> = {
    JPY: 100,
    KHR: 100,
    IDR: 100,
    KRW: 100,
    LAK: 100,
    VND: 100,
};

class CentralBankOfMyanmarExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://forex.cbm.gov.mm/api/latest' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'central_bank_of_myanmar_datasource';
        const data = parseJsonContent<{ timestamp?: string; rates?: Record<string, string> | null } | null>(c, content, prefix, 'xml', d => d === null || (typeof d === 'object' && !Array.isArray(d)));

        const result = ((): LatestExchangeRateResponse | null => {
            const exchangeRates: LatestExchangeRate[] = [];

            for (const [currencyCode, exchangeRate] of Object.entries(data?.rates ?? {})) {
                if (!isValidCurrency(currencyCode)) {
                    continue;
                }

                const rateText = String(exchangeRate);
                const rate = tryParseFloat(rateText.replaceAll(',', ''));

                if (rate === null) {
                    log.warnf(c, `[${prefix}.BuildLatestExchangeRate] failed to parse rate, currency is ${currencyCode}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.BuildLatestExchangeRate] rate is invalid, currency is ${currencyCode}, rate is ${rateText}`);
                    continue;
                }

                const unit = Object.hasOwn(centralBankOfMyanmarSpecialCurrencyUnits, currencyCode) ? centralBankOfMyanmarSpecialCurrencyUnits[currencyCode] as number : 1;
                const finalRate = rateOf(currencyCode, unit / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const timestamp = typeof data?.timestamp === 'string' ? data.timestamp : '';
            let updateTime: number;

            try {
                updateTime = stringToInt64Number(timestamp);
            } catch {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse timestamp, timestamp is ${timestamp}`);
                return null;
            }

            return newResponse('မြန်မာနိုင်ငံတော်ဗဟိုဘဏ်', 'https://forex.cbm.gov.mm/index.php/fxrate', updateTime, 'MMK', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Central Bank of Uzbekistan
class CentralBankOfUzbekistanExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://cbu.uz/ru/arkhiv-kursov-valyut/json/' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'central_bank_of_uzbekistan_datasource';
        const data = parseJsonContent<Record<string, unknown>[] | null>(c, content, prefix, 'xml', d => d === null || Array.isArray(d));
        const items = data ?? [];

        const result = ((): LatestExchangeRateResponse | null => {
            if (items.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];
            let latestUpdateTime = 0;

            for (const item of items) {
                const currency = String(item?.['Ccy'] ?? '');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const date = String(item['Date'] ?? '');
                const updateTime = parseTimeInZone('02.01.2006', date, 'Asia/Samarkand');

                if (updateTime === null) {
                    log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                    return null;
                }

                if (updateTime > latestUpdateTime) {
                    latestUpdateTime = updateTime;
                }

                const rateText = String(item['Rate'] ?? '');
                const unitText = String(item['Nominal'] ?? '');
                const rate = tryParseFloat(rateText);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                const unit = tryParseFloat(unitText);

                if (unit === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse unit, currency is ${currency}, unit is ${unitText}`);
                    continue;
                }

                if (unit <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] unit is less or equal zero, currency is ${currency}, unit is ${unitText}`);
                    continue;
                }

                const finalRate = rateOf(currency, 1000 * unit / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            return newResponse('O‘zbekiston Respublikasi Markaziy banki', 'https://cbu.uz/en/arkhiv-kursov-valyut/', latestUpdateTime, 'UZS', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Czech National Bank
class CzechNationalBankExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [
            { method: 'GET', url: 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/fx-rates-of-other-currencies/fx-rates-of-other-currencies/fx_rates.txt' },
            { method: 'GET', url: 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt' },
        ];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'czech_national_bank_datasource';
        const text = content.toString('utf8');
        const lines = text.split('\n');

        if (lines.length < 3) {
            log.errorf(c, `[${prefix}.Parse] content is invalid, content is ${text}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const headerLineItems = (lines[0] as string).split('#');

        if (headerLineItems.length !== 2) {
            log.errorf(c, `[${prefix}.Parse] first line of content is invalid, content is ${lines[0]}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const updateDate = (headerLineItems[0] as string).trim();
        const titleLineItems = (lines[1] as string).split('|');
        const titleItemMap = new Map<string, number>();

        titleLineItems.forEach((item, index) => titleItemMap.set(item, index));

        const currencyCodeColumnIndex = titleItemMap.get('Code');
        const amountColumnIndex = titleItemMap.get('Amount');
        const rateColumnIndex = titleItemMap.get('Rate');

        if (currencyCodeColumnIndex === undefined) {
            log.errorf(c, `[${prefix}.Parse] missing currency code column in title line, title line is ${lines[1]}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        if (amountColumnIndex === undefined) {
            log.errorf(c, `[${prefix}.Parse] missing amount column in title line, title line is ${lines[1]}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        if (rateColumnIndex === undefined) {
            log.errorf(c, `[${prefix}.Parse] missing rate column in title line, title line is ${lines[1]}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const exchangeRates: LatestExchangeRate[] = [];

        for (let i = 2; i < lines.length; i++) {
            const line = (lines[i] as string).trim();

            if (line.length < 1) {
                continue;
            }

            const items = line.split('|');

            if (currencyCodeColumnIndex >= items.length || amountColumnIndex >= items.length || rateColumnIndex >= items.length) {
                log.warnf(c, `[${prefix}.parseExchangeRate] missing column in data line, line is ${line}`);
                continue;
            }

            const currencyCode = items[currencyCodeColumnIndex] as string;

            if (!isValidCurrency(currencyCode)) {
                continue;
            }

            let amount: number;

            try {
                amount = stringToInt64Number(items[amountColumnIndex] as string);
            } catch {
                log.warnf(c, `[${prefix}.parseExchangeRate] failed to parse amount, line is ${line}`);
                continue;
            }

            if (amount <= 0) {
                log.warnf(c, `[${prefix}.parseExchangeRate] amount is invalid, line is ${line}`);
                continue;
            }

            const rate = tryParseFloat(items[rateColumnIndex] as string);

            if (rate === null) {
                log.warnf(c, `[${prefix}.parseExchangeRate] failed to parse rate, line is ${line}`);
                continue;
            }

            if (rate <= 0) {
                log.warnf(c, `[${prefix}.parseExchangeRate] rate is invalid, line is ${line}`);
                continue;
            }

            const finalRate = rateOf(currencyCode, amount / rate);

            if (finalRate) {
                exchangeRates.push(finalRate);
            }
        }

        const updateDateTime = updateDate + ' 14:30';
        const updateTime = parseTimeInZone('02 Jan 2006 15:04', updateDateTime, 'Europe/Prague');

        if (updateTime === null) {
            log.errorf(c, `[${prefix}.Parse] failed to parse update date, datetime is ${updateDateTime}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        return newResponse('Česká národní banka', 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/', updateTime, 'CZK', exchangeRates);
    }
}

// Danmarks Nationalbank
class DanmarksNationalbankExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://www.nationalbanken.dk/api/currencyratesxml?lang=en' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'danmarks_national_bank_datasource';
        const root = parseXmlRoot(c, content, 'exchangerates', prefix);

        const result = ((): LatestExchangeRateResponse | null => {
            const latest = xmlChildren(root, 'dailyrates')[0];

            if (!latest) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] daily exchange rates is empty`);
                return null;
            }

            const rates = xmlChildren(latest, 'currency');

            if (rates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const rate of rates) {
                const currency = xmlAttr(rate, 'code');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const rateText = xmlAttr(rate, 'rate');
                const value = tryParseFloat(rateText);

                if (value === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (value <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                const finalRate = rateOf(currency, 100 / value);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = xmlAttr(latest, 'id') + ' 16';
            const updateTime = parseTimeInZone('2006-01-02 15', updateDateTime, 'Europe/Copenhagen');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Danmarks Nationalbank', 'https://www.nationalbanken.dk/en/what-we-do/stable-prices-monetary-policy-and-the-danish-economy/exchange-rates', updateTime, xmlAttr(root, 'refcur'), exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// National Bank of Georgia
class NationalBankOfGeorgiaExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'national_bank_of_georgia_datasource';
        const data = parseJsonContent<{ currencies?: Record<string, unknown>[] | null }[] | null>(c, content, prefix, 'xml', d => d === null || Array.isArray(d));

        if (!data || data.length < 1) {
            log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const items = Array.isArray(data[0]?.currencies) ? data[0].currencies : [];

        const result = ((): LatestExchangeRateResponse | null => {
            if (items.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];
            let latestUpdateTime = 0;

            for (const item of items) {
                const currency = String(item?.['code'] ?? '');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const date = String(item['date'] ?? '');
                const updateTime = parseTimeUtc('2006-01-02T15:04:05.999Z', date);

                if (updateTime === null) {
                    log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                    return null;
                }

                if (updateTime > latestUpdateTime) {
                    latestUpdateTime = updateTime;
                }

                const rate = Number(item['rate'] ?? 0);
                const quantity = Number(item['quantity'] ?? 0);

                if (!(rate > 0)) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${goFloat(rate)}`);
                    continue;
                }

                if (!(quantity > 0)) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] quantity is invalid, currency is ${currency}, quantity is ${goFloat(quantity)}`);
                    continue;
                }

                const finalRate = rateOf(currency, quantity / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            return newResponse('საქართველოს ეროვნული ბანკი', 'https://nbg.gov.ge/en/monetary-policy/currency', latestUpdateTime, 'GEL', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// National Bank of Kazakhstan
class NationalBankOfKazakhstanExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://www.nationalbank.kz/rss/rates_all.xml' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'national_bank_of_kazakhstan_datasource';
        let root: XmlElement;

        try {
            root = parseXml(content);
        } catch (err) {
            log.errorf(c, `[${prefix}.Parse] failed to parse xml data, content is ${content.toString('utf8')}, because ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const items = xmlFind(root, 'channel>item');

        const result = ((): LatestExchangeRateResponse | null => {
            if (items.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];
            let latestUpdateTime = 0;

            for (const item of items) {
                const currency = xmlText(item, 'title');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const date = xmlText(item, 'pubDate');
                const updateDateTime = date + (currency === 'USD' ? ' 15:30' : ' 16:00');
                const updateTime = parseTimeInZone('02.01.2006 15:04', updateDateTime, 'Asia/Almaty');

                if (updateTime === null) {
                    log.errorf(c, `[central_bank_of_kazakhstan_datasource.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                    return null;
                }

                if (updateTime > latestUpdateTime) {
                    latestUpdateTime = updateTime;
                }

                const rateText = xmlText(item, 'description');
                const unitText = xmlText(item, 'quant');
                const rate = tryParseFloat(rateText);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                const unit = tryParseFloat(unitText);

                if (unit === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse unit, currency=${currency}, unit=${unitText}`);
                    continue;
                }

                if (unit <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] unit is less or equal zero, currency is ${currency}, unit is ${unitText}`);
                    continue;
                }

                const finalRate = rateOf(currency, unit / rate);

                if (!finalRate) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] final exchange rate calculation failed, currency is ${currency}, unit is ${unitText}, rate is ${rateText}`);
                    continue;
                }

                exchangeRates.push(finalRate);
            }

            return newResponse('Қазақстан Республикасының Ұлттық Банкі', 'https://nationalbank.kz/en/exchangerates/ezhednevnye-oficialnye-rynochnye-kursy-valyut', latestUpdateTime, 'KZT', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Norges Bank
class NorgesBankExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://data.norges-bank.no/api/data/EXR/B..NOK.SP?format=sdmx-compact-2.1&lastNObservations=1' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'norges_bank_datasource';
        const root = parseXmlRoot(c, content, 'StructureSpecificData', prefix);

        const result = ((): LatestExchangeRateResponse | null => {
            const dataSet = xmlChildren(root, 'DataSet');
            const lastDataSet = dataSet[dataSet.length - 1];
            const series = xmlChildren(lastDataSet, 'Series');

            if (!lastDataSet || series.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];
            let latestUpdateTime = 0;

            for (const item of series) {
                const baseCurrency = xmlAttr(item, 'BASE_CUR');

                if (!isValidCurrency(baseCurrency)) {
                    continue;
                }

                if (xmlAttr(item, 'QUOTE_CUR') !== 'NOK') {
                    continue;
                }

                const observations = xmlChildren(item, 'Obs');
                const observation = observations[0];

                if (!observation) {
                    continue;
                }

                const date = xmlAttr(observation, 'TIME_PERIOD');
                const updateTime = parseTimeInZone('2006-01-02 15', date + ' 16', 'Europe/Oslo');

                if (updateTime === null) {
                    log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                    return null;
                }

                if (updateTime > latestUpdateTime) {
                    latestUpdateTime = updateTime;
                }

                const exchangeRate = xmlAttr(observation, 'OBS_VALUE');
                const rate = tryParseFloat(exchangeRate);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${baseCurrency}, rate is ${exchangeRate}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${baseCurrency}, rate is ${exchangeRate}`);
                    continue;
                }

                const unitExponentText = xmlAttr(item, 'UNIT_MULT');
                let unitExponent: number;

                try {
                    unitExponent = stringToInt(unitExponentText);
                } catch {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse unit, currency is ${baseCurrency}, unit exponent is ${unitExponentText}`);
                    continue;
                }

                let finalRate = 1 / rate;

                if (unitExponent > 0) {
                    finalRate = finalRate / Math.pow(10, -unitExponent);
                } else if (unitExponent < 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] unit exponent is less than zero, currency is ${baseCurrency}, unit is ${unitExponentText}`);
                    continue;
                }

                const latestRate = rateOf(baseCurrency, finalRate);

                if (latestRate) {
                    exchangeRates.push(latestRate);
                }
            }

            return newResponse('Norges Bank', 'https://www.norges-bank.no/en/topics/Statistics/exchange_rates/', latestUpdateTime, 'NOK', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// National Bank of Poland
class NationalBankOfPolandExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [
            { method: 'GET', url: 'https://api.nbp.pl/api/exchangerates/tables/B?format=xml' },
            { method: 'GET', url: 'https://api.nbp.pl/api/exchangerates/tables/A?format=xml' },
        ];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'national_bank_of_poland_datasource';
        const root = parseXmlRoot(c, content, 'ArrayOfExchangeRatesTable', prefix);
        const allExchangeRates = xmlFind(root, 'ExchangeRatesTable>Rates>Rate');

        const result = ((): LatestExchangeRateResponse | null => {
            if (allExchangeRates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const item of allExchangeRates) {
                const currency = xmlText(item, 'Code');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const rateText = xmlText(item, 'Mid');
                const rate = tryParseFloat(rateText);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                const finalRate = rateOf(currency, 1 / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = xmlText(root, 'ExchangeRatesTable>EffectiveDate') + ' 12:15';
            const updateTime = parseTimeInZone('2006-01-02 15:04', updateDateTime, 'Europe/Warsaw');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Narodowy Bank Polski', 'https://nbp.pl/en/statistic-and-financial-reporting/rates/', updateTime, 'PLN', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// National Bank of Romania
class NationalBankOfRomaniaExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://curs.bnr.ro/nbrfxrates.xml' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'national_bank_of_romania_datasource';
        const root = parseXmlRoot(c, content, 'DataSet', prefix);

        const result = ((): LatestExchangeRateResponse | null => {
            const header = xmlChildren(root, 'Header').pop() ?? null;
            const body = xmlChildren(root, 'Body').pop() ?? null;

            if (!header || !body) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] header or body is empty`);
                return null;
            }

            const cubes = xmlChildren(body, 'Cube');
            const latest = cubes[0];

            if (!latest) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] all exchange rates is empty`);
                return null;
            }

            const rates = xmlChildren(latest, 'Rate');

            if (rates.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] exchange rates is empty`);
                return null;
            }

            const exchangeRates: LatestExchangeRate[] = [];

            for (const item of rates) {
                const currency = xmlAttr(item, 'currency');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const rateText = item.text;
                const rate = tryParseFloat(rateText);

                if (rate === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                if (rate <= 0) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${rateText}`);
                    continue;
                }

                let unit = 1;
                const multiplier = xmlAttr(item, 'multiplier');

                if (multiplier !== '') {
                    const parsedUnit = tryParseFloat(multiplier);

                    if (parsedUnit === null || parsedUnit <= 0) {
                        log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse unit, currency is ${currency}, unit is ${multiplier}`);
                        continue;
                    }

                    unit = parsedUnit;
                }

                const finalRate = rateOf(currency, unit / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            const updateDateTime = xmlText(header, 'PublishingDate') + ' 13';
            const updateTime = parseTimeInZone('2006-01-02 15', updateDateTime, 'Europe/Bucharest');

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Banca Naţională a României', 'https://www.bnr.ro/en/561-exchange-rates', updateTime, xmlText(body, 'OrigCurrency'), exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// National Bank of Ukraine
class NationalBankOfUkraineExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://bank.gov.ua/NBU_Exchange/exchange?json' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'national_bank_of_ukraine_datasource';
        let data: Record<string, unknown>[] | null;

        try {
            data = JSON.parse(content.toString('utf8')) as Record<string, unknown>[] | null;

            if (data !== null && !Array.isArray(data)) {
                throw new Error('json: cannot unmarshal object into Go value of type exchangerates.NationalBankOfUkraineExchangeRates');
            }
        } catch (err) {
            log.errorf(c, `[${prefix}.Parse] failed to parse JSON data, content: ${content.toString('utf8')}, error: ${(err as Error).message}`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        if (!data || data.length === 0) {
            log.errorf(c, `[${prefix}.Parse] exchange rate list is empty`);
            throw errs.ErrFailedToRequestRemoteApi;
        }

        const items = data;

        const result = ((): LatestExchangeRateResponse | null => {
            const exchangeRates: LatestExchangeRate[] = [];
            let latestUpdateTime = 0;

            for (const item of items) {
                const currency = String(item?.['CurrencyCodeL'] ?? '');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const date = String(item['StartDate'] ?? '');
                const updateTime = parseTimeUtc('02.01.2006', date);

                if (updateTime === null) {
                    log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${date}`);
                    return null;
                }

                if (updateTime > latestUpdateTime) {
                    latestUpdateTime = updateTime;
                }

                const rate = Number(item['Amount'] ?? 0);
                const quantity = Number(item['Units'] ?? 0);

                if (!(rate > 0)) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${goFloat(rate)}`);
                    continue;
                }

                if (!(quantity > 0)) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRate] quantity is invalid, currency is ${currency}, quantity is ${goFloat(quantity)}`);
                    continue;
                }

                const finalRate = rateOf(currency, quantity / rate);

                if (finalRate) {
                    exchangeRates.push(finalRate);
                }
            }

            return newResponse('Національний банк України', 'https://bank.gov.ua/en/markets/exchangerates', latestUpdateTime, 'UAH', exchangeRates);
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }
}

// Swiss National Bank
class SwissNationalBankExchangeRatesDataSource implements HttpExchangeRatesDataSource {
    public buildRequests(): HttpRequestDefinition[] {
        return [{ method: 'GET', url: 'https://www.snb.ch/public/en/rss/exchangeRates' }];
    }

    public parse(c: Context, content: Buffer): LatestExchangeRateResponse {
        const prefix = 'swiss_national_bank_datasource';
        const root = parseXmlRoot(c, content, 'rss', prefix);

        const result = ((): LatestExchangeRateResponse | null => {
            const channel = xmlChildren(root, 'channel').pop() ?? null;

            if (!channel) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] rss channel does not exist`);
                return null;
            }

            const items = xmlChildren(channel, 'item');

            if (items.length < 1) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] channel items is empty`);
                return null;
            }

            const latestCurrencyExchangeRateDate = new Map<string, number>();
            const latestExchangeRates = new Map<string, LatestExchangeRate>();

            for (const item of items) {
                const exchangeRate = xmlFirst(item, 'statistics>exchangeRate');
                const observation = xmlChildren(exchangeRate, 'observation').pop() ?? null;
                const observationPeriod = xmlChildren(exchangeRate, 'observationPeriod').pop() ?? null;

                if (!exchangeRate || !observation || !observationPeriod) {
                    continue;
                }

                if (xmlText(exchangeRate, 'baseCurrency') !== 'CHF' || xmlText(observation, 'unit') !== 'CHF') {
                    continue;
                }

                const currency = xmlText(exchangeRate, 'targetCurrency');

                if (!isValidCurrency(currency)) {
                    continue;
                }

                const period = xmlText(observationPeriod, 'period');
                const date = parseTimeUtc('2006-01-02', period);

                if (date === null) {
                    log.warnf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse exchange rate period date, period is ${period}`);
                    continue;
                }

                const latestDate = latestCurrencyExchangeRateDate.get(currency);

                if (latestDate === undefined || date > latestDate) {
                    const finalExchangeRate = this.toLatestExchangeRate(c, currency, xmlText(observation, 'value'), xmlText(observation, 'unit_mult'));

                    if (finalExchangeRate) {
                        latestCurrencyExchangeRateDate.set(currency, date);
                        latestExchangeRates.set(currency, finalExchangeRate);
                    }
                }
            }

            const updateDateTime = xmlText(channel, 'pubDate');
            const updateTime = parseTimeUtc('Mon, 02 Jan 2006 15:04:05 MST', updateDateTime);

            if (updateTime === null) {
                log.errorf(c, `[${prefix}.ToLatestExchangeRateResponse] failed to parse update date, datetime is ${updateDateTime}`);
                return null;
            }

            return newResponse('Schweizerische Nationalbank', 'https://www.snb.ch/en/the-snb/mandates-goals/statistics/statistics-pub/current_interest_exchange_rates', updateTime, 'CHF', Array.from(latestExchangeRates.values()));
        })();

        return result ?? failedToParseLatest(c, content, prefix);
    }

    private toLatestExchangeRate(c: Context, currency: string, value: string, unitExponentText: string): LatestExchangeRate | null {
        const prefix = 'swiss_national_bank_datasource';
        const rate = tryParseFloat(value);

        if (rate === null) {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse rate, currency is ${currency}, rate is ${value}`);
            return null;
        }

        if (rate <= 0) {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] rate is invalid, currency is ${currency}, rate is ${value}`);
            return null;
        }

        let unitExponent: number;

        try {
            unitExponent = stringToInt(unitExponentText);
        } catch {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] failed to parse unit, currency is ${currency}, unit exponent is ${unitExponentText}`);
            return null;
        }

        let finalRate = 1 / rate;

        if (unitExponent > 1) {
            finalRate = finalRate / Math.pow(10, unitExponent - 1);
        } else if (unitExponent < 0) {
            finalRate = finalRate * Math.pow(10, -unitExponent);
        } else if (unitExponent === 0) {
            log.warnf(c, `[${prefix}.ToLatestExchangeRate] unit exponent is zero, currency is ${currency}`);
            return null;
        }

        return rateOf(currency, finalRate);
    }
}

function sortExchangeRates(rates: LatestExchangeRate[]): LatestExchangeRate[] {
    return rates.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

// CommonHttpExchangeRatesDataProvider requests the data source and merges the results
class CommonHttpExchangeRatesDataProvider implements ExchangeRatesDataProvider {
    private readonly httpClient: HttpClient;

    public constructor(config: Config, private readonly dataSource: HttpExchangeRatesDataSource) {
        this.httpClient = newHttpClient(config.exchangeRatesRequestTimeout, config.exchangeRatesProxy, config.exchangeRatesSkipTLSVerify, getOutgoingUserAgent(), config.enableDebugLog);
    }

    public async getLatestExchangeRates(c: Context, uid: bigint, _currentConfig: Config): Promise<LatestExchangeRateResponse> {
        const prefix = 'common_http_exchange_rates_data_provider.GetLatestExchangeRates';
        const requests = this.dataSource.buildRequests();
        const exchangeRateResps: LatestExchangeRateResponse[] = [];

        for (let i = 0; i < requests.length; i++) {
            const req = requests[i] as HttpRequestDefinition;
            let response;

            try {
                response = await this.httpClient.request(req.url, {
                    method: req.method,
                    headers: req.headers,
                    body: req.body,
                    logHandler: body => log.debugf(c, `[${prefix}] response#${i} is ${body.toString('utf8')}`),
                });
            } catch (err) {
                log.errorf(c, `[${prefix}] failed to request latest exchange rate data for user "uid:${uid}", because ${(err as Error).message}`);
                throw errs.ErrFailedToRequestRemoteApi;
            }

            if (response.status !== 200) {
                log.errorf(c, `[${prefix}] failed to get latest exchange rate data response for user "uid:${uid}", because response code is ${response.status}`);
                throw errs.ErrFailedToRequestRemoteApi;
            }

            try {
                exchangeRateResps.push(this.dataSource.parse(c, response.body));
            } catch (err) {
                log.errorf(c, `[${prefix}] failed to parse response for user "uid:${uid}", because ${(err as Error).message}`);
                throw errs.or(err, errs.ErrFailedToRequestRemoteApi);
            }
        }

        const lastExchangeRateResponse = exchangeRateResps[exchangeRateResps.length - 1] as LatestExchangeRateResponse;
        const allExchangeRatesMap = new Map<string, string>();

        for (const exchangeRateResp of exchangeRateResps) {
            for (const exchangeRate of exchangeRateResp.exchangeRates) {
                allExchangeRatesMap.set(exchangeRate.currency, exchangeRate.rate);
            }
        }

        allExchangeRatesMap.set(lastExchangeRateResponse.baseCurrency, '1');

        const allExchangeRates: LatestExchangeRate[] = [];

        for (const [currency, rate] of allExchangeRatesMap) {
            allExchangeRates.push({ currency: currency, rate: rate });
        }

        return {
            dataSource: lastExchangeRateResponse.dataSource,
            referenceUrl: lastExchangeRateResponse.referenceUrl,
            updateTime: lastExchangeRateResponse.updateTime,
            baseCurrency: lastExchangeRateResponse.baseCurrency,
            exchangeRates: sortExchangeRates(allExchangeRates),
        };
    }
}

// UserCustomExchangeRatesDataProvider returns the exchange rates which are defined by user
class UserCustomExchangeRatesDataProvider implements ExchangeRatesDataProvider {
    public async getLatestExchangeRates(c: Context, uid: bigint, _currentConfig: Config): Promise<LatestExchangeRateResponse> {
        const prefix = 'user_custom_data_provider.GetLatestExchangeRates';
        let user;

        try {
            user = await Users.getUserById(c, uid);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to get user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        let customExchangeRates;

        try {
            customExchangeRates = await UserCustomExchangeRates.getAllCustomExchangeRatesByUid(c, uid);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to get user custom exchange rates for user "uid:${uid}", because ${(err as Error).message}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        let baseCurrencyRate = 0;
        let hasDefaultCurrencyRate = false;

        for (const customExchangeRate of customExchangeRates) {
            if (customExchangeRate.currency === user.defaultCurrency) {
                baseCurrencyRate = customExchangeRate.rate;
                hasDefaultCurrencyRate = true;
                break;
            }
        }

        let allExchangeRates: LatestExchangeRate[] = [];
        let latestUpdateTime = 0;

        for (const customExchangeRate of customExchangeRates) {
            if (!isValidCurrency(customExchangeRate.currency)) {
                continue;
            }

            if (customExchangeRate.updatedUnixTime > latestUpdateTime) {
                latestUpdateTime = customExchangeRate.updatedUnixTime;
            }

            if (hasDefaultCurrencyRate && baseCurrencyRate > 0) {
                allExchangeRates.push(toLatestExchangeRate(customExchangeRate, baseCurrencyRate));
            }
        }

        allExchangeRates = sortExchangeRates(allExchangeRates);

        if (latestUpdateTime < 1) {
            latestUpdateTime = Math.floor(Date.now() / 1000);
        }

        if (!hasDefaultCurrencyRate) {
            allExchangeRates.push({ currency: user.defaultCurrency, rate: '1' });
        }

        return {
            dataSource: 'user_custom',
            referenceUrl: '',
            updateTime: latestUpdateTime,
            baseCurrency: user.defaultCurrency,
            exchangeRates: allExchangeRates,
        };
    }
}

class ExchangeRatesDataProviderContainer {
    public current: ExchangeRatesDataProvider | null = null;

    // getLatestExchangeRates returns the latest exchange rates data by the current exchange rates data provider
    public async getLatestExchangeRates(c: Context, uid: bigint, currentConfig: Config): Promise<LatestExchangeRateResponse> {
        if (!this.current) {
            throw errs.ErrInvalidExchangeRatesDataSource;
        }

        return this.current.getLatestExchangeRates(c, uid, currentConfig);
    }
}

export const Container = new ExchangeRatesDataProviderContainer();

// initializeExchangeRatesDataSource initializes the current exchange rates data source according to the config
export function initializeExchangeRatesDataSource(config: Config): void {
    const dataSources: Record<string, () => HttpExchangeRatesDataSource> = {
        [CentralBankOfArgentinaDataSource]: () => new CentralBankOfArgentinaExchangeRatesDataSource(),
        [BankOfCanadaDataSource]: () => new BankOfCanadaExchangeRatesDataSource(),
        [CzechNationalBankDataSource]: () => new CzechNationalBankExchangeRatesDataSource(),
        [DanmarksNationalbankDataSource]: () => new DanmarksNationalbankExchangeRatesDataSource(),
        [EuroCentralBankDataSource]: () => new EuroCentralBankExchangeRatesDataSource(),
        [NationalBankOfGeorgiaDataSource]: () => new NationalBankOfGeorgiaExchangeRatesDataSource(),
        [CentralBankOfHungaryDataSource]: () => new CentralBankOfHungaryExchangeRatesDataSource(),
        [BankOfIsraelDataSource]: () => new BankOfIsraelExchangeRatesDataSource(),
        [NationalBankOfKazakhstanDataSource]: () => new NationalBankOfKazakhstanExchangeRatesDataSource(),
        [CentralBankOfMyanmarDataSource]: () => new CentralBankOfMyanmarExchangeRatesDataSource(),
        [NorgesBankDataSource]: () => new NorgesBankExchangeRatesDataSource(),
        [NationalBankOfPolandDataSource]: () => new NationalBankOfPolandExchangeRatesDataSource(),
        [NationalBankOfRomaniaDataSource]: () => new NationalBankOfRomaniaExchangeRatesDataSource(),
        [BankOfRussiaDataSource]: () => new BankOfRussiaExchangeRatesDataSource(),
        [SwissNationalBankDataSource]: () => new SwissNationalBankExchangeRatesDataSource(),
        [NationalBankOfUkraineDataSource]: () => new NationalBankOfUkraineExchangeRatesDataSource(),
        [CentralBankOfUzbekistanDataSource]: () => new CentralBankOfUzbekistanExchangeRatesDataSource(),
    };

    if (config.exchangeRatesDataSource === UserCustomExchangeRatesDataSource) {
        Container.current = new UserCustomExchangeRatesDataProvider();
        return;
    }

    const factory = dataSources[config.exchangeRatesDataSource];

    if (!factory) {
        throw errs.ErrInvalidExchangeRatesDataSource;
    }

    Container.current = new CommonHttpExchangeRatesDataProvider(config, factory());
}

import { isIPv4, isIPv6 } from 'node:net';
import { crc32 } from 'node:zlib';

import * as errs from '../errs/index';
import * as log from '../log/index';
import { type Config, SCHEME_SOCKET } from '../settings/settings';
import { getLocalIPAddressesString } from '../utils/network';

const requestIdLength = 36;
const secondsTodayBits = 17;
const secondsTodayBitsMask = (1 << secondsTodayBits) - 1;
const clientPortNumberAllBits = 16;
const clientPortNumberHigh1Bit = 1;
const clientPortNumberLow15Bits = clientPortNumberAllBits - clientPortNumberHigh1Bit;
const clientPortNumberHigh1BitMask = 1 << clientPortNumberLow15Bits;
const clientPortNumberLow15BitsMask = clientPortNumberHigh1BitMask - 1;
const reqSeqNumberBits = 30;
const reqSeqNumberBitsMask = (1 << reqSeqNumberBits) - 1;
const clientIpv6Bit = 1;
const clientIpv6BitMask = 1;

export interface RequestIdInfo {
    serverUniqId: number;
    instanceUniqId: number;
    secondsElapsedToday: number;
    requestSeqId: number;
    isClientIpv6: boolean;
    clientIp: number;
    clientPort: number;
}

export interface RequestIdGenerator {
    generateRequestId(clientIpAddr: string, clientPort: number): string;
    getCurrentServerUniqId(): number;
    getCurrentInstanceUniqId(): number;
}

function crc32IEEE(data: string): number {
    return crc32(Buffer.from(data)) >>> 0;
}

// normalizeIPv6 expands and re-compresses ipv6 address like go net.IP.String()
function canonicalIPv6(ip: string): string {
    try {
        return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, '');
    } catch {
        return ip;
    }
}

function parseIPv4(ip: string): number | null {
    let address = ip;

    if (isIPv6(ip)) {
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);

        if (!mapped) {
            return null;
        }

        address = mapped[1]!;
    }

    if (!isIPv4(address)) {
        return null;
    }

    const octets = address.split('.').map(o => parseInt(o, 10));
    return (((octets[0]! << 24) >>> 0) + (octets[1]! << 16) + (octets[2]! << 8) + octets[3]!) >>> 0;
}

// DefaultRequestIdGenerator represents default request id generator
export class DefaultRequestIdGenerator implements RequestIdGenerator {
    private readonly serverUniqId: number;
    private readonly instanceUniqId: number;
    private requestSeqId: number = 0;

    public constructor(serverUniqId: number, instanceUniqId: number) {
        this.serverUniqId = serverUniqId;
        this.instanceUniqId = instanceUniqId;
    }

    public static create(c: log.LogContext | null, config: Config): DefaultRequestIdGenerator {
        return new DefaultRequestIdGenerator(getServerUniqId(c, config), getInstanceUniqId(config));
    }

    public parseRequestIdInfo(requestId: string): RequestIdInfo {
        if (requestId === '' || requestId.length !== requestIdLength) {
            throw errs.ErrRequestIdInvalid;
        }

        const hex = requestId.substring(0, 8) + requestId.substring(9, 13) + requestId.substring(14, 18) + requestId.substring(19, 23) + requestId.substring(24);
        const data = Buffer.from(hex, 'hex');

        const serverUniqId = data.readUInt16BE(0);
        const instanceUniqId = data.readUInt16BE(2);
        const secondsAndClientPortLowBits = data.readUInt32BE(4);
        const seqIdAndClientPortHighBitAndClientIpv6Flag = data.readUInt32BE(8);
        const clientIp = data.readUInt32BE(12);

        const secondsElapsedToday = (secondsAndClientPortLowBits >>> clientPortNumberLow15Bits) & secondsTodayBitsMask;
        const seqId = (seqIdAndClientPortHighBitAndClientIpv6Flag >>> (clientPortNumberHigh1Bit + clientIpv6Bit)) & reqSeqNumberBitsMask;
        const clientPortHigh1Bit = ((seqIdAndClientPortHighBitAndClientIpv6Flag >>> clientIpv6Bit) << clientPortNumberLow15Bits) & clientPortNumberHigh1BitMask;
        const isClientIpv6Flag = seqIdAndClientPortHighBitAndClientIpv6Flag & clientIpv6BitMask;
        const clientPort = (clientPortHigh1Bit | (secondsAndClientPortLowBits & clientPortNumberLow15BitsMask)) & 0xFFFF;

        return {
            serverUniqId: serverUniqId,
            instanceUniqId: instanceUniqId,
            secondsElapsedToday: secondsElapsedToday,
            requestSeqId: seqId,
            isClientIpv6: isClientIpv6Flag === 1,
            clientIp: clientIp,
            clientPort: clientPort,
        };
    }

    public getCurrentServerUniqId(): number {
        return this.serverUniqId;
    }

    public getCurrentInstanceUniqId(): number {
        return this.instanceUniqId;
    }

    public generateRequestId(clientIpAddr: string, clientPort: number): string {
        const ipv4 = parseIPv4(clientIpAddr);
        const isClientIpv6 = ipv4 === null;
        let clientIp: number;

        if (isClientIpv6) {
            clientIp = crc32IEEE(isIPv6(clientIpAddr) ? canonicalIPv6(clientIpAddr) : '<nil>');
        } else {
            clientIp = ipv4;
        }

        return this.getRequestId(this.serverUniqId, this.instanceUniqId, isClientIpv6, clientIp, clientPort);
    }

    private getRequestId(serverUniqId: number, instanceUniqId: number, clientIpV6: boolean, clientIp: number, clientPort: number): string {
        const clientIpv6Flag = clientIpV6 ? 1 : 0;

        const secondsElapsedToday = this.getSecondsElapsedToday();
        const secondsLow17bits = secondsElapsedToday & secondsTodayBitsMask;

        const clientPortHigh1bit = (clientPort & clientPortNumberHigh1BitMask) >>> clientPortNumberLow15Bits;
        const clientPortLow15bits = clientPort & clientPortNumberLow15BitsMask;

        const secondsAndClientPortLowBits = ((secondsLow17bits << clientPortNumberLow15Bits) | clientPortLow15bits) >>> 0;

        this.requestSeqId = (this.requestSeqId + 1) >>> 0;
        const seqIdLow30bits = this.requestSeqId & reqSeqNumberBitsMask;

        const seqIdAndClientPortHighBitAndClientIpv6Flag = ((seqIdLow30bits << (clientPortNumberHigh1Bit + clientIpv6Bit)) | (clientPortHigh1bit << clientPortNumberHigh1Bit) | (clientIpv6Flag & clientIpv6BitMask)) >>> 0;

        const buf = Buffer.alloc(16);
        buf.writeUInt16BE(serverUniqId & 0xFFFF, 0);
        buf.writeUInt16BE(instanceUniqId & 0xFFFF, 2);
        buf.writeUInt32BE(secondsAndClientPortLowBits, 4);
        buf.writeUInt32BE(seqIdAndClientPortHighBitAndClientIpv6Flag, 8);
        buf.writeUInt32BE(clientIp >>> 0, 12);

        const hex = buf.toString('hex');
        return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
    }

    private getSecondsElapsedToday(): number {
        const now = new Date();
        return now.getHours() * 60 * 60 + now.getMinutes() * 60 + now.getSeconds();
    }
}

function getServerUniqId(c: log.LogContext | null, config: Config): number {
    let localAddr = '';
    const settingAddr = config.httpAddr;

    if ((isIPv4(settingAddr) && settingAddr !== '0.0.0.0') || (isIPv6(settingAddr) && canonicalIPv6(settingAddr) !== '::')) {
        localAddr = isIPv6(settingAddr) ? canonicalIPv6(settingAddr) : settingAddr;
    } else {
        try {
            localAddr = getLocalIPAddressesString();
        } catch (err) {
            log.warnf(c, `[default_request_id_generator.getServerUniqId] failed to get local ipv4 address, because ${(err as Error).message}`);
            throw err;
        }
    }

    return crc32IEEE(`${localAddr}_${config.secretKey}`) & 0xFFFF;
}

function getInstanceUniqId(config: Config): number {
    let instanceUniqFlag: string;

    if (config.protocol === SCHEME_SOCKET) {
        instanceUniqFlag = `${config.unixSocketPath}_${config.secretKey}`;
    } else {
        instanceUniqFlag = `${config.httpPort}_${config.secretKey}`;
    }

    return crc32IEEE(instanceUniqFlag) & 0xFFFF;
}

// RequestIdContainer contains the current request id generator
class RequestIdContainer {
    public current: DefaultRequestIdGenerator | null = null;

    public generateRequestId(clientIpAddr: string, clientPort: number): string {
        if (!this.current) {
            return '';
        }

        return this.current.generateRequestId(clientIpAddr, clientPort);
    }

    public getCurrentServerUniqId(): number {
        return this.current?.getCurrentServerUniqId() ?? 0;
    }

    public getCurrentInstanceUniqId(): number {
        return this.current?.getCurrentInstanceUniqId() ?? 0;
    }
}

export const Container = new RequestIdContainer();

export function initializeRequestIdGenerator(c: log.LogContext | null, config: Config): void {
    Container.current = DefaultRequestIdGenerator.create(c, config);
}

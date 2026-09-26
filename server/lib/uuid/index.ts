import * as errs from '../errs/index';
import { type Config, InternalUuidGeneratorType } from '../settings/settings';

export type UuidType = number;

export const UUID_TYPE_DEFAULT = 0;
export const UUID_TYPE_USER = 1;
export const UUID_TYPE_ACCOUNT = 2;
export const UUID_TYPE_TRANSACTION = 3;
export const UUID_TYPE_CATEGORY = 4;
export const UUID_TYPE_TAG = 5;
export const UUID_TYPE_TAG_INDEX = 6;
export const UUID_TYPE_TEMPLATE = 7;
export const UUID_TYPE_PICTURE = 8;
export const UUID_TYPE_EXPLORER = 9;
export const UUID_TYPE_TAG_GROUP = 10;
export const UUID_TYPE_CUSTOM_ICON = 11;

const internalUuidUnixTimeBits = 32n;
const internalUuidUnixTimeMask = (1n << internalUuidUnixTimeBits) - 1n;
const internalUuidTypeBits = 4n;
const internalUuidTypeMask = (1n << internalUuidTypeBits) - 1n;
const internalUuidServerIdBits = 8n;
const internalUuidServerIdMask = (1n << internalUuidServerIdBits) - 1n;
const internalUuidSeqIdBits = 19n;
const internalUuidSeqIdMask = (1n << internalUuidSeqIdBits) - 1n;
const seqNumberIdBits = 32n;
const seqNumberIdMask = (1n << seqNumberIdBits) - 1n;

export interface InternalUuidInfo {
    unixTime: number;
    uuidType: number;
    uuidServerId: number;
    sequentialId: number;
}

export interface UuidGenerator {
    generateUuid(uuidType: UuidType): bigint;
    generateUuids(uuidType: UuidType, count: number): bigint[] | null;
}

// InternalUuidGenerator represents internal bundled uuid generator
// uuid layout (63 bits): unix time (32 bits) | uuid type (4 bits) | server id (8 bits) | sequential id (19 bits)
export class InternalUuidGenerator implements UuidGenerator {
    private readonly uuidSeqNumbers: bigint[] = new Array<bigint>(1 << Number(internalUuidTypeBits)).fill(0n);
    private readonly uuidServerId: number;

    public constructor(config: Config) {
        this.uuidServerId = config.uuidServerId;
    }

    public generateUuid(idType: UuidType): bigint {
        const uuids = this.generateUuids(idType, 1);

        if (!uuids || uuids.length < 1) {
            return 0n;
        }

        return uuids[0]!;
    }

    public generateUuids(idType: UuidType, count: number): bigint[] | null {
        const uuids: bigint[] = [];

        if (count < 1) {
            return uuids;
        }

        const uuidType = idType & 0xFF;
        const bigCount = BigInt(count);
        const unixTime = BigInt(Math.floor(Date.now() / 1000));
        let newFirstSeqId: bigint;

        const newLastSeqId = this.uuidSeqNumbers[uuidType]! + bigCount;
        const newSeqUnixTime = newLastSeqId >> seqNumberIdBits;

        if (unixTime <= newSeqUnixTime) {
            // same second (or clock moved backwards), continue with current sequence
            this.uuidSeqNumbers[uuidType] = newLastSeqId;
            newFirstSeqId = newLastSeqId - (bigCount - 1n);
        } else {
            newFirstSeqId = unixTime << seqNumberIdBits;
            this.uuidSeqNumbers[uuidType] = newFirstSeqId + (bigCount - 1n);
        }

        const assembleUnixTime = unixTime <= newSeqUnixTime ? newSeqUnixTime : unixTime;

        for (let i = 0n; i < bigCount; i++) {
            const seqId = (newFirstSeqId + i) & seqNumberIdMask;

            if (seqId > internalUuidSeqIdMask) {
                return null;
            }

            uuids.push(this.assembleUuid(assembleUnixTime, BigInt(uuidType), seqId));
        }

        return uuids;
    }

    public parseInternalUuidInfo(uuid: bigint): InternalUuidInfo {
        const seqId = uuid & internalUuidSeqIdMask;
        uuid = uuid >> internalUuidSeqIdBits;

        const uuidServerId = uuid & internalUuidServerIdMask;
        uuid = uuid >> internalUuidServerIdBits;

        const uuidType = uuid & internalUuidTypeMask;
        uuid = uuid >> internalUuidTypeBits;

        const unixTime = uuid & internalUuidUnixTimeMask;

        return {
            unixTime: Number(unixTime),
            uuidType: Number(uuidType),
            uuidServerId: Number(uuidServerId),
            sequentialId: Number(seqId),
        };
    }

    private assembleUuid(unixTime: bigint, uuidType: bigint, seqId: bigint): bigint {
        const unixTimePart = (unixTime & internalUuidUnixTimeMask) << (internalUuidTypeBits + internalUuidServerIdBits + internalUuidSeqIdBits);
        const uuidTypePart = (uuidType & internalUuidTypeMask) << (internalUuidServerIdBits + internalUuidSeqIdBits);
        const uuidServerIdPart = (BigInt(this.uuidServerId) & internalUuidServerIdMask) << internalUuidSeqIdBits;
        const seqIdPart = seqId & internalUuidSeqIdMask;

        return BigInt.asIntN(64, unixTimePart | uuidTypePart | uuidServerIdPart | seqIdPart);
    }
}

// UuidContainer contains the current uuid generator
class UuidContainer {
    public current: UuidGenerator | null = null;

    public generateUuid(uuidType: UuidType): bigint {
        if (!this.current) {
            return 0n;
        }

        return this.current.generateUuid(uuidType);
    }

    public generateUuids(uuidType: UuidType, count: number): bigint[] | null {
        if (!this.current) {
            return null;
        }

        return this.current.generateUuids(uuidType, count);
    }
}

export const Container = new UuidContainer();

export function initializeUuidGenerator(config: Config): void {
    if (config.uuidGeneratorType === InternalUuidGeneratorType) {
        Container.current = new InternalUuidGenerator(config);
        return;
    }

    throw errs.ErrInvalidUuidMode;
}

import { crc32 } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImageConfig {
    width: number;
    height: number;
}

// decodeImageConfig emulates go image.DecodeConfig with only png decoder registered, returns [config, format]
export function decodeImageConfig(data: Buffer): [ImageConfig, string] {
    if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('image: unknown format');
    }

    if (data.length < 8 + 8 + 13 + 4) {
        throw new Error('unexpected EOF');
    }

    const length = data.readUInt32BE(8);
    const type = data.subarray(12, 16).toString('latin1');

    if (type !== 'IHDR') {
        throw new Error('png: invalid format: chunk out of order');
    }

    if (length !== 13) {
        throw new Error('png: invalid format: bad IHDR length');
    }

    const chunkCrc = data.readUInt32BE(16 + 13);

    if (crc32(data.subarray(12, 16 + 13)) !== chunkCrc) {
        throw new Error('png: invalid format: invalid checksum');
    }

    const width = data.readInt32BE(16);
    const height = data.readInt32BE(20);
    const bitDepth = data[24] as number;
    const colorType = data[25] as number;

    if (data[26] !== 0) {
        throw new Error('png: unsupported feature: compression method');
    }

    if (data[27] !== 0) {
        throw new Error('png: unsupported feature: filter method');
    }

    if (data[28] !== 0 && data[28] !== 1) {
        throw new Error('png: invalid format: invalid interlace method');
    }

    if (width <= 0 || height <= 0) {
        throw new Error('png: invalid format: non-positive dimension');
    }

    const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
    };

    if (!validDepths[colorType]?.includes(bitDepth)) {
        throw new Error(`png: unsupported feature: bit depth ${bitDepth}, color type ${colorType}`);
    }

    return [{ width, height }, 'png'];
}

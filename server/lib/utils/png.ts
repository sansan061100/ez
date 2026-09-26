import { crc32, deflateSync } from 'node:zlib';

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

function pngChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
}

// encodeGrayPng encodes the 8-bit grayscale pixels to png image
export function encodeGrayPng(width: number, height: number, pixels: Uint8Array): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 0; // color type: grayscale
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const raw = Buffer.alloc((width + 1) * height);

    for (let y = 0; y < height; y++) {
        raw[y * (width + 1)] = 0;
        raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

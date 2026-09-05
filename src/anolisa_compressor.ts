/**
 * ANOLISA Token-less Context Compression Framework
 * Treats context as Information Architecture [Dan Olsen, Ch. 8].
 * Strips low-value 'Solution Space' noise while preserving 'Problem Space' signal.
 */

// Noise keys representing redundant 'Solution Space' metadata
export const NOISE_KEYS = [
  'debug',
  'trace',
  'verbose_metadata',
  'stack',
  'debug_dump',
  'raw_html',
  'verbose_logs',
  'connection_stats'
];

export interface CompressedResponseResult {
  compressed: any;
  hydrationMap: Map<string, any>;
  originalBytes: number;
  compressedBytes: number;
  reductionPercentage: number;
}

/**
 * Strips low-value Solution Space noise into <<tokenless:KEY>> markers.
 * Delivers Kano 'Performance' benefit by reducing token spend without data loss.
 */
export function compressResponse(
  payload: any,
  noiseKeys: string[] = NOISE_KEYS
): CompressedResponseResult {
  const hydrationMap = new Map<string, any>();
  const originalJson = JSON.stringify(payload);
  const originalBytes = Buffer.byteLength(originalJson, 'utf-8');

  const compressed = JSON.parse(
    JSON.stringify(payload, (key, value) => {
      if (noiseKeys.includes(key) && value !== null && value !== undefined) {
        const token = `<<tokenless:${key}>>`; // Performance Benefit [Kano]
        hydrationMap.set(token, value);
        return token;
      }
      return value;
    })
  );

  const compressedJson = JSON.stringify(compressed);
  const compressedBytes = Buffer.byteLength(compressedJson, 'utf-8');
  const reductionPercentage =
    originalBytes > 0
      ? Number((((originalBytes - compressedBytes) / originalBytes) * 100).toFixed(2))
      : 0;

  return {
    compressed,
    hydrationMap,
    originalBytes,
    compressedBytes,
    reductionPercentage,
  };
}

/**
 * Reversibly hydrates <<tokenless:KEY>> tokens back to original Solution Space data.
 */
export function hydrateResponse(compressedPayload: any, hydrationMap: Map<string, any>): any {
  return JSON.parse(
    JSON.stringify(compressedPayload, (key, value) => {
      if (typeof value === 'string' && value.startsWith('<<tokenless:') && value.endsWith('>>')) {
        if (hydrationMap.has(value)) {
          return hydrationMap.get(value);
        }
      }
      return value;
    })
  );
}

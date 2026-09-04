import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface CompressionOptions {
  maxDescriptionLength?: number;
  stripDebugFields?: boolean;
  stashThresholdBytes?: number;
  stashDirectory?: string;
}

export interface CompressionMetrics {
  originalBytes: number;
  compressedBytes: number;
  reductionPercentage: number;
  stashedCount: number;
  stashedKeys: string[];
}

export interface CompressionResult<T = any> {
  compressed: T;
  metrics: CompressionMetrics;
}

export class TokenCompressor {
  private readonly stashDir: string;
  private readonly maxDescriptionLength: number;
  private readonly stripDebugFields: boolean;
  private readonly stashThresholdBytes: number;
  private readonly blacklistKeys: Set<string>;

  constructor(options?: CompressionOptions) {
    this.maxDescriptionLength = options?.maxDescriptionLength ?? 120;
    this.stripDebugFields = options?.stripDebugFields ?? true;
    this.stashThresholdBytes = options?.stashThresholdBytes ?? 512;

    const baseDir = options?.stashDirectory ?? path.join(process.cwd(), '.aeos', 'stash');
    this.stashDir = path.resolve(baseDir);

    if (!fs.existsSync(this.stashDir)) {
      fs.mkdirSync(this.stashDir, { recursive: true });
    }

    this.blacklistKeys = new Set([
      'trace_id',
      'span_id',
      'telemetry',
      'debug_stack',
      'stack_trace',
      'execution_metadata',
      'raw_logs',
      'environment_vars',
      'system_diagnostics'
    ]);
  }

  /**
   * Stage 1: Schema Minification
   * Strips non-essential schema descriptors, collapses whitespace, and truncates descriptions.
   */
  public compressSchema(schema: Record<string, any>): Record<string, any> {
    const cloned = JSON.parse(JSON.stringify(schema));

    const traverse = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        node.forEach(traverse);
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'title' || key === 'examples' || key === 'default' || key === '$comment') {
          delete node[key];
        } else if (key === 'description' && typeof node[key] === 'string') {
          let desc = node[key]
            .replace(/`[^`]*`/g, '')        // Strip inline code blocks
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Strip markdown links
            .replace(/\s+/g, ' ')           // Collapse redundant whitespace
            .trim();

          if (desc.length > this.maxDescriptionLength) {
            desc = desc.slice(0, this.maxDescriptionLength).trim() + '...';
          }
          node[key] = desc;
        } else {
          traverse(node[key]);
        }
      }
    };

    traverse(cloned);
    return cloned;
  }

  /**
   * Stage 2 & 3: Response Cleaning & Content-Addressed Tokenless Stashing
   * Recursively sanitizes diagnostic fields, prunes empty branches, and stashes oversized payloads.
   */
  public compressResponse<T = any>(payload: T): CompressionResult<T> {
    const rawJson = JSON.stringify(payload);
    const originalBytes = Buffer.byteLength(rawJson, 'utf-8');
    const stashedKeys: string[] = [];

    const processNode = (node: any): any => {
      if (node === null || node === undefined) return undefined;

      // Check for large strings that qualify for stashing
      if (typeof node === 'string') {
        const byteLen = Buffer.byteLength(node, 'utf-8');
        if (byteLen >= this.stashThresholdBytes) {
          const hash = crypto.createHash('sha256').update(node, 'utf-8').digest('hex').slice(0, 16);
          const stashFilePath = path.join(this.stashDir, `${hash}.bin`);
          fs.writeFileSync(stashFilePath, node, 'utf-8');
          stashedKeys.push(hash);
          return `<<tokenless:${hash}>>`;
        }
        return node;
      }

      // Arrays: filter out undefined and empty pruned values
      if (Array.isArray(node)) {
        const processedArray = node
          .map(processNode)
          .filter((item) => item !== undefined);
        return processedArray.length > 0 ? processedArray : undefined;
      }

      // Objects: filter blacklisted keys, nulls, and empty structures
      if (typeof node === 'object') {
        const cleanedObj: Record<string, any> = {};

        for (const [key, value] of Object.entries(node)) {
          if (this.stripDebugFields && this.blacklistKeys.has(key.toLowerCase())) {
            continue;
          }

          const processedVal = processNode(value);
          if (
            processedVal !== undefined &&
            processedVal !== '' &&
            !(typeof processedVal === 'object' && Object.keys(processedVal).length === 0)
          ) {
            cleanedObj[key] = processedVal;
          }
        }

        return Object.keys(cleanedObj).length > 0 ? cleanedObj : undefined;
      }

      return node;
    };

    const compressed = (processNode(payload) ?? {}) as T;
    const compressedBytes = Buffer.byteLength(JSON.stringify(compressed), 'utf-8');
    const reductionPercentage = originalBytes > 0
      ? Number((((originalBytes - compressedBytes) / originalBytes) * 100).toFixed(2))
      : 0;

    return {
      compressed,
      metrics: {
        originalBytes,
        compressedBytes,
        reductionPercentage,
        stashedCount: stashedKeys.length,
        stashedKeys
      }
    };
  }

  /**
   * Reconstitution: Losslessly resolves all `<<tokenless:HASH>>` tags back to original text.
   */
  public reconstitute(input: string): string {
    const tokenlessRegex = /"?<<tokenless:([a-f0-9]{16})>>"?/g;

    return input.replace(tokenlessRegex, (match, hash) => {
      const filePath = path.join(this.stashDir, `${hash}.bin`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (match.startsWith('"') && match.endsWith('"')) {
          return JSON.stringify(content);
        }
        return content;
      }
      return match;
    });
  }

  /**
   * Stash Inspection: Reads a single stashed chunk by hash.
   */
  public retrieveChunk(hash: string): string | null {
    const filePath = path.join(this.stashDir, `${hash}.bin`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return null;
  }

  public getStashDirectory(): string {
    return this.stashDir;
  }
}
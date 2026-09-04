#!/usr/bin/env tsx
import * as fs from 'fs';
import { TokenCompressor } from './token_compressor.js';

function runCli() {
  const args = process.argv.slice(2);
  const compressor = new TokenCompressor();

  if (args.includes('--reconstitute') && args[1]) {
    const input = fs.readFileSync(args[1], 'utf-8');
    process.stdout.write(compressor.reconstitute(input));
    process.exit(0);
  }

  const filePath = args[0];
  if (!filePath) {
    console.error('Usage: tsx src/aeos_compress.ts <payload.json> [--schema | --reconstitute]');
    process.exit(1);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(rawData);

  if (args.includes('--schema')) {
    const result = compressor.compressSchema(parsed);
    console.log(JSON.stringify(result, null, 2));
  } else {
    const { compressed, metrics } = compressor.compressResponse(parsed);
    console.log(JSON.stringify(compressed, null, 2));
    console.error('\n--- Compression Metrics ---');
    console.error(`Original: ${metrics.originalBytes} bytes`);
    console.error(`Compressed: ${metrics.compressedBytes} bytes`);
    console.error(`Reduction: ${metrics.reductionPercentage}%`);
    console.error(`Stashed Chunks: ${metrics.stashedCount} (${metrics.stashedKeys.join(', ')})`);
  }
}

runCli();
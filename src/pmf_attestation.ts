import * as crypto from 'crypto';
import * as fs from 'fs';

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Prevents 'Inside-Out' development by ensuring the execution 
 * has not drifted from the original Problem Space definition.
 * [Dan Olsen, The Lean Product Playbook, Ch. 2]
 */
export function verifyPmfAlignment(filePath: string, expectedHash: string): boolean {
  if (!fs.existsSync(filePath)) {
    throw new CircuitBreakerError(`Plan specification file not found: ${filePath}`);
  }

  const fileBytes = fs.readFileSync(filePath);
  const actualHash = crypto.createHash('sha256').update(fileBytes).digest('hex');

  if (actualHash !== expectedHash) {
    // Triggering the Circuit Breaker to prevent Rework [Olsen, Ch. 1]
    throw new CircuitBreakerError(
      `Architectural Drift Detected: Plan integrity compromised. Expected ${expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`
    );
  }

  return true;
}

export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

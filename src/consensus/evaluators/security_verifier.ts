import { BaseEvaluator } from './base_evaluator.js';
import { Proposal, PerspectiveRole, DeliberationContext } from '../types.js';

export interface SecurityRule {
  id: string;
  name: string;
  dimension:
    | 'injection_vulnerability'
    | 'auth_boundary_integrity'
    | 'input_sanitization'
    | 'sandbox_containment';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  pattern: RegExp;
  description: string;
  remediation: string;
}

export const SECURITY_RULES: SecurityRule[] = [
  // 1. SQL Injection
  {
    id: 'SEC-SQLI-001',
    name: 'Raw String Concatenation in SQL Query',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /(?:query|execute)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*\)/i,
    description:
      'Detected template literal string interpolation in SQL query statement. This allows SQL injection.',
    remediation:
      'Use parameterized SQL queries with bind parameters ($1, $2, ...) instead of template strings.',
  },
  {
    id: 'SEC-SQLI-002',
    name: 'String Concatenation in SQL Query',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /(?:query|execute)\s*\(\s*(?:'[^']*'|"[^"]*")\s*\+\s*[a-zA-Z0-9_.]+/i,
    description:
      'Detected direct string concatenation (+) in SQL query statement. High risk of SQL injection.',
    remediation:
      'Replace string concatenation with parameterized query arguments ($1, $2, ...).',
  },

  // 2. Command Injection & Arbitrary Code Execution
  {
    id: 'SEC-RCE-001',
    name: 'Arbitrary Code Execution via eval()',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /\beval\s*\(/i,
    description:
      'Usage of eval() permits arbitrary code execution and sandbox compromise.',
    remediation:
      'Remove eval(). Use structured JSON parsers or static lookup tables.',
  },
  {
    id: 'SEC-RCE-002',
    name: 'Unsafe Function Constructor Execution',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /\bnew\s+Function\s*\(/i,
    description:
      'Dynamic code execution via Function constructor introduces arbitrary execution risk.',
    remediation:
      'Refactor dynamic code execution into static, type-safe functions.',
  },
  {
    id: 'SEC-RCE-003',
    name: 'Unsanitized Shell Command Execution',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /(?:child_process|cp)\.(?:exec|execSync)\s*\(\s*`[^`]*\$\{/i,
    description:
      'Detected variable interpolation inside child_process shell execution command.',
    remediation:
      'Use child_process.execFile() or spawn() with explicit, sanitized argument arrays without shell interpolation.',
  },

  // 3. Path Traversal
  {
    id: 'SEC-TRAV-001',
    name: 'Unsanitized Path Traversal Pattern',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /(?:path\.join|path\.resolve|fs\.read|fs\.write)[^;]*\.\.[\/\\]/i,
    description:
      'Relative parent directory sequence (../) in filesystem operations allows path traversal out of workspace.',
    remediation:
      'Normalize paths using path.resolve() and verify the target path starts with the designated root directory.',
  },

  // 4. Prototype Pollution
  {
    id: 'SEC-PROTO-001',
    name: 'Direct Prototype Modification',
    dimension: 'injection_vulnerability',
    severity: 'CRITICAL',
    pattern: /(?:__proto__|constructor\s*\.\s*prototype|Object\.prototype)\s*\[/i,
    description:
      'Direct property assignment on prototype allows prototype pollution across global context.',
    remediation:
      'Use Object.create(null) or Map for dictionary lookups, or sanitize property keys.',
  },

  // 5. Cryptographic Timing Attack (Auth Boundary)
  {
    id: 'SEC-TIME-001',
    name: 'Non-Constant-Time Signature/Secret Comparison',
    dimension: 'auth_boundary_integrity',
    severity: 'CRITICAL',
    pattern: /(?:signature|expected|token|hash|secret|mac|sig|exp)\s*[!=]==?\s*(?:signature|expected|token|hash|secret|mac|sig|exp)/i,
    description:
      'Using standard equality operator (===) to verify cryptographic signatures introduces timing attack vulnerabilities.',
    remediation:
      'Use crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")) for constant-time verification.',
  },

  // 6. Hardcoded Secrets
  {
    id: 'SEC-CRED-001',
    name: 'Hardcoded High-Entropy Secret or Password',
    dimension: 'auth_boundary_integrity',
    severity: 'CRITICAL',
    pattern: /(?:api_key|password|jwt_secret|private_key)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i,
    description:
      'Hardcoded credentials found in source code.',
    remediation:
      'Extract secrets to environment variables (process.env) or secure vault.',
  },

  // 7. Weak Cryptography
  {
    id: 'SEC-WEAK-001',
    name: 'Insecure Hash Algorithm in Security Context',
    dimension: 'auth_boundary_integrity',
    severity: 'MAJOR',
    pattern: /crypto\.createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    description:
      'MD5 and SHA-1 are cryptographically broken and must not be used for security attestations or tokens.',
    remediation:
      'Upgrade to crypto.createHash("sha256") or sha512.',
  },

  // 8. Sandbox Containment Breach
  {
    id: 'SEC-SAND-001',
    name: 'Unauthorized Host Socket or Device Access',
    dimension: 'sandbox_containment',
    severity: 'CRITICAL',
    pattern: /\/(?:var\/run\/docker\.sock|proc\/|sys\/|etc\/shadow|etc\/passwd)/i,
    description:
      'Attempt to interact with host socket or sensitive kernel device paths.',
    remediation:
      'Restrict filesystem interactions strictly to the configured workspace.',
  },
];

export class SecurityVerifierEvaluator extends BaseEvaluator {
  public readonly role: PerspectiveRole = 'security_verification';
  public readonly weight: number = 0.35;
  public readonly agentId: string;

  constructor(options?: {
    agentId?: string;
    weight?: number;
    hmacSecret?: string;
  }) {
    super(options);
    this.agentId = options?.agentId || 'evaluator-security-01';
    if (options?.weight !== undefined) {
      this.weight = options.weight;
    }
  }

  protected override getApprovalThreshold(): number {
    return 70.0;
  }

  protected async doEvaluate(
    proposal: Proposal,
    context?: DeliberationContext
  ): Promise<{
    score: number;
    dimensionScores: Record<string, number>;
    criticalFlaws: string[];
    recommendations: string[];
    rationale?: string;
  }> {
    const dimensionScores: Record<string, number> = {
      injection_vulnerability: 100,
      auth_boundary_integrity: 100,
      input_sanitization: 100,
      sandbox_containment: 100,
    };
    const criticalFlaws: string[] = [];
    const recommendations: string[] = [];

    const content = proposal.content || '';

    // Evaluate static security rules
    for (const rule of SECURITY_RULES) {
      if (rule.pattern.test(content)) {
        if (rule.severity === 'CRITICAL') {
          dimensionScores[rule.dimension] = Math.min(
            dimensionScores[rule.dimension],
            40
          );
          criticalFlaws.push(`[${rule.id}] ${rule.name}: ${rule.description}`);
          recommendations.push(`Fix [${rule.id}]: ${rule.remediation}`);
        } else if (rule.severity === 'MAJOR') {
          dimensionScores[rule.dimension] -= 25;
          recommendations.push(`Remediate [${rule.id}]: ${rule.remediation}`);
        } else {
          dimensionScores[rule.dimension] -= 10;
        }
      }
    }

    // Additional specific checks for auth boundary and tokens
    if (
      proposal.type === 'code_verification' &&
      /token|auth|jwt/i.test(proposal.title + ' ' + proposal.content)
    ) {
      if (!/exp|expiresIn/i.test(content)) {
        dimensionScores.auth_boundary_integrity -= 30;
        recommendations.push(
          'Include explicit token expiration (exp / expiresIn) verification to prevent replay attacks.'
        );
      }
      if (!/revok|blacklist|invalidation/i.test(content)) {
        dimensionScores.auth_boundary_integrity -= 15;
        recommendations.push(
          'Implement token revocation or session invalidation support.'
        );
      }
    }

    // Input sanitization checks
    if (/req\.body|req\.query|req\.params|input/i.test(content)) {
      if (!/typeof|instanceof|zod|joi|sanitize|validate|schema/i.test(content)) {
        dimensionScores.input_sanitization -= 20;
        recommendations.push(
          'Add explicit input validation or schema parsing for user-controlled request fields.'
        );
      }
    }

    // Clamp dimension scores
    for (const key of Object.keys(dimensionScores)) {
      dimensionScores[key] = this.clampScore(dimensionScores[key]);
    }

    // Compute raw weighted security score
    let score = this.clampScore(
      dimensionScores.injection_vulnerability * 0.30 +
        dimensionScores.auth_boundary_integrity * 0.25 +
        dimensionScores.input_sanitization * 0.25 +
        dimensionScores.sandbox_containment * 0.20
    );

    // STRICT SECURITY VETO:
    // Any critical flaw caps the security score to at most 50.0 to guarantee rejection
    if (criticalFlaws.length > 0) {
      score = Math.min(score, 50.0);
    }

    return {
      score,
      dimensionScores,
      criticalFlaws,
      recommendations,
      rationale:
        criticalFlaws.length > 0
          ? `STRICT SECURITY VETO: ${criticalFlaws.length} critical vulnerability finding(s): ${criticalFlaws.join('; ')}`
          : `Security verification passed with score ${score.toFixed(2)}/100. No critical vulnerabilities identified.`,
    };
  }
}

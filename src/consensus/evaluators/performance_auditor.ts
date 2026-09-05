import { BaseEvaluator } from './base_evaluator.js';
import { Proposal, PerspectiveRole, DeliberationContext } from '../types.js';

export class PerformanceAuditorEvaluator extends BaseEvaluator {
  public readonly role: PerspectiveRole = 'performance_audit';
  public readonly weight: number = 0.20;
  public readonly agentId: string;

  constructor(options?: {
    agentId?: string;
    weight?: number;
    hmacSecret?: string;
  }) {
    super(options);
    this.agentId = options?.agentId || 'evaluator-performance-01';
    if (options?.weight !== undefined) {
      this.weight = options.weight;
    }
  }

  protected override getApprovalThreshold(): number {
    return 75.0;
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
      algorithmic_complexity: 100,
      memory_efficiency: 100,
      latency_impact: 100,
      resource_lifecycle: 100,
    };
    const criticalFlaws: string[] = [];
    const recommendations: string[] = [];

    const content = proposal.content || '';

    // 1. Catastrophic ReDoS Check (Exponential backtracking)
    const redosPattern = /(\([^)]*[+*]\)[+*]|\/(?:[^\/\\]|\\.)*\+\+\/)/;
    if (redosPattern.test(content)) {
      dimensionScores.algorithmic_complexity -= 50;
      criticalFlaws.push(
        'PERF_CRIT_REDOS: Nested quantifier in regular expression causes exponential backtracking.'
      );
      recommendations.push(
        'Refactor regular expressions to eliminate nested quantifiers (e.g. (a+)+ or ([a-zA-Z0-9]+)+$).'
      );
    }

    // 2. Loop Nesting Depth Audit
    const nestedLoopPattern =
      /(?:for|while)\s*\([^)]*\)\s*\{[^}]*(?:for|while)\s*\([^)]*\)\s*\{[^}]*(?:for|while)/s;
    if (nestedLoopPattern.test(content)) {
      dimensionScores.algorithmic_complexity -= 35;
      recommendations.push(
        'Detected 3-level nested loops (O(N^3) complexity). Refactor with map lookups or inverted indexing.'
      );
    }

    // 3. Synchronous Blocking I/O in Hot / Async Paths
    if (
      /fs\.readFileSync|fs\.writeFileSync|child_process\.execSync/.test(content)
    ) {
      if (/async|promise|callback|request|handler|server/i.test(content)) {
        dimensionScores.latency_impact -= 30;
        recommendations.push(
          'Replace synchronous blocking I/O (fs.readFileSync/writeFileSync) with async fs.promises in execution paths.'
        );
      }
    }

    // 4. Unbounded Collection Memory Growth
    if (
      /(?:new\s+Map|new\s+Set|\[\])[^;]*\.(?:push|set|add)\(/i.test(content)
    ) {
      if (
        !/delete|clear|splice|pop|shift|filter|ttl|windowMs|maxSize|evict/i.test(
          content
        )
      ) {
        dimensionScores.memory_efficiency -= 35;
        recommendations.push(
          'In-memory collection grows without eviction. Add TTL, max size bounds, or LRU pruning to prevent OOM.'
        );
      }
    }

    // 5. Connection / Handle Lifecycle
    if (
      /pool\.connect\(\)/.test(content) &&
      !/client\.release\(\)/.test(content)
    ) {
      dimensionScores.resource_lifecycle -= 40;
      criticalFlaws.push(
        'PERF_CRIT_DB_LEAK: Database connection acquired from pool without guaranteed client.release().'
      );
      recommendations.push(
        'Wrap pool.connect() in try ... finally { client.release(); } to prevent pool starvation.'
      );
    }

    if (
      /createReadStream|createWriteStream|net\.createServer|new\s+WebSocket/.test(
        content
      ) &&
      !/close|destroy|end/.test(content)
    ) {
      dimensionScores.resource_lifecycle -= 25;
      recommendations.push(
        'Ensure open sockets, streams, or listeners have corresponding close/destroy lifecycle cleanup.'
      );
    }

    // Clamp dimension scores
    for (const key of Object.keys(dimensionScores)) {
      dimensionScores[key] = this.clampScore(dimensionScores[key]);
    }

    const score = this.clampScore(
      dimensionScores.algorithmic_complexity * 0.30 +
        dimensionScores.memory_efficiency * 0.25 +
        dimensionScores.latency_impact * 0.25 +
        dimensionScores.resource_lifecycle * 0.20
    );

    return {
      score,
      dimensionScores,
      criticalFlaws,
      recommendations,
      rationale:
        criticalFlaws.length > 0
          ? `Performance audit failed with critical flaw(s): ${criticalFlaws.join('; ')}`
          : `Performance efficiency audited at ${score.toFixed(2)}/100 across complexity, memory, latency, and lifecycle.`,
    };
  }
}

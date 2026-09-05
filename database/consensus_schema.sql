-- ============================================================================
-- AEOS Multi-Agent Consensus Council Schema
-- File: database/consensus_schema.sql
-- Subsystem: Consensus Council & Cryptographic Deliberation Ledger
-- PostgreSQL 15 Compatible DDL
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Council Proposals
-- Stores all task plans, code verification artifacts, and architecture RFCs
-- submitted to the multi-agent consensus council.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS council_proposals (
    id VARCHAR(128) PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    proposal_code VARCHAR(100),
    proposal_type VARCHAR(50) NOT NULL, -- 'task_plan', 'code_verification', 'architecture_rfc', 'security_audit'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author VARCHAR(100) NOT NULL DEFAULT 'unknown',
    metadata JSONB,
    proposal_hash CHAR(64) NOT NULL,    -- Deterministic SHA-256 of canonical proposal payload
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'deliberating', 'approved', 'rejected', 'deadlocked'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- ----------------------------------------------------------------------------
-- 2. Deliberation Rounds
-- Records quorum votes, composite weighted scores, and debate transcripts
-- across iterative refinement cycles and fallback arbitration rounds.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS council_rounds (
    id VARCHAR(128) PRIMARY KEY,
    proposal_id VARCHAR(128) NOT NULL REFERENCES council_proposals(id) ON DELETE CASCADE,
    round_number INT NOT NULL DEFAULT 1,
    quorum_threshold NUMERIC(4, 2) NOT NULL DEFAULT 0.75, -- 75% approval threshold required
    total_eligible_voters INT NOT NULL DEFAULT 4,
    votes_approve INT NOT NULL DEFAULT 0,
    votes_reject INT NOT NULL DEFAULT 0,
    votes_abstain INT NOT NULL DEFAULT 0,
    weighted_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    quorum_achieved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'APPROVED', 'REJECTED', 'DEADLOCK', 'arbitration'
    transcript JSONB NOT NULL DEFAULT '{}', -- Complete serialized debate transcript & metrics
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 3. Council Critiques
-- Detailed analytical reviews submitted by individual perspective evaluators
-- (Strategic Planning, Security Verification, Performance Audit, Software Architecture)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS council_critiques (
    id VARCHAR(128) PRIMARY KEY,
    round_id VARCHAR(128) NOT NULL REFERENCES council_rounds(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    perspective_role VARCHAR(100) NOT NULL, -- 'strategic_planning', 'security_verification', 'performance_audit', 'software_architecture'
    vote VARCHAR(20) NOT NULL DEFAULT 'APPROVE', -- 'APPROVE', 'REJECT', 'ABSTAIN'
    score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,  -- 0.00 to 100.00
    confidence_score NUMERIC(4, 2) DEFAULT 1.00, -- 0.00 to 1.00
    dimension_scores JSONB NOT NULL DEFAULT '{}',
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    critique_statement TEXT,
    critical_flaws JSONB DEFAULT '[]',
    recommendations JSONB DEFAULT '[]',
    is_dissenting BOOLEAN NOT NULL DEFAULT FALSE,
    dissent_rationale TEXT,
    signature CHAR(64) NOT NULL, -- HMAC-SHA256 of critique content + proposal hash
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 4. Consensus Certificates
-- Immutable cryptographic certificates issued upon reaching council quorum,
-- sealed with deterministic HMAC-SHA256 signatures and Merkle link chaining.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consensus_certificates (
    certificate_id VARCHAR(128) PRIMARY KEY,
    proposal_id VARCHAR(128) NOT NULL REFERENCES council_proposals(id) ON DELETE CASCADE,
    round_id VARCHAR(128) REFERENCES council_rounds(id) ON DELETE CASCADE,
    decision VARCHAR(50) NOT NULL, -- 'APPROVED', 'REJECTED', 'CONSENSUS_APPROVED', 'CONSENSUS_REJECTED'
    composite_score NUMERIC(5, 2) NOT NULL,
    quorum_achieved BOOLEAN NOT NULL DEFAULT TRUE,
    quorum_ratio NUMERIC(4, 2) DEFAULT 1.00,
    dimension_averages JSONB DEFAULT '{}',
    participating_agents JSONB DEFAULT '[]',
    dissenting_agent_count INT NOT NULL DEFAULT 0,
    summary_recommendation TEXT,
    remediation_instructions JSONB,
    transcript_hash CHAR(64) NOT NULL, -- SHA-256 of deliberation transcript
    previous_certificate_hash CHAR(64), -- Merkle-style hash link to previous certificate
    certificate_signature CHAR(64) NOT NULL, -- HMAC-SHA256 sealing certificate data
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- Indexes for High-Throughput Relational Auditing & Telemetry
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_council_prop_status ON council_proposals(status);
CREATE INDEX IF NOT EXISTS idx_council_prop_hash ON council_proposals(proposal_hash);
CREATE INDEX IF NOT EXISTS idx_council_prop_type ON council_proposals(proposal_type);
CREATE INDEX IF NOT EXISTS idx_council_rounds_prop ON council_rounds(proposal_id);
CREATE INDEX IF NOT EXISTS idx_council_rounds_status ON council_rounds(resolution_status);
CREATE INDEX IF NOT EXISTS idx_council_critiques_round ON council_critiques(round_id);
CREATE INDEX IF NOT EXISTS idx_council_critiques_role ON council_critiques(perspective_role);
CREATE INDEX IF NOT EXISTS idx_council_critiques_approved ON council_critiques(approved);
CREATE INDEX IF NOT EXISTS idx_council_cert_prop ON consensus_certificates(proposal_id);
CREATE INDEX IF NOT EXISTS idx_council_cert_sig ON consensus_certificates(certificate_signature);
CREATE INDEX IF NOT EXISTS idx_council_cert_decision ON consensus_certificates(decision);

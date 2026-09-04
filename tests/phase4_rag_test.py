#!/usr/bin/env python3
"""
Phase 4 Verification Suite: Offline Token-Zero Semantic Ingestion & Hybrid Retrieval
"""

import os
import sys
import time
import json
import psycopg2
from pypdf import PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import io

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Add src to sys.path
SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, SRC_DIR)

from ingest_engine import SemanticIngestEngine
from rag_tool import execute_search

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
TEST_PDF_PATH = os.path.join(FIXTURE_DIR, "kernel_spec.pdf")
DB_CONN = "postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel"


def generate_synthetic_pdf():
    os.makedirs(FIXTURE_DIR, exist_ok=True)
    packet = io.BytesIO()
    can = canvas.Canvas(packet, pagesize=letter)
    
    can.drawString(50, 750, "AEOS KERNEL ARCHITECTURAL SPECIFICATION - REVISION 2.4")
    can.drawString(50, 730, "Process control blocks govern preemptive time slicing and memory isolation.")
    can.drawString(50, 715, "To avoid resource starvation, priority queues enforce round-robin scheduling.")
    
    can.drawString(50, 680, "```typescript")
    can.drawString(50, 665, "export interface SandboxConfig {")
    can.drawString(50, 650, "    Memory: 1073741824;")
    can.drawString(50, 635, "    NanoCpus: 1000000000;")
    can.drawString(50, 620, "    NetworkMode: 'none';")
    can.drawString(50, 605, "}")
    can.drawString(50, 590, "```")

    can.drawString(50, 550, "| Parameter | Allocation | Isolation Mode |")
    can.drawString(50, 535, "| RAM_CAP | 1024 MB | Hard Cgroup |")
    can.drawString(50, 520, "| CPU_SHARE | 1.0 Core | CFS Quota |")
    
    can.showPage()
    can.save()
    packet.seek(0)

    with open(TEST_PDF_PATH, "wb") as f:
        f.write(packet.read())
    print(f"✓ Synthetic fixture PDF created: {TEST_PDF_PATH}")


def run_phase4_suite():
    print("=== STARTING PHASE 4 VERIFICATION TEST SUITE ===\n")
    
    # 1. Setup fixture
    generate_synthetic_pdf()

    # 2. Ingestion Test
    print("\n[TEST 1] Testing Document Ingestion & Structural Chunking...")
    engine = SemanticIngestEngine()
    chunk_count = engine.ingest_file(TEST_PDF_PATH)
    print(f"✓ Successfully extracted and indexed {chunk_count} chunks.")
    assert chunk_count >= 2, f"Expected at least 2 chunks, got {chunk_count}"

    # Verify structural chunk extraction
    structural_chunks = [c for c in engine.chunks_cache if c["source"] == "kernel_spec.pdf" and c["is_code_or_table"]]
    print(f"✓ Structural chunks identified (code blocks or tables): {len(structural_chunks)}")
    assert len(structural_chunks) >= 1, "Failed to preserve code block or table as structural chunk."

    # 3. Hybrid Search - Semantic Query
    print("\n[TEST 2] Testing Semantic Concept Retrieval...")
    semantic_query = "How is agent scheduling prevented from starving?"
    start_t = time.time()
    sem_hits = engine.hybrid_search(semantic_query, top_k=3)
    sem_latency = (time.time() - start_t) * 1000
    print(f"✓ Semantic Query: '{semantic_query}' completed in {sem_latency:.2f}ms")
    assert len(sem_hits) > 0, "Semantic search returned zero hits."
    print(f"✓ Top semantic hit (RRF: {sem_hits[0]['rrf_score']}):\n  {sem_hits[0]['text'][:100]}...")
    assert "starvation" in sem_hits[0]["text"].lower() or "scheduling" in sem_hits[0]["text"].lower()

    # 4. Hybrid Search - Exact Symbol Matching (BM25 Precision)
    print("\n[TEST 3] Testing Exact Symbol Syntax Matching (BM25 Precision)...")
    exact_query = "NanoCpus: 1000000000"
    start_t = time.time()
    exact_hits = engine.hybrid_search(exact_query, top_k=3)
    exact_latency = (time.time() - start_t) * 1000
    print(f"✓ Exact Symbol Query: '{exact_query}' completed in {exact_latency:.2f}ms")
    assert len(exact_hits) > 0, "Exact search returned zero hits."
    print(f"✓ Top exact hit (RRF: {exact_hits[0]['rrf_score']}):\n  {exact_hits[0]['text'][:100]}...")
    assert "NanoCpus" in exact_hits[0]["text"]

    # 5. RAG Tool Execution & PostgreSQL Telemetry Audit
    print("\n[TEST 4] Testing Tool Execution Logging into PostgreSQL...")
    raw_output = execute_search("RAM_CAP 1024 MB", top_k=2)
    parsed = json.loads(raw_output)
    assert parsed["results_count"] > 0, "RAG tool returned 0 results."
    print("✓ Tool executed successfully. Checking database record...")

    conn = psycopg2.connect(DB_CONN)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT tool_name, input_payload, output_payload, duration_ms, created_at 
        FROM tool_executions 
        WHERE tool_name = 'hybrid_rag_search' 
        ORDER BY created_at DESC 
        LIMIT 1;
        """
    )
    db_row = cur.fetchone()
    assert db_row is not None, "Failed to locate logged tool execution in database."
    print("✓ Tool execution ledger row verified in PostgreSQL:")
    print(f"  Tool: {db_row[0]}")
    print(f"  Duration: {db_row[3]}ms")
    print(f"  Input: {db_row[1]}")
    print(f"  Output Count: {db_row[2]['results_count']}")
    cur.close()
    conn.close()

    print("\n========================================")
    print("PHASE 4 VERIFICATION COMPLETE: SUCCESS")
    print("========================================")


if __name__ == "__main__":
    try:
        run_phase4_suite()
    except Exception as e:
        sys.stderr.write(f"\n✗ Phase 4 Verification Failed: {e}\n")
        import traceback
        traceback.print_exc()
        sys.exit(1)
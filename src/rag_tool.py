#!/usr/bin/env python3
"""
AEOS RAG Tool with PostgreSQL Telemetry Tracking
"""

import sys
import time
import json
import argparse
import psycopg2
from ingest_engine import SemanticIngestEngine

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

DB_CONN = "postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel"


def log_tool_execution(tool_name: str, input_payload: dict, output_payload: dict, duration_ms: int):
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Find the latest turn ID
        cur.execute("SELECT id FROM agent_turns ORDER BY created_at DESC LIMIT 1;")
        row = cur.fetchone()
        if row:
            turn_id = row[0]
            cur.execute(
                """
                INSERT INTO tool_executions (turn_id, tool_name, input_payload, output_payload, is_error, duration_ms)
                VALUES (%s, %s, %s, %s, %s, %s);
                """,
                (turn_id, tool_name, json.dumps(input_payload), json.dumps(output_payload), False, duration_ms)
            )
            conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        sys.stderr.write(f"[WARN] Failed to log tool telemetry to PostgreSQL: {e}\n")


def execute_search(query: str, top_k: int = 5) -> str:
    start_time = time.time()
    engine = SemanticIngestEngine()
    results = engine.hybrid_search(query, top_k=top_k)
    duration_ms = int((time.time() - start_time) * 1000)

    input_data = {"query": query, "top_k": top_k}
    output_data = {"results_count": len(results), "hits": results}

    log_tool_execution("hybrid_rag_search", input_data, output_data, duration_ms)
    return json.dumps(output_data, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEOS RAG Tool Runner")
    parser.add_argument("query", type=str, help="Search query")
    parser.add_argument("--top-k", type=int, default=3, help="Max results")
    args = parser.parse_args()

    output = execute_search(args.query, args.top_k)
    print(output)
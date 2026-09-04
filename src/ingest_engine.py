#!/usr/bin/env python3
"""
AEOS Offline Token-Zero Semantic Ingestion & Hybrid RAG Engine
Local Dense (BAAI/bge-large-en-v1.5 via Qdrant) + Sparse (BM25Okapi) with RRF
"""

import os
import sys
import re
import json
import uuid
import argparse
from typing import List, Dict, Any, Tuple
from pypdf import PdfReader
from rank_bm25 import BM25Okapi
import torch
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


class SemanticIngestEngine:
    def __init__(
        self,
        collection_name: str = "aeos_knowledge",
        qdrant_host: str = "localhost",
        qdrant_port: int = 6333,
        corpus_cache_path: str = None
    ):
        self.collection_name = collection_name
        self.corpus_cache_path = corpus_cache_path or os.path.join(
            os.getcwd(), ".aeos", "bm25_corpus.json"
        )
        
        # Determine optimal compute device
        if torch.cuda.is_available():
            self.device = "cuda"
        elif torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"

        # Load local embedding model
        self.encoder = SentenceTransformer("BAAI/bge-large-en-v1.5", device=self.device)
        self.vector_dim = self.encoder.get_sentence_embedding_dimension()
        
        # Connect to local Qdrant
        self.qdrant = QdrantClient(host=qdrant_host, port=qdrant_port)
        self.chunks_cache: List[Dict[str, Any]] = []
        self.bm25: BM25Okapi = None

        self._initialize_collection()
        self._load_cached_corpus()

    def _initialize_collection(self) -> None:
        collections = self.qdrant.get_collections().collections
        exists = any(c.name == self.collection_name for c in collections)
        if not exists:
            self.qdrant.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=self.vector_dim, distance=Distance.COSINE)
            )

    def _load_cached_corpus(self) -> None:
        if os.path.exists(self.corpus_cache_path):
            try:
                with open(self.corpus_cache_path, "r", encoding="utf-8") as f:
                    self.chunks_cache = json.load(f)
                if self.chunks_cache:
                    tokenized_corpus = [
                        re.findall(r"\w+", c["text"].lower()) for c in self.chunks_cache
                    ]
                    self.bm25 = BM25Okapi(tokenized_corpus)
            except Exception:
                self.chunks_cache = []
                self.bm25 = None

    def _save_cached_corpus(self) -> None:
        os.makedirs(os.path.dirname(self.corpus_cache_path), exist_ok=True)
        with open(self.corpus_cache_path, "w", encoding="utf-8") as f:
            json.dump(self.chunks_cache, f, indent=2)

    def extract_structural_chunks(
        self, text: str, source_name: str, chunk_size: int = 500, overlap: int = 50
    ) -> List[Dict[str, Any]]:
        # Regex to capture atomic code blocks and markdown tables
        pattern = r"(\n```[\s\S]*?```\n|\n\|[^\n]+\|\n(?:\|[^\n]+\|\n)*)"
        segments = re.split(pattern, text)
        chunks: List[Dict[str, Any]] = []

        for seg in segments:
            clean_seg = seg.strip()
            if not clean_seg:
                continue

            # Check if segment is an atomic code block or markdown table
            if clean_seg.startswith("```") or clean_seg.startswith("|"):
                chunks.append({
                    "id": str(uuid.uuid4()),
                    "text": clean_seg,
                    "source": source_name,
                    "is_code_or_table": True
                })
            else:
                # Sliding window chunking on narrative prose
                start = 0
                while start < len(clean_seg):
                    end = min(start + chunk_size, len(clean_seg))
                    if end < len(clean_seg) and not clean_seg[end].isspace():
                        space_offset = clean_seg[end : min(end + 50, len(clean_seg))].find(" ")
                        if space_offset != -1:
                            end += space_offset
                    
                    chunk_text = clean_seg[start:end].strip()
                    if chunk_text:
                        chunks.append({
                            "id": str(uuid.uuid4()),
                            "text": chunk_text,
                            "source": source_name,
                            "is_code_or_table": False
                        })
                    start += chunk_size - overlap

        return chunks

    def ingest_file(self, file_path: str) -> int:
        source_name = os.path.basename(file_path)
        full_text = ""

        if file_path.lower().endswith(".pdf"):
            reader = PdfReader(file_path)
            for page_idx, page in enumerate(reader.pages):
                page_str = page.extract_text() or ""
                full_text += f"\n<!-- Page {page_idx + 1} -->\n" + page_str
        else:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                full_text = f.read()

        new_chunks = self.extract_structural_chunks(full_text, source_name)
        if not new_chunks:
            return 0

        # Compute dense embeddings
        texts = [c["text"] for c in new_chunks]
        embeddings = self.encoder.encode(
            texts, show_progress_bar=False, normalize_embeddings=True, device=self.device
        )

        # Upsert into Qdrant
        points = []
        for idx, chunk in enumerate(new_chunks):
            points.append(
                PointStruct(
                    id=chunk["id"],
                    vector=embeddings[idx].tolist(),
                    payload={
                        "text": chunk["text"],
                        "source": chunk["source"],
                        "structural": chunk["is_code_or_table"]
                    }
                )
            )

        self.qdrant.upsert(collection_name=self.collection_name, points=points)

        # Update local chunk cache and BM25 index
        self.chunks_cache.extend(new_chunks)
        self._save_cached_corpus()

        tokenized_corpus = [
            re.findall(r"\w+", c["text"].lower()) for c in self.chunks_cache
        ]
        self.bm25 = BM25Okapi(tokenized_corpus)

        return len(new_chunks)

    def hybrid_search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        # 1. Dense Semantic Retrieval
        query_vector = self.encoder.encode(
            query, normalize_embeddings=True, device=self.device
        ).tolist()
        
        if hasattr(self.qdrant, "query_points"):
            res = self.qdrant.query_points(
                collection_name=self.collection_name,
                query=query_vector,
                limit=top_k * 3
            )
            vector_hits = res.points
        else:
            vector_hits = self.qdrant.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                limit=top_k * 3
            )

        dense_ranks: Dict[str, int] = {}
        for idx, hit in enumerate(vector_hits):
            text_key = hit.payload.get("text", "")
            if text_key not in dense_ranks:
                dense_ranks[text_key] = idx + 1

        # 2. Sparse Lexical Retrieval (BM25)
        sparse_ranks: Dict[str, int] = {}
        if self.bm25 and self.chunks_cache:
            tokenized_query = re.findall(r"\w+", query.lower())
            bm25_scores = self.bm25.get_scores(tokenized_query)
            top_bm25_indices = sorted(
                range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True
            )[: top_k * 3]

            for rank, idx in enumerate(top_bm25_indices):
                if bm25_scores[idx] > 0.0:
                    text_key = self.chunks_cache[idx]["text"]
                    if text_key not in sparse_ranks:
                        sparse_ranks[text_key] = rank + 1

        # 3. Reciprocal Rank Fusion (RRF)
        all_candidates = set(dense_ranks.keys()).union(set(sparse_ranks.keys()))
        rrf_results: List[Tuple[str, float]] = []
        k_smoothing = 60

        for doc in all_candidates:
            score = 0.0
            if doc in dense_ranks:
                score += 0.5 * (1.0 / (k_smoothing + dense_ranks[doc]))
            if doc in sparse_ranks:
                score += 0.5 * (1.0 / (k_smoothing + sparse_ranks[doc]))
            rrf_results.append((doc, score))

        rrf_results.sort(key=lambda x: x[1], reverse=True)

        results: List[Dict[str, Any]] = []
        for doc_text, score in rrf_results[:top_k]:
            source_file = "unknown"
            is_struct = False
            for c in self.chunks_cache:
                if c["text"] == doc_text:
                    source_file = c["source"]
                    is_struct = c["is_code_or_table"]
                    break
            results.append({
                "text": doc_text,
                "rrf_score": round(score, 6),
                "source": source_file,
                "is_structural": is_struct
            })

        return results


def main():
    parser = argparse.ArgumentParser(description="AEOS Offline Token-Zero Semantic Ingestion CLI")
    parser.add_argument("--index", type=str, help="Path to PDF, Markdown, or text file to ingest")
    parser.add_argument("--query", type=str, help="Hybrid retrieval search query")
    parser.add_argument("--top-k", type=int, default=5, help="Number of results to retrieve")
    args = parser.parse_args()

    engine = SemanticIngestEngine()

    if args.index:
        count = engine.ingest_file(args.index)
        sys.stdout.write(f"Indexed {count} chunks into collection '{engine.collection_name}'.\n")
    elif args.query:
        results = engine.hybrid_search(args.query, top_k=args.top_k)
        sys.stdout.write(json.dumps(results, indent=2) + "\n")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
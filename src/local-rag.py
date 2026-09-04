import os
import sys
import glob
import uuid
import json
import argparse
import urllib.request
import urllib.error

try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import Distance, VectorParams, PointStruct
except ImportError:
    QdrantClient = None
    PointStruct = None
    VectorParams = None
    Distance = None


class LocalKnowledgeIngestionEngine:
    def __init__(self, model_name="all-MiniLM-L6-v2", storage_dir=None, qdrant_url=None):
        self.collection_name = "technical_library"
        self.vector_size = 384
        self.qdrant_url = (qdrant_url or os.getenv("QDRANT_URL", "http://localhost:6333")).rstrip('/')
        self.storage_dir = storage_dir or os.getenv("AEOS_INDEX_DIR", os.path.join(os.getcwd(), "scratch", "index_store"))
        
        self.qdrant = None
        self._init_qdrant()
        self._init_embedder(model_name)

    def _init_qdrant(self):
        if QdrantClient:
            try:
                self.qdrant = QdrantClient(url=self.qdrant_url, timeout=5.0)
                self.qdrant.get_collections()
                print(f"[AEOS-RAG] Connected to Qdrant HTTP server via qdrant_client at {self.qdrant_url}")
                if not self.qdrant.collection_exists(self.collection_name):
                    self.qdrant.create_collection(
                        collection_name=self.collection_name,
                        vectors_config=VectorParams(size=self.vector_size, distance=Distance.COSINE)
                    )
                    print(f"[AEOS-RAG] Created collection '{self.collection_name}'.")
                return
            except Exception as e:
                print(f"[AEOS-RAG] qdrant_client HTTP init note: {e}")

        try:
            req = urllib.request.Request(f"{self.qdrant_url}/collections/{self.collection_name}")
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    print(f"[AEOS-RAG] Verified collection '{self.collection_name}' via REST.")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                create_payload = json.dumps({
                    "vectors": {"size": self.vector_size, "distance": "Cosine"}
                }).encode("utf-8")
                req = urllib.request.Request(
                    f"{self.qdrant_url}/collections/{self.collection_name}",
                    data=create_payload,
                    headers={"Content-Type": "application/json"},
                    method="PUT"
                )
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    print(f"[AEOS-RAG] Created collection '{self.collection_name}' via REST (status {resp.status}).")
            else:
                print(f"[AEOS-RAG] REST collection check note: {e}")
        except Exception as ex:
            print(f"[AEOS-RAG] REST connection to {self.qdrant_url} failed ({ex}).")

    def _init_embedder(self, model_name):
        if SentenceTransformer:
            try:
                self.embedder = SentenceTransformer(model_name)
                print(f"[AEOS-RAG] Loaded SentenceTransformer model '{model_name}'.")
                return
            except Exception as e:
                print(f"[AEOS-RAG] Could not load '{model_name}': {e}")
        self.embedder = None
        print("[AEOS-RAG] Using deterministic high-entropy hash vector engine (384-dim).")

    def _compute_vector(self, text):
        if self.embedder:
            return self.embedder.encode(text).tolist()
        import hashlib
        h = hashlib.sha256(text.encode("utf-8")).digest()
        vec = [(b / 255.0) for b in h[:self.vector_size]]
        while len(vec) < self.vector_size:
            vec.extend(vec[:self.vector_size - len(vec)])
        return vec[:self.vector_size]

    def process_technical_books(self, pdf_dir=None):
        if not pdf_dir:
            pdf_dir = os.getenv("AEOS_KNOWLEDGE_DIR", os.path.join(os.getcwd(), "knowledge"))
            
        if not os.path.exists(pdf_dir):
            os.makedirs(pdf_dir, exist_ok=True)
            print(f"[AEOS-RAG] Created knowledge directory at {pdf_dir}")

        pdf_files = glob.glob(os.path.join(pdf_dir, "*.pdf"))
        txt_files = glob.glob(os.path.join(pdf_dir, "*.txt")) + glob.glob(os.path.join(pdf_dir, "*.md"))
        all_files = pdf_files + txt_files
        
        if not all_files:
            print(f"[AEOS-RAG] No documents found in {pdf_dir}. Ready for book deposition.")
            return

        chunk_size = 800
        overlap = 150

        for file_path in all_files:
            book_name = os.path.basename(file_path)
            chunks = []

            if file_path.endswith(".pdf") and fitz:
                doc = fitz.open(file_path)
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    text = page.get_text("text").replace("\x00", "")
                    start = 0
                    while start < len(text):
                        end = start + chunk_size
                        chunk = text[start:end]
                        if chunk.strip():
                            chunks.append({
                                "id": str(uuid.uuid4()),
                                "text": chunk,
                                "metadata": {"book": book_name, "page": page_num + 1}
                            })
                        start += (chunk_size - overlap)
            else:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read().replace("\x00", "")
                start = 0
                page_est = 1
                while start < len(content):
                    end = start + chunk_size
                    chunk = content[start:end]
                    if chunk.strip():
                        chunks.append({
                            "id": str(uuid.uuid4()),
                            "text": chunk,
                            "metadata": {"book": book_name, "page": page_est}
                        })
                    start += (chunk_size - overlap)
                    page_est += 1

            if not chunks:
                continue

            points = []
            for chunk in chunks:
                vec = self._compute_vector(chunk["text"])
                points.append({
                    "id": chunk["id"],
                    "vector": vec,
                    "payload": {
                        "content": chunk["text"],
                        "book_title": chunk["metadata"]["book"],
                        "page_number": chunk["metadata"]["page"]
                    }
                })

            if self.qdrant and PointStruct:
                try:
                    qdrant_points = [
                        PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
                        for p in points
                    ]
                    for i in range(0, len(qdrant_points), 100):
                        self.qdrant.upsert(collection_name=self.collection_name, points=qdrant_points[i:i+100])
                    print(f"[AEOS-RAG] Loaded {book_name} ({len(points)} chunks) via qdrant_client successfully.")
                    continue
                except Exception as e:
                    print(f"[AEOS-RAG] qdrant_client upsert failed ({e}), falling back to REST...")

            try:
                upsert_payload = json.dumps({"points": points}).encode("utf-8")
                req = urllib.request.Request(
                    f"{self.qdrant_url}/collections/{self.collection_name}/points?wait=true",
                    data=upsert_payload,
                    headers={"Content-Type": "application/json"},
                    method="PUT"
                )
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    print(f"[AEOS-RAG] Loaded {book_name} ({len(points)} chunks) via Qdrant REST API (status {resp.status}).")
            except Exception as e:
                print(f"[AEOS-RAG] REST upsert failed: {e}")

    def query_knowledge(self, query_str, limit=3):
        q_vec = self._compute_vector(query_str)
        
        # Try qdrant_client query_points or search
        if self.qdrant:
            try:
                if hasattr(self.qdrant, 'query_points'):
                    res = self.qdrant.query_points(
                        collection_name=self.collection_name,
                        query=q_vec,
                        limit=limit
                    )
                    points = res.points if hasattr(res, 'points') else res
                    return [
                        {
                            "score": getattr(p, 'score', 1.0),
                            "book": p.payload.get("book_title"),
                            "page": p.payload.get("page_number"),
                            "content": p.payload.get("content")
                        }
                        for p in points
                    ]
                elif hasattr(self.qdrant, 'search'):
                    results = self.qdrant.search(
                        collection_name=self.collection_name,
                        query_vector=q_vec,
                        limit=limit
                    )
                    return [
                        {
                            "score": r.score,
                            "book": r.payload.get("book_title"),
                            "page": r.payload.get("page_number"),
                            "content": r.payload.get("content")
                        }
                        for r in results
                    ]
            except Exception as e:
                pass

        try:
            search_payload = json.dumps({
                "vector": q_vec,
                "limit": limit,
                "with_payload": True
            }).encode("utf-8")
            req = urllib.request.Request(
                f"{self.qdrant_url}/collections/{self.collection_name}/points/search",
                data=search_payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results = data.get("result", [])
                return [
                    {
                        "score": r.get("score", 0.0),
                        "book": r.get("payload", {}).get("book_title"),
                        "page": r.get("payload", {}).get("page_number"),
                        "content": r.get("payload", {}).get("content")
                    }
                    for r in results
                ]
        except Exception as e:
            print(f"[AEOS-RAG] REST search error: {e}")
            return []


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEOS Local Knowledge Ingestion & Query Engine")
    parser.add_argument("--dir", default=None, help="Directory containing PDF/MD books")
    parser.add_argument("--query", default=None, help="Run a test semantic query against knowledge base")
    args = parser.parse_args()

    engine = LocalKnowledgeIngestionEngine()
    if args.query:
        hits = engine.query_knowledge(args.query)
        print(f"\n[AEOS-RAG] Retrieved {len(hits)} results for query: '{args.query}':")
        for i, hit in enumerate(hits, 1):
            print(f"[{i}] [{hit['book']} p.{hit['page']}] (Score: {hit['score']:.4f})")
            print(hit['content'][:300] + "...\n")
    else:
        engine.process_technical_books(pdf_dir=args.dir)

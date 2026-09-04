import os
import glob
import fitz  # PyMuPDF
import uuid
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

class LocalKnowledgeIngestionEngine:
    def __init__(self, model_name="all-MiniLM-L6-v2", storage_dir="/workspace/scratch/index_store"):
        self.embedder = SentenceTransformer(model_name)
        self.qdrant = QdrantClient(path=storage_dir)
        self.collection_name = "technical_library"
        
        if not self.qdrant.collection_exists(self.collection_name):
            self.qdrant.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )

    def process_technical_books(self, pdf_dir="/workspace/knowledge"):
        pdf_files = glob.glob(os.path.join(pdf_dir, "*.pdf"))
        for file_path in pdf_files:
            book_name = os.path.basename(file_path)
            doc = fitz.open(file_path)
            chunks = []
            chunk_size = 800
            overlap = 150
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text("text").replace("\x00", "")
                start = 0
                while start < len(text):
                    end = start + chunk_size
                    chunk = text[start:end]
                    chunks.append({
                        "id": str(uuid.uuid4()),
                        "text": chunk,
                        "metadata": {"book": book_name, "page": page_num + 1}
                    })
                    start += (chunk_size - overlap)
            
            texts_to_embed = [c["text"] for c in chunks]
            embeddings = self.embedder.encode(texts_to_embed, show_progress_bar=True, batch_size=32)
            
            points = []
            for idx, chunk in enumerate(chunks):
                points.append(
                    PointStruct(
                        id=chunk["id"],
                        vector=embeddings[idx].tolist(),
                        payload={
                            "content": chunk["text"],
                            "book_title": chunk["metadata"]["book"],
                            "page_number": chunk["metadata"]["page"]
                        }
                    )
                )
            
            for i in range(0, len(points), 100):
                self.qdrant.upsert(collection_name=self.collection_name, points=points[i:i+100])
            print(f"Loaded {book_name} successfully offline.")

if __name__ == "__main__":
    engine = LocalKnowledgeIngestionEngine()
    engine.process_technical_books()

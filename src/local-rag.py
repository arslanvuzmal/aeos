import os
import glob
import fitz  # PyMuPDF
import uuid
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

class GoogleDriveBookIndexer:
    def __init__(self, model_name="all-MiniLM-L6-v2", storage_dir=".planning/index_store"):
        print(f"Loading Local Offline Embedding Model ({model_name})...")
        self.embedder = SentenceTransformer(model_name)
        self.qdrant = QdrantClient(path=storage_dir)
        self.collection_name = "technical_library"
        
        if not self.qdrant.collection_exists(self.collection_name):
            self.qdrant.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE)
            )

    def index_google_drive_books(self, drive_path):
        pdf_files = glob.glob(os.path.join(drive_path, "**/*.pdf"), recursive=True)
        print(f"Found {len(pdf_files)} textbooks inside Drive directory. Commencing ingestion...")
        
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
            print(f"Loaded '{book_name}' into Local Vector Index successfully.")

if __name__ == "__main__":
    import sys
    drive_dir = sys.argv[1] if len(sys.argv) > 1 else "./gdrive_books"
    engine = GoogleDriveBookIndexer()
    engine.index_google_drive_books(drive_dir)

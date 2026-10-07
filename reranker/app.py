"""Local cross-encoder reranker service.

A small standalone service so the Node app keeps doing retrieval and a
separate model does the ranking. The cross-encoder reads (query, chunk)
together, which is a different mechanism than embedding similarity.

Run:
    python3 reranker/app.py

Environment:
    RERANKER_MODEL   default BAAI/bge-reranker-v2-m3 (multilingual)
    RERANKER_PORT    default 8080

API:
    GET  /health  -> {"status": "ok", "model": "..."}
    POST /rerank  {"query": str, "documents": [str]}
                  -> [{"index": int, "score": float}, ...]  (sorted, score in 0..1)
"""

import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from sentence_transformers import CrossEncoder

MODEL = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
PORT = int(os.environ.get("RERANKER_PORT", "8080"))

print(f"loading reranker model: {MODEL}", flush=True)
model = CrossEncoder(MODEL)
print("model ready", flush=True)


def sigmoid(value: float) -> float:
    if value < 0:
        z = math.exp(value)
        return z / (1 + z)
    return 1 / (1 + math.exp(-value))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/rerank":
            self._send(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
            query = data["query"]
            documents = data["documents"]
            if not isinstance(query, str) or not isinstance(documents, list):
                raise ValueError("query must be a string and documents a list")
        except Exception as error:  # noqa: BLE001
            self._send(400, {"error": f"bad request: {error}"})
            return

        try:
            pairs = [[query, str(document)] for document in documents]
            raw_scores = model.predict(pairs) if pairs else []
            results = [
                {"index": index, "score": float(sigmoid(float(score)))}
                for index, score in enumerate(raw_scores)
            ]
            results.sort(key=lambda item: item["score"], reverse=True)
            self._send(200, results)
        except Exception as error:  # noqa: BLE001
            self._send(500, {"error": str(error)})

    def log_message(self, *args: object) -> None:  # keep stdout clean
        return


if __name__ == "__main__":
    print(f"reranker listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

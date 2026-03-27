from __future__ import annotations

from pathlib import Path
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from planner import BASE_DIR, SIGNS_DATA_DIR, SLT_IMPORT_ERROR, build_sign_plan, slt


HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8001"))


class SignPlanRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    sign_language: str = Field(default="ASL")


app = FastAPI(title="SignFlow Sign Planner", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

media_root = Path(BASE_DIR) / "media"
signs_data_root = Path(SIGNS_DATA_DIR)
app.mount("/media", StaticFiles(directory=media_root), name="media")
app.mount("/signs-data", StaticFiles(directory=signs_data_root), name="signs-data")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "sign-planner",
        "media_root": str(media_root),
        "signs_data_root": str(signs_data_root),
        "slt_available": slt is not None,
        "slt_import_error": SLT_IMPORT_ERROR,
    }


@app.post("/api/sign-plan")
def sign_plan(payload: SignPlanRequest, request: Request) -> dict[str, object]:
    return build_sign_plan(payload.text, base_url=str(request.base_url).rstrip("/"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host=HOST, port=PORT, reload=False)

"""Entry point: python run.py  (binds 127.0.0.1:5175 only)."""
import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, log_level="info")

from fastapi import FastAPI

app = FastAPI(title="PitWall")


@app.get("/health")
def health():
    return {"status": "ok"}

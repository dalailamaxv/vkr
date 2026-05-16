import asyncio
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from main import generate_simli_video

GREETING_TEXT = "Привет! Я уже готов помочь. Задавай свой вопрос по сайту."
TARGET_RELATIVE = Path("../browser-extension-full-site/assets/intro/greeting.mp4")


async def run():
    print("🎬 Generating greeting video...")
    url = await generate_simli_video(GREETING_TEXT, "neutral")
    if not url:
        raise RuntimeError("Simli greeting video generation failed")

    prefix = "http://localhost:8000/videos/"
    if not url.startswith(prefix):
        raise RuntimeError(f"Unexpected video URL: {url}")

    filename = url[len(prefix):]
    src = Path("./tmp_videos") / filename
    if not src.exists():
        raise FileNotFoundError(f"Generated file not found: {src}")

    dst = (Path(__file__).resolve().parent / TARGET_RELATIVE).resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    print(f"✅ Saved greeting preset to: {dst}")


if __name__ == "__main__":
    asyncio.run(run())

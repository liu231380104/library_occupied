import os
import shutil
import time
import random
import subprocess
import argparse
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser(description="模拟采样脚本：定期拷贝图片或截取视频片段到模拟目录用于后端检测")
    p.add_argument("--mode", choices=["image", "video"], default="image")
    p.add_argument("--source-image-dir", default="python_scripts/results/")
    p.add_argument("--source-video-list", nargs="*", default=["v1.mp4", "v2.mp4"])
    p.add_argument("--target-dir", default="python_scripts/simulated_samples/")
    p.add_argument("--interval", type=int, default=60, help="采样间隔秒")
    p.add_argument("--video-duration", type=int, default=2, help="视频采样时长秒")
    p.add_argument("--ffmpeg", default=r"D:/ffmpeg/bin/ffmpeg.exe")
    p.add_argument("--once", action="store_true", help="只运行一次后退出")
    return p.parse_args()


def sample_image(source_dir: Path, target_dir: Path):
    imgs = [f for f in source_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")]
    if not imgs:
        print("[Image] No images found in", source_dir)
        return None
    chosen = random.choice(imgs)
    ts = time.strftime('%Y%m%d_%H%M%S')
    dst = target_dir / f"sample_{ts}{chosen.suffix}"
    shutil.copy(chosen, dst)
    print(f"[Image] Sampled: {dst}")
    return dst


def sample_video(source_list, target_dir: Path, duration: int, ffmpeg_path: str):
    # choose a video that exists
    candidates = [Path(v) for v in source_list if Path(v).exists()]
    if not candidates:
        print("[Video] No source videos found in provided list")
        return None
    video = random.choice(candidates)
    ts = time.strftime('%Y%m%d_%H%M%S')
    dst = target_dir / f"sample_{ts}.mp4"

    # try probing duration with cv2 if available
    start_time = 0
    try:
        import cv2
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        duration_total = (total_frames / fps) if fps > 0 else 0
        if duration_total > duration:
            start_time = random.uniform(0, max(0, duration_total - duration))
    except Exception:
        start_time = 0

    # use ffmpeg to cut segment; fall back to copying whole file if ffmpeg unavailable
    if Path(ffmpeg_path).exists():
        cmd = [ffmpeg_path, '-y', '-ss', str(start_time), '-i', str(video), '-t', str(duration), '-c', 'copy', str(dst)]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[Video] Sampled: {dst} (from {video}, start {start_time:.2f}s)")
            return dst
        except Exception as e:
            print("[Video] ffmpeg error, falling back to copy:", e)

    # fallback: copy original file (may be large)
    try:
        shutil.copy(video, dst)
        print(f"[Video] Fallback copied: {dst} (from {video})")
        return dst
    except Exception as e:
        print("[Video] copy fallback failed:", e)
        return None


def main():
    args = parse_args()
    mode = args.mode
    source_image_dir = Path(args.source_image_dir)
    source_video_list = args.source_video_list
    target_dir = Path(args.target_dir)
    interval = max(1, int(args.interval))
    video_duration = max(1, int(args.video_duration))
    ffmpeg_path = args.ffmpeg

    target_dir.mkdir(parents=True, exist_ok=True)

    def run_once():
        if mode == 'image':
            return sample_image(source_image_dir, target_dir)
        else:
            return sample_video(source_video_list, target_dir, video_duration, ffmpeg_path)

    if args.once:
        run_once()
        return

    while True:
        try:
            run_once()
        except Exception as e:
            print("[Simulate] error:", e)
        time.sleep(interval)


if __name__ == '__main__':
    main()

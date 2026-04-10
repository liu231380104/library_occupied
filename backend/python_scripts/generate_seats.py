import argparse
import json
import os
import cv2
from ultralytics import YOLO


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
MODEL_DIR = os.path.join(BACKEND_DIR, "modules")


def sort_seats(seats):
    # 先按行再按列排序，便于管理员查看和后续编号
    return sorted(seats, key=lambda b: ((b[1] + b[3]) // 2, (b[0] + b[2]) // 2))


def clamp_box(box, img_w, img_h):
    x1, y1, x2, y2 = box
    x1 = max(0, min(int(x1), img_w - 1))
    y1 = max(0, min(int(y1), img_h - 1))
    x2 = max(0, min(int(x2), img_w - 1))
    y2 = max(0, min(int(y2), img_h - 1))
    return [x1, y1, x2, y2]


def box_area(box):
    x1, y1, x2, y2 = box
    return max(0, x2 - x1) * max(0, y2 - y1)


def box_iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    iw = max(0, ix2 - ix1)
    ih = max(0, iy2 - iy1)
    inter = iw * ih
    union = box_area(a) + box_area(b) - inter
    if union <= 0:
        return 0.0
    return inter / union


def nms_with_scores(candidates, iou_thres=0.45):
    # candidates: [(box, score)]
    ordered = sorted(candidates, key=lambda x: x[1], reverse=True)
    kept = []
    for box, score in ordered:
        should_keep = True
        for kept_box, _ in kept:
            if box_iou(box, kept_box) >= iou_thres:
                should_keep = False
                break
        if should_keep:
            kept.append((box, score))
    return kept


def median(values):
    if not values:
        return 0
    vals = sorted(values)
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2


def filter_outlier_boxes(seats):
    # 依据候选框群体分布，去掉明显过小/过大/比例异常的框
    if len(seats) < 6:
        return seats

    widths = [max(1, s[2] - s[0]) for s in seats]
    heights = [max(1, s[3] - s[1]) for s in seats]
    areas = [w * h for w, h in zip(widths, heights)]
    ratios = [w / h for w, h in zip(widths, heights)]

    med_area = median(areas)
    med_ratio = median(ratios)

    if med_area <= 0:
        return seats

    filtered = []
    for seat, area, ratio in zip(seats, areas, ratios):
        if area < med_area * 0.25 or area > med_area * 3.5:
            continue
        if ratio < med_ratio * 0.35 or ratio > med_ratio * 2.8:
            continue
        filtered.append(seat)

    return filtered if filtered else seats


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", default="", help="视频路径")
    p.add_argument("--image", default="", help="图片路径")
    p.add_argument("--frame", type=int, default=0, help="用于识别的帧索引")
    p.add_argument("--model", default="", help="检测模型路径")
    p.add_argument("--conf", type=float, default=0.2, help="检测置信度")
    p.add_argument("--nms-iou", type=float, default=0.45, help="NMS去重IoU阈值")
    p.add_argument("--draw-boxes", action="store_true", help="是否在预览图上绘制固定框（默认不绘制，便于前端编辑）")
    p.add_argument("--out-image", default="results/annotated_seats.jpg", help="识别预览图输出路径")
    args = p.parse_args()

    image_path = str(args.image or "").strip()
    video_path = str(args.video or "").strip()

    if not image_path and not video_path:
        print(json.dumps({"error": "请提供 --image 或 --video"}))
        return

    frame = None
    fps_meta = 0.0
    frame_count = 1
    source = "image"

    if image_path:
        if not os.path.exists(image_path):
            print(json.dumps({"error": f"图片不存在: {image_path}"}))
            return
        frame = cv2.imread(image_path)
        if frame is None:
            print(json.dumps({"error": "无法读取图片"}))
            return
    else:
        if not os.path.exists(video_path):
            print(json.dumps({"error": f"视频不存在: {video_path}"}))
            return

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(json.dumps({"error": "无法打开视频"}))
            return

        fps_meta = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        if args.frame > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)

        ret, frame = cap.read()
        cap.release()
        if not ret:
            print(json.dumps({"error": "无法读取指定帧"}))
            return
        source = "video"

    model_candidates = [
        args.model.strip() if args.model else "",
        os.environ.get("SEAT_DETECT_MODEL", "").strip(),
        os.path.join(MODEL_DIR, "seat_best.pt"),
        os.path.join(MODEL_DIR, "yolov8n.pt"),
    ]
    model_path = ""
    for candidate in model_candidates:
        if not candidate:
            continue
        if os.path.exists(candidate):
            model_path = candidate
            break

    if not model_path:
        print(json.dumps({"error": "未找到可用检测模型，请设置 --model 或环境变量 SEAT_DETECT_MODEL"}))
        return

    try:
        model = YOLO(model_path)
    except Exception as e:
        print(json.dumps({"error": f"加载模型失败: {e}"}))
        return

    results = model(frame, conf=args.conf, verbose=False)
    names = getattr(model, "names", {})

    # 寻找座位类：支持 "chair"、"seat"、"椅子" 等多种类名
    seat_ids = []
    seat_class_names = ["chair", "seat", "椅子"]
    for cls_id, name in names.items():
        if str(name).lower() in seat_class_names:
            seat_ids.append(int(cls_id))

    if not seat_ids:
        print(
            json.dumps(
                {
                    "error": f"当前模型未包含座位类（支持: {', '.join(seat_class_names)}），模型类为: {list(names.values())}",
                    "model": model_path,
                }
            )
        )
        return

    img_h, img_w = frame.shape[:2]
    candidates = []
    for box in results[0].boxes:
        cls_id = int(box.cls[0])
        if cls_id not in seat_ids:
            continue
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        x1, y1, x2, y2 = clamp_box([x1, y1, x2, y2], img_w, img_h)
        if x2 <= x1 or y2 <= y1:
            continue
        score = float(box.conf[0]) if box.conf is not None else 0.0
        candidates.append(([x1, y1, x2, y2], score))

    kept = nms_with_scores(candidates, iou_thres=max(0.05, min(0.95, args.nms_iou)))
    seats = [box for box, _ in kept]
    seats = filter_outlier_boxes(seats)

    seats = sort_seats(seats)

    preview = frame.copy()
    if args.draw_boxes:
        for i, (x1, y1, x2, y2) in enumerate(seats, start=1):
            cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 0, 255), 3)
            label = f"Seat {i}"
            cv2.putText(preview, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

    out_dir = os.path.dirname(args.out_image)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    cv2.imwrite(args.out_image, preview)

    print(
        json.dumps(
            {
                "chairs": seats,
                "count": len(seats),
                "annotatedImage": args.out_image.replace("\\", "/"),
                "model": model_path,
                "sourceVideo": {
                    "source": source,
                    "fps": fps_meta,
                    "frameCount": frame_count,
                    "width": img_w,
                    "height": img_h,
                    "frameIndex": int(max(0, args.frame)),
                },
            }
        )
    )


if __name__ == "__main__":
    main()
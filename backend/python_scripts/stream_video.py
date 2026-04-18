import argparse
import os
import json
import cv2
from ultralytics import YOLO
from load_with_seats import bottom_in_box, merge_person_detections


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
MODEL_DIR = os.path.join(BACKEND_DIR, "modules")
DEFAULT_PERSON_MODEL = os.environ.get("PERSON_DETECT_MODEL", os.path.join(MODEL_DIR, "best.pt"))
DEFAULT_ITEM_MODEL = os.environ.get("ITEM_DETECT_MODEL", os.path.join(MODEL_DIR, "yolov8n.pt"))
BOOK_CLASS_ID = 73
BOOK_ITEM_MIN_CONF = max(0.0, min(1.0, float(os.environ.get("BOOK_ITEM_MIN_CONF", "0.3"))))
BOOK_ITEM_MIN_OVERLAP = max(0.0, min(1.0, float(os.environ.get("BOOK_ITEM_MIN_OVERLAP", "0.02"))))


def intersection_area(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return float(ix2 - ix1) * float(iy2 - iy1)


def box_area(box):
    x1, y1, x2, y2 = box
    return max(0.0, float(x2) - float(x1)) * max(0.0, float(y2) - float(y1))


def overlap_ratio(obj_box, seat_box):
    obj_area = box_area(obj_box)
    if obj_area <= 0:
        return 0.0
    return intersection_area(obj_box, seat_box) / obj_area


def is_item_in_seat(item, seat):
    item_box = [item[0], item[1], item[2], item[3]]
    cls_id = int(item[4]) if len(item) > 4 else -1
    by_bottom = bottom_in_box(item_box, seat)

    # 仅对书本启用重叠面积兜底，减少平放书本底部点偏移导致的漏判。
    if cls_id == BOOK_CLASS_ID:
        return by_bottom or overlap_ratio(item_box, seat) >= BOOK_ITEM_MIN_OVERLAP

    return by_bottom


def resolve_class_name(names, cls_id):
    if isinstance(names, dict):
        return str(names.get(cls_id, cls_id))
    if isinstance(names, list) and 0 <= cls_id < len(names):
        return str(names[cls_id])
    return str(cls_id)


def draw_detection_box(frame, box, color, label, thickness=2, text_scale=0.55):
    x1, y1, x2, y2 = map(int, box)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
    (_, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, text_scale, 2)
    text_y = max(th + 6, y1 - 6)
    cv2.putText(frame, label, (x1, text_y), cv2.FONT_HERSHEY_SIMPLEX, text_scale, (0, 0, 0), 4)
    cv2.putText(frame, label, (x1, text_y), cv2.FONT_HERSHEY_SIMPLEX, text_scale, color, 2)


def detect_seat_states(frame, seats, person_model, item_model, target_item_ids, imgsz, conf):
    p_res = person_model(frame, conf=conf, verbose=False)[0]
    best_persons = []
    for box in p_res.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        confv = float(box.conf[0]) if hasattr(box, 'conf') else 1.0
        best_persons.append([x1, y1, x2, y2, confv])

    i_res = item_model(frame, conf=conf, imgsz=imgsz, verbose=False)[0]
    yolo_persons = []
    items = []
    PERSON_ID = 0
    item_names = getattr(i_res, 'names', None) or getattr(item_model, 'names', None) or {}

    for box in i_res.boxes:
        cls_id = int(box.cls[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        confv = float(box.conf[0]) if hasattr(box, 'conf') else 1.0
        if cls_id == PERSON_ID:
            yolo_persons.append([x1, y1, x2, y2, confv])
        elif cls_id in target_item_ids:
            if cls_id == BOOK_CLASS_ID and confv < BOOK_ITEM_MIN_CONF:
                continue
            items.append([x1, y1, x2, y2, cls_id, confv, resolve_class_name(item_names, cls_id)])

    persons = merge_person_detections(best_persons, yolo_persons, iou_threshold=0.2)

    occupied = []
    seat_states = []
    for i, seat in enumerate(seats):
        has_person = any(bottom_in_box([p[0], p[1], p[2], p[3]], seat) for p in persons)
        has_item = any(is_item_in_seat(it, seat) for it in items)
        is_occupied = has_person or has_item
        seat_states.append({
            "index": i,
            "hasPerson": bool(has_person),
            "hasItem": bool(has_item),
            "occupied": bool(is_occupied),
        })
        if is_occupied:
            occupied.append(i)
    return {
        "occupiedIndices": occupied,
        "seatStates": seat_states,
        "personBoxes": best_persons + yolo_persons,
        "itemBoxes": items,
    }


def create_video_writer(out_path, fps, width, height):
    # 优先使用浏览器兼容更好的H.264编码，失败再回退mp4v
    codec_candidates = ["avc1", "H264", "X264", "mp4v"]
    for codec in codec_candidates:
        fourcc = cv2.VideoWriter_fourcc(*codec)
        writer = cv2.VideoWriter(out_path, fourcc, fps, (width, height))
        if writer.isOpened():
            return writer, codec
        try:
            writer.release()
        except Exception:
            pass
    return None, ""


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--video', required=True, help='视频文件路径或摄像头索引')
    p.add_argument('--seats', default='seats.json', help='座位 json 路径')
    p.add_argument('--use-raw-seats', action='store_true', help='直接使用 seats.json 的原始坐标（不按视频缩放）')
    p.add_argument('--out', default='', help='输出视频路径，留空则只检测不生成视频')
    p.add_argument('--show', action='store_true', help='显示实时窗口')
    p.add_argument('--conf', type=float, default=0.01)
    p.add_argument('--occupy-thr', type=int, default=3, help='判定为占座所需连续帧数')
    p.add_argument('--max-frames', type=int, default=0, help='处理的最大帧数（0 表示全部）')
    p.add_argument('--start-frame', type=int, default=0, help='起始帧索引（用于分段检测）')
    p.add_argument('--imgsz', type=int, default=1280)
    p.add_argument('--output-fps', type=float, default=0.0, help='输出视频FPS，<=0时使用源视频FPS')
    p.add_argument('--realtime-detect', action='store_true', help='实时逐帧检测并显示占座状态')
    p.add_argument('--detect-interval', type=int, default=1, help='实时检测间隔帧数，1表示每帧检测')
    p.add_argument('--debug-frame', action='store_true', help='输出第一帧调试图 debug_frame.jpg')
    args = p.parse_args()

    if not os.path.exists(args.seats):
        print(json.dumps({"error": f"找不到 seats json: {args.seats}"}))
        return
    with open(args.seats, 'r', encoding='utf-8') as f:
        seats = json.load(f)

    try:
        person_model = YOLO(DEFAULT_PERSON_MODEL)
        item_model = YOLO(DEFAULT_ITEM_MODEL)
    except Exception as e:
        print(json.dumps({"error": f"加载模型失败: {e}"}))
        return

    # 定义要识别的目标物品类别ID（COCO）
    TARGET_ITEM_IDS = [24, 25, 26, 63, 67, 73]  # 背包, 雨伞, 手提包, 笔记本电脑, 手机, 书

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        try:
            cap = cv2.VideoCapture(int(args.video))
        except Exception:
            print(json.dumps({"error": "无法打开视频或摄像头"}))
            return

    total_frames_meta = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = int(args.start_frame or 0)
    if start_frame < 0:
        start_frame = 0
    if total_frames_meta > 0 and start_frame >= total_frames_meta:
        start_frame = start_frame % total_frames_meta
    if start_frame > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, float(start_frame))

    # 读取起始帧，失败时回退到首帧再试一次
    ret_first, first_frame = cap.read()
    if (not ret_first or first_frame is None) and start_frame > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0.0)
        start_frame = 0
        ret_first, first_frame = cap.read()

    if not ret_first or first_frame is None:
        cap.release()
        print(json.dumps({"error": "视频没有可读取帧，无法生成检测视频"}))
        return

    fps_meta = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    if args.output_fps and args.output_fps > 1.0:
        fps = float(args.output_fps)
    else:
        fps = fps_meta if 1.0 <= fps_meta <= 120.0 else 25.0
    h, w = first_frame.shape[:2]
    display_delay = max(1, int(1000 / fps))
    # 根据参数决定是否按视频帧尺寸缩放 seats
    if not args.use_raw_seats:
        # 推断 seats 的参考尺寸为 seats 中最大的 x2,y2，并按比例缩放
        ref_w = max((s[2] for s in seats), default=w)
        ref_h = max((s[3] for s in seats), default=h)
        if ref_w <= 0 or ref_h <= 0:
            ref_w, ref_h = w, h
        scale_x = w / ref_w
        scale_y = h / ref_h
        scaled_seats = []
        for sx1, sy1, sx2, sy2 in seats:
            nx1 = int(sx1 * scale_x)
            ny1 = int(sy1 * scale_y)
            nx2 = int(sx2 * scale_x)
            ny2 = int(sy2 * scale_y)
            scaled_seats.append([nx1, ny1, nx2, ny2])
        seats = scaled_seats
    else:
        print(json.dumps({"info": "使用原始 seats.json 坐标（未缩放）"}))
    writer = None
    codec_used = ""
    if args.out:
        os.makedirs(os.path.dirname(args.out), exist_ok=True)

    # 仅在显式开启时输出调试图，默认关闭以减少IO开销
    if args.debug_frame:
        debug_frame = first_frame.copy()
        if debug_frame is not None:
            for i, seat in enumerate(seats):
                x1, y1, x2, y2 = map(int, seat)
                cv2.rectangle(debug_frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                cv2.putText(debug_frame, f"Seat {i + 1}", (x1, max(15, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            cv2.imwrite("debug_frame.jpg", debug_frame)

    if args.out:
        writer, codec_used = create_video_writer(args.out, fps, w, h)
        if writer is None:
            cap.release()
            print(json.dumps({"error": f"无法创建输出视频: {args.out}"}))
            return

    frame_idx = 0
    frames_written = 0
    occupy_threshold = max(1, int(args.occupy_thr or 1))
    occupied_streak = [0 for _ in seats]
    empty_streak = [0 for _ in seats]
    stable_occupied = [False for _ in seats]
    latest_state_by_index = [None for _ in seats]
    occupied_seats = []
    seat_states = []
    current_occupied = set()
    latest_person_boxes = []
    latest_item_boxes = []
    frame = first_frame
    while frame is not None:

        if args.max_frames and frame_idx >= args.max_frames:
            break

        if args.realtime_detect:
            interval = max(1, args.detect_interval)
            if frame_idx % interval == 0:
                detection_result = detect_seat_states(
                        frame,
                        seats,
                        person_model,
                        item_model,
                        TARGET_ITEM_IDS,
                        args.imgsz,
                        args.conf,
                    )
                latest_person_boxes = detection_result.get("personBoxes", []) or []
                latest_item_boxes = detection_result.get("itemBoxes", []) or []
                for state in detection_result["seatStates"]:
                    seat_index = int(state.get("index", -1))
                    if seat_index < 0 or seat_index >= len(seats):
                        continue
                    is_occupied_now = bool(state.get("occupied"))
                    latest_state_by_index[seat_index] = state
                    if is_occupied_now:
                        occupied_streak[seat_index] += 1
                        empty_streak[seat_index] = 0
                    else:
                        empty_streak[seat_index] += 1
                        occupied_streak[seat_index] = 0

                    # 连续占用达到阈值才置为占座；连续空闲达到阈值再恢复为空闲
                    if occupied_streak[seat_index] >= occupy_threshold:
                        stable_occupied[seat_index] = True
                    elif empty_streak[seat_index] >= occupy_threshold:
                        stable_occupied[seat_index] = False

                current_occupied = {idx for idx, flag in enumerate(stable_occupied) if flag}
        else:
            # 默认兼容旧逻辑：只在第300帧（10秒）检测一次
            if frame_idx == 299:
                detection_result = detect_seat_states(
                    frame,
                    seats,
                    person_model,
                    item_model,
                    TARGET_ITEM_IDS,
                    args.imgsz,
                    args.conf,
                )
                latest_person_boxes = detection_result.get("personBoxes", []) or []
                latest_item_boxes = detection_result.get("itemBoxes", []) or []
                for state in detection_result["seatStates"]:
                    seat_index = int(state.get("index", -1))
                    if seat_index < 0 or seat_index >= len(seats):
                        continue
                    is_occupied_now = bool(state.get("occupied"))
                    latest_state_by_index[seat_index] = state
                    if is_occupied_now:
                        occupied_streak[seat_index] += 1
                        empty_streak[seat_index] = 0
                    else:
                        empty_streak[seat_index] += 1
                        occupied_streak[seat_index] = 0

                    if occupied_streak[seat_index] >= occupy_threshold:
                        stable_occupied[seat_index] = True
                    elif empty_streak[seat_index] >= occupy_threshold:
                        stable_occupied[seat_index] = False

                current_occupied = {idx for idx, flag in enumerate(stable_occupied) if flag}

        # 始终绘制高对比座位框，便于在压缩后视频中观察
        for p in latest_person_boxes:
            if len(p) >= 5:
                draw_detection_box(
                    frame,
                    p[:4],
                    (0, 220, 0),
                    f"Person {float(p[4]):.2f}",
                    thickness=2,
                    text_scale=0.5,
                )

        for it in latest_item_boxes:
            if len(it) >= 7:
                cls_id = int(it[4])
                confv = float(it[5])
                cls_name = str(it[6])
                color = (0, 215, 255)
                if cls_id == BOOK_CLASS_ID:
                    color = (255, 180, 0)
                draw_detection_box(
                    frame,
                    it[:4],
                    color,
                    f"{cls_name} {confv:.2f}",
                    thickness=2,
                    text_scale=0.45,
                )

        for i, seat in enumerate(seats):
            x1, y1, x2, y2 = map(int, seat)
            color = (0, 255, 0) if i in current_occupied else (0, 0, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 4)

            state = "OCC" if i in current_occupied else "EMPTY"
            label = f"Seat {i + 1} {state}"
            (_, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
            text_y = max(th + 6, y1 - 8)
            cv2.putText(frame, label, (x1, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
            cv2.putText(frame, label, (x1, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

        if writer is not None:
            writer.write(frame)
        frames_written += 1
        if args.show:
            cv2.imshow('Live', frame)
            if cv2.waitKey(display_delay) & 0xFF == ord('q'):
                break

        frame_idx += 1
        ret, next_frame = cap.read()
        frame = next_frame if ret else None

    cap.release()
    if writer is not None:
        writer.release()
    if args.show:
        cv2.destroyAllWindows()

    if frames_written <= 0:
        print(json.dumps({"error": "未写入任何视频帧，输出视频为空"}))
        return

    occupied_seats = [index for index, flag in enumerate(stable_occupied) if flag]
    seat_states = []
    occupied_set = set(occupied_seats)
    for index, _seat in enumerate(seats):
        latest_state = latest_state_by_index[index] or {}
        occupied = index in occupied_set
        seat_states.append({
            "index": index,
            "hasPerson": bool(latest_state.get("hasPerson")) if occupied else False,
            "hasItem": bool(latest_state.get("hasItem")) if occupied else False,
            "occupied": bool(occupied),
        })

    # 输出JSON结果给Node.js：保留索引结果，由后端按数据库座位顺序映射到seat_id
    occupied_indices = [int(i) for i in occupied_seats]
    result = {
        "occupiedIndices": occupied_indices,
        # 兼容旧接口：仍返回1-based occupied
        "occupied": [i + 1 for i in occupied_indices],
        "seatStates": seat_states,
        "source": {
            "startFrame": int(start_frame),
            "processedFrames": int(frames_written),
            "endFrame": int(start_frame + max(frames_written - 1, 0)),
            "totalFrames": int(total_frames_meta) if total_frames_meta > 0 else 0,
            "fps": float(fps),
        },
    }
    if args.out:
        result["video"] = {
            "out": args.out,
            "codec": codec_used,
            "framesWritten": frames_written,
            "fps": fps,
            "durationSec": round(frames_written / max(fps, 1), 2),
            "size": {"width": w, "height": h},
        }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
import os
import json
import time
import re
import cv2
import argparse
import glob
from ultralytics import YOLO
from load_with_seats import bottom_in_box, merge_person_detections
from stream_video import detect_seat_states


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
MODEL_DIR = os.path.join(BACKEND_DIR, "modules")
LEAVE_ITEM_TIMEOUT_MINUTES = float(os.environ.get('LEAVE_ITEM_TIMEOUT_MINUTES', '15'))
DEFAULT_PERSON_MODEL = os.environ.get("PERSON_DETECT_MODEL", os.path.join(MODEL_DIR, "best.pt"))
DEFAULT_ITEM_MODEL = os.environ.get("ITEM_DETECT_MODEL", os.path.join(MODEL_DIR, "yolov8n.pt"))

# 书本专用模型（默认 backend/modules/book_best.pt，可通过环境变量覆盖）
DEFAULT_BOOK_MODEL = os.environ.get("BOOK_DETECT_MODEL", os.path.join(MODEL_DIR, "book_best.pt"))
# 你的 book_best.pt 只有一个 book 标签时，类别通常为 0。
DEFAULT_BOOK_CLASS_ID = int(os.environ.get("BOOK_CLASS_ID", "0"))


class ImageSimulator:
    """基于图片文件夹的座位监控模拟器

    通过循环读取图片文件夹中的图片，模拟真实监控系统的运行逻辑。
    使用系统真实时间进行时间轴模拟，而不是依赖图片帧数。
    """

    def __init__(self, image_dir, seats, person_model, item_model, target_item_ids,
                 book_model=None, book_class_id=DEFAULT_BOOK_CLASS_ID,
                 debug_book_detections=False,
                 imgsz=1280, conf=0.4, occupy_thr=3, detect_interval=1,
                 debug_output_dir="", debug_output_interval=10.0):
        """初始化图片模拟器

        Args:
            image_dir: 包含图片的文件夹路径
            seats: 座位列表 [[x1,y1,x2,y2], ...]
            person_model: 人物检测模型
            item_model: 物品检测模型
            target_item_ids: 目标物品类别ID列表
            imgsz: 检测输入尺寸
            conf: 检测置信度阈值
            occupy_thr: 判定为占座所需连续采样次数
            detect_interval: 检测间隔（帧数）
        """
        self.image_dir = image_dir
        self.seats = seats
        self.person_model = person_model
        self.item_model = item_model
        self.target_item_ids = target_item_ids
        self.book_model = book_model
        self.book_class_id = int(book_class_id)
        self.debug_book_detections = bool(debug_book_detections)
        self.imgsz = imgsz
        self.conf = conf
        self.occupy_thr = max(1, occupy_thr)
        self.detect_interval = max(1, detect_interval)
        self.debug_output_dir = (debug_output_dir or "").strip()
        self.debug_output_interval = max(0.0, float(debug_output_interval or 0.0))
        self.last_debug_output_at = 0.0

        # 加载图片列表（按名称排序）
        self.image_paths = sorted(glob.glob(os.path.join(image_dir, "*.jpg")))
        if not self.image_paths:
            self.image_paths = sorted(glob.glob(os.path.join(image_dir, "*.png")))

        if not self.image_paths:
            raise ValueError(f"在 {image_dir} 中未找到任何图片文件")

        self.total_images = len(self.image_paths)
        self.current_index = 0

        # 时间轴管理：使用系统真实时间
        self.start_time = time.time()
        self.simulation_start_time = None  # 模拟开始时的实时时间

        # 占座状态管理
        self.occupied_streak = [0 for _ in seats]  # 连续占座计数
        self.empty_streak = [0 for _ in seats]     # 连续空闲计数
        self.stable_occupied = [False for _ in seats]  # 稳定占座状态
        self.violation_start_time = [None for _ in seats]  # 每个座位的违规开始时间
        self.latest_state_by_index = [None for _ in seats]  # 最新检测状态

        # 统计信息
        self.total_detections = 0
        self.total_frames_processed = 0
        self.current_occupied = set()
        self.current_frame_id = -1
        self.current_image_path = ""
        self.latest_debug_image_name = "simulate_latest.jpg"

    def _draw_item_boxes(self, canvas, item_boxes, color=(255, 0, 255), prefix="BOOK"):
        """在画面上绘制 itemBoxes（来自 stream_video.detect_seat_states）"""
        if canvas is None or not isinstance(item_boxes, list):
            return
        for it in item_boxes:
            try:
                x1, y1, x2, y2 = map(int, it[0:4])
                cls_id = int(it[4]) if len(it) > 4 else -1
                confv = float(it[5]) if len(it) > 5 else -1.0
                name = str(it[6]) if len(it) > 6 else str(cls_id)
            except Exception:
                continue
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
            label = f"{prefix}:{name}#{cls_id} {confv:.2f}" if confv >= 0 else f"{prefix}:{name}#{cls_id}"
            cv2.putText(canvas, label, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    def _write_debug_preview_if_needed(self, frame, frame_id=-1):
        if not self.debug_output_dir:
            return
        now = time.time()
        if self.debug_output_interval > 0 and now - self.last_debug_output_at < self.debug_output_interval:
            return

        os.makedirs(self.debug_output_dir, exist_ok=True)
        canvas = frame.copy()
        for i, seat in enumerate(self.seats):
            x1, y1, x2, y2 = map(int, seat)
            violation_start = self.violation_start_time[i]
            is_timing = violation_start is not None
            duration_seconds = 0.0
            if is_timing:
                duration_seconds = max(0.0, time.time() - float(violation_start))

            is_violation = is_timing and duration_seconds >= max(1.0, float(LEAVE_ITEM_TIMEOUT_MINUTES)) * 60.0
            if is_violation:
                color = (0, 0, 255)
                label = f"Seat {i + 1} VIOL {duration_seconds:.0f}s"
            elif is_timing:
                color = (0, 165, 255)
                label = f"Seat {i + 1} TIMER {duration_seconds:.0f}s"
            elif i in self.current_occupied:
                color = (0, 255, 0)
                label = f"Seat {i + 1} OCC"
            else:
                color = (0, 0, 255)
                label = f"Seat {i + 1} EMPTY"

            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 3)
            cv2.putText(canvas, label, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        frame_num = int(frame_id) if isinstance(frame_id, int) and frame_id >= 0 else -1
        frame_name = f"simulate_frame_{frame_num:06d}.jpg" if frame_num >= 0 else "simulate_latest.jpg"
        target_path = os.path.join(self.debug_output_dir, frame_name)
        tmp_path = os.path.join(self.debug_output_dir, f"{frame_name}.tmp.jpg")
        ok = cv2.imwrite(tmp_path, canvas)
        if ok:
            try:
                os.replace(tmp_path, target_path)
            except Exception:
                cv2.imwrite(target_path, canvas)

            # 兼容旧预览路径
            latest_path = os.path.join(self.debug_output_dir, "simulate_latest.jpg")
            latest_tmp = os.path.join(self.debug_output_dir, "simulate_latest.tmp.jpg")
            cv2.imwrite(latest_tmp, canvas)
            try:
                os.replace(latest_tmp, latest_path)
            except Exception:
                cv2.imwrite(latest_path, canvas)

            self.latest_debug_image_name = frame_name
        self.last_debug_output_at = now

    def get_current_real_time(self):
        """获取当前的模拟实时时间（相对于模拟开始）"""
        if self.simulation_start_time is None:
            self.simulation_start_time = time.time()
        return time.time()

    def get_elapsed_time(self):
        """获取从模拟开始到现在的经过时间（秒）"""
        if self.simulation_start_time is None:
            return 0
        return time.time() - self.simulation_start_time

    def load_next_image(self):
        """加载下一张图片，循环读取"""
        if not self.image_paths:
            return None

        image_path = self.image_paths[self.current_index]
        frame = cv2.imread(image_path)

        if frame is None:
            print(f"警告: 无法读取图片 {image_path}")
            return None

        # 更新索引，实现循环
        self.current_image_path = image_path
        m = re.search(r"frame_(\d+)", os.path.basename(image_path), flags=re.IGNORECASE)
        if m:
            self.current_frame_id = int(m.group(1))
        else:
            self.current_frame_id = max(0, self.total_frames_processed)

        self.current_index = (self.current_index + 1) % self.total_images
        self.total_frames_processed += 1

        return frame

    def process_frame(self, frame):
        """处理单个图片帧的检测逻辑

        Returns:
            dict: 包含 occupiedIndices, seatStates, violation_times 等信息
        """
        # 运行通用物品检测（保持原有模型与类别ID列表）
        detection_result = detect_seat_states(
            frame,
            self.seats,
            self.person_model,
            self.item_model,
            self.target_item_ids,
            self.imgsz,
            self.conf,
        )

        # 额外运行书本专用模型检测，并将结果与通用物品检测合并。
        # book_best.pt 为单类模型时：book_class_id=0 即可。
        detection_book = None
        if self.book_model is not None:
            try:
                detection_book = detect_seat_states(
                    frame,
                    self.seats,
                    self.person_model,
                    self.book_model,
                    [self.book_class_id],
                    self.imgsz,
                    self.conf,
                    item_person_class_id=None,
                )
            except Exception:
                detection_book = None

        # 若开启调试：将书本模型检测到的框画在实时预览图上（紫色）
        if self.debug_output_dir and self.debug_book_detections and detection_book is not None:
            try:
                canvas = frame.copy()
                self._draw_item_boxes(canvas, detection_book.get("itemBoxes", []) or [], color=(255, 0, 255), prefix="BOOK")
                # 复用现有预览写入逻辑：将画框后的 canvas 临时作为 frame 写入
                self._write_debug_preview_if_needed(canvas, self.current_frame_id)
            except Exception:
                # 画框失败不影响主流程
                pass

        self.total_detections += 1
        current_time = self.get_current_real_time()

        # 更新每个座位的状态（合并 hasItem：通用物品 OR 书本专用模型）
        seat_states_main = detection_result.get("seatStates", []) or []
        seat_states_book = (detection_book or {}).get("seatStates", []) or []
        book_by_index = {int(s.get("index", -1)): s for s in seat_states_book if isinstance(s, dict)}

        for state in seat_states_main:
            seat_index = int(state.get("index", -1))
            if seat_index < 0 or seat_index >= len(self.seats):
                continue

            is_occupied_now = bool(state.get("occupied"))
            has_person = bool(state.get("hasPerson"))
            has_item_main = bool(state.get("hasItem"))
            has_item_book = bool(book_by_index.get(seat_index, {}).get("hasItem"))
            has_item = bool(has_item_main or has_item_book)

            # 用合并后的 hasItem/occupied 覆盖写回，保证后续稳定状态与计时逻辑一致
            state = dict(state)
            state["hasItem"] = has_item
            state["occupied"] = bool(has_person or has_item)
            is_occupied_now = bool(state.get("occupied"))

            self.latest_state_by_index[seat_index] = state

            # 消抖处理：连续 occupy_thr 次采样才更新最终状态
            if is_occupied_now:
                self.occupied_streak[seat_index] += 1
                self.empty_streak[seat_index] = 0
            else:
                self.empty_streak[seat_index] += 1
                self.occupied_streak[seat_index] = 0

            # 更新稳定占座状态
            was_occupied = self.stable_occupied[seat_index]

            if self.occupied_streak[seat_index] >= self.occupy_thr:
                self.stable_occupied[seat_index] = True
            elif self.empty_streak[seat_index] >= self.occupy_thr:
                self.stable_occupied[seat_index] = False

            # 占座计时逻辑：只在"有物无人"状态下记录时间
            is_now_occupied = self.stable_occupied[seat_index]
            if is_now_occupied and not was_occupied:
                # 座位从空闲变为占座：开始计时
                # 区分是否为"有物无人"状态
                if has_item and not has_person:
                    self.violation_start_time[seat_index] = current_time
                else:
                    self.violation_start_time[seat_index] = None
            elif is_now_occupied and was_occupied:
                # 座位保持占座状态：维持或更新计时
                if has_item and not has_person:
                    if self.violation_start_time[seat_index] is None:
                        self.violation_start_time[seat_index] = current_time
            elif not is_now_occupied and was_occupied:
                # 座位从占座变为空闲：清除计时
                self.violation_start_time[seat_index] = None

        self.current_occupied = {idx for idx, flag in enumerate(self.stable_occupied) if flag}
        # 如果上面对 canvas 已输出过（debug_book_detections），这里仍然输出一次原逻辑也没问题；
        # 为避免双写，在 debug_book_detections 开启时这里跳过。
        if not (self.debug_output_dir and self.debug_book_detections and detection_book is not None):
            self._write_debug_preview_if_needed(frame, self.current_frame_id)

        return self._build_result()

    def _build_result(self):
        """构建结果字典"""
        current_time = self.get_current_real_time()
        elapsed = self.get_elapsed_time()

        occupied_indices = sorted(list(self.current_occupied))
        seat_states = []
        violation_times = {}

        for index in range(len(self.seats)):
            latest_state = self.latest_state_by_index[index] or {}
            occupied = index in self.current_occupied
            has_person = bool(latest_state.get("hasPerson"))
            has_item = bool(latest_state.get("hasItem"))

            seat_states.append({
                "index": index,
                "hasPerson": has_person,
                "hasItem": has_item,
                "detectedOccupied": bool(has_person or has_item),
                "occupied": bool(occupied),
            })

            # 计算违规时长（有物无人的持续时间）
            if self.violation_start_time[index] is not None:
                duration = current_time - self.violation_start_time[index]
                violation_times[str(index)] = {
                    "startTime": self.violation_start_time[index],
                    "durationSeconds": round(duration, 2),
                    "currentTime": current_time,
                }

        return {
            "occupiedIndices": occupied_indices,
            "occupied": [i + 1 for i in occupied_indices],  # 1-based，兼容旧接口
            "seatStates": seat_states,
            "status": {
                "frameId": int(self.current_frame_id) if self.current_frame_id >= 0 else None,
                "sourceImage": self.current_image_path,
                "debugImageName": self.latest_debug_image_name,
                "processedFrames": self.total_frames_processed,
                "totalDetections": self.total_detections,
                "currentImageIndex": self.current_index,
                "totalImages": self.total_images,
                "elapsedTimeSeconds": round(elapsed, 2),
                "currentRealTime": round(current_time, 2),
            },
            "violationTimes": violation_times,
        }

    def run(self, max_iterations=None, sample_interval=1):
        """运行模拟循环

        Args:
            max_iterations: 最大迭代次数（None表示无限循环）
            sample_interval: 采样间隔（秒）

        Yields:
            dict: 每次检测的结果
        """
        iteration = 0
        last_detection_time = time.time()

        while max_iterations is None or iteration < max_iterations:
            # 检查采样间隔
            current_time = time.time()
            if current_time - last_detection_time < sample_interval:
                time.sleep(0.05)  # 小睡眠避免CPU占用过高
                continue

            # 加载下一张图片
            frame = self.load_next_image()
            if frame is None:
                iteration += 1
                continue

            # 处理帧
            result = self.process_frame(frame)
            last_detection_time = time.time()

            yield result

            iteration += 1


def main():
    parser = argparse.ArgumentParser(description='基于图片文件夹的座位监控模拟')
    parser.add_argument('--image-dir', default='../library_sampled_data',
                       help='包含图片的文件夹路径')
    parser.add_argument('--seats', default='seats.json',
                       help='座位 json 文件路径')
    parser.add_argument('--conf', type=float, default=0.01,
                       help='检测置信度阈值')
    parser.add_argument('--occupy-thr', type=int, default=3,
                       help='判定为占座所需连续采样次数')
    parser.add_argument('--max-iterations', type=int, default=None,
                       help='最大迭代次数（默认无限）')
    parser.add_argument('--sample-interval', type=float, default=3.0,
                       help='采样间隔（秒）')
    parser.add_argument('--imgsz', type=int, default=1280,
                       help='YOLO检测输入尺寸')
    parser.add_argument('--book-model', default=DEFAULT_BOOK_MODEL,
                       help='书本专用检测模型路径（默认 backend/modules/book_best.pt；设为空则禁用）')
    parser.add_argument('--book-class-id', type=int, default=DEFAULT_BOOK_CLASS_ID,
                       help='书本类别ID（单类book模型通常为0；如自训模型类别不同请修改）')
    parser.add_argument('--include-book-in-item-model', action='store_true',
                       help='通用物品模型也识别书本（默认关闭：书本仅由book_best.pt负责）')
    parser.add_argument('--output-json', default='',
                       help='输出结果JSON文件路径（空则只输出到标准输出）')
    parser.add_argument('--continuous-output', action='store_true',
                       help='持续输出每次检测的结果')
    parser.add_argument('--show-frames', action='store_true',
                       help='显示处理的图片（需要GUI支持）')
    parser.add_argument('--debug-output-dir',
                       default=os.path.join(SCRIPT_DIR, 'debug_output'),
                       help='实时预览图输出目录')
    parser.add_argument('--debug-output-interval', type=float, default=0.0,
                       help='实时预览图输出间隔（秒）')
    parser.add_argument('--debug-book-detections', action='store_true',
                       help='在 debug_output 预览图上叠加绘制 book_best.pt 的检测框（紫色）')

    args = parser.parse_args()

    # 检查图片目录
    if not os.path.exists(args.image_dir):
        print(json.dumps({"error": f"图片目录不存在: {args.image_dir}"}))
        return

    # 加载座位配置
    if not os.path.exists(args.seats):
        print(json.dumps({"error": f"座位配置文件不存在: {args.seats}"}))
        return

    with open(args.seats, 'r', encoding='utf-8') as f:
        seats = json.load(f)

    # 加载YOLO模型
    try:
        person_model = YOLO(DEFAULT_PERSON_MODEL)
        item_model = YOLO(DEFAULT_ITEM_MODEL)
        book_model = None
        if (args.book_model or "").strip():
            book_model = YOLO((args.book_model or "").strip())
    except Exception as e:
        print(json.dumps({"error": f"加载模型失败: {e}"}))
        return

    # 定义通用物品模型要识别的目标类别（COCO）
    # 默认移除“书本(73)”，避免与 book_best.pt 重复/冲突；如需恢复可加 --include-book-in-item-model
    TARGET_ITEM_IDS = [24, 25, 26, 63, 67]  # 背包, 雨伞, 手提包, 笔记本电脑, 手机
    if args.include_book_in_item_model:
        TARGET_ITEM_IDS.append(73)

    # 创建模拟器
    try:
        simulator = ImageSimulator(
            image_dir=args.image_dir,
            seats=seats,
            person_model=person_model,
            item_model=item_model,
            target_item_ids=TARGET_ITEM_IDS,
            book_model=book_model,
            book_class_id=args.book_class_id,
            debug_book_detections=args.debug_book_detections,
            imgsz=args.imgsz,
            conf=args.conf,
            occupy_thr=args.occupy_thr,
            debug_output_dir=args.debug_output_dir,
            debug_output_interval=args.debug_output_interval,
        )
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return

    print(f"[INFO] 初始化成功: 找到 {simulator.total_images} 张图片, {len(seats)} 个座位", flush=True)

    # 运行模拟
    all_results = []
    try:
        for iteration, result in enumerate(simulator.run(
            max_iterations=args.max_iterations,
            sample_interval=args.sample_interval
        )):
            if args.continuous_output:
                print(json.dumps(result), flush=True)

            all_results.append(result)

            if args.show_frames:
                # 可选：显示图片和检测结果
                frame = simulator.load_next_image()
                if frame is not None:
                    # 在这里可以添加可视化代码
                    pass

    except KeyboardInterrupt:
        print("[INFO] 模拟被用户中断", flush=True)
    except Exception as e:
        print(json.dumps({"error": f"运行过程中出错: {e}"}), flush=True)
        return

    # 输出最终结果
    if all_results:
        final_result = all_results[-1]
        final_result["totalIterations"] = len(all_results)
        final_result["allResults"] = all_results if not args.continuous_output else None

        if args.output_json:
            with open(args.output_json, 'w', encoding='utf-8') as f:
                json.dump(final_result, f, ensure_ascii=False, indent=2)
            print(f"[INFO] 结果已保存到: {args.output_json}", flush=True)
        else:
            print(json.dumps(final_result, ensure_ascii=False), flush=True)
    else:
        print(json.dumps({"error": "未生成任何检测结果"}), flush=True)


if __name__ == '__main__':
    main()


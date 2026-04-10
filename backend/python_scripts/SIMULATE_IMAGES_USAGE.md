# simulate_images.py 使用说明

## 概述

`simulate_images.py` 是一个基于图片文件夹的座位监控模拟器。它通过循环读取 `./library_sampled_data` 文件夹中的图片，模拟真实监控系统的运行逻辑。

## 核心特性

### 1. 代码复用
- 从 `stream_video.py` 导入 `detect_seat_states()` 函数
- 从 `load_with_seats.py` 导入 `bottom_in_box()` 和 `merge_person_detections()`
- 避免重复编写算法逻辑，保持一致性

### 2. ImageSimulator 类

#### 初始化参数
```python
simulator = ImageSimulator(
    image_dir='../library_sampled_data',  # 图片文件夹路径
    seats=seats,                           # 座位列表
    person_model=person_model,             # 人物检测模型
    item_model=item_model,                 # 物品检测模型
    target_item_ids=[24, 26, 28, 73, 74, 76],  # 目标物品类别ID
    imgsz=1280,                            # 检测输入尺寸
    conf=0.4,                              # 检测置信度阈值
    occupy_thr=3,                          # 消抖阈值：连续3次采样结果一致才更新
)
```

#### 关键方法

##### `get_current_real_time()`
返回当前的实时时间（使用 `time.time()`），而非依赖图片帧数。

##### `get_elapsed_time()`
返回从模拟开始到现在的经过时间（秒）。

##### `load_next_image()`
加载下一张图片，自动循环读取。图片列表会按文件名排序以确保顺序一致。

##### `process_frame(frame)`
处理单个图片帧的检测逻辑，包括：
- 运行YOLO检测
- 更新座位状态
- 消抖处理（根据 `occupy_thr`）
- 记录违规开始时间

返回包含以下信息的字典：
```python
{
    "occupiedIndices": [0, 2, 5],           # 被占座的座位索引（0-based）
    "occupied": [1, 3, 6],                  # 被占座的座位号（1-based，兼容旧接口）
    "seatStates": [                         # 每个座位的详细状态
        {
            "index": 0,
            "hasPerson": True,
            "hasItem": False,
            "occupied": True,
        },
        ...
    ],
    "status": {
        "processedFrames": 15,               # 已处理的图片数量
        "totalDetections": 15,               # 总检测次数
        "currentImageIndex": 14,             # 当前图片索引
        "totalImages": 55,                   # 总图片数量
        "elapsedTimeSeconds": 45.23,         # 经过的实时时间（秒）
        "currentRealTime": 1234567890.12,    # 当前实时时间戳
    },
    "violationTimes": {                      # 违规时间（有物无人的持续时长）
        "0": {
            "startTime": 1234567880.50,      # 违规开始时间戳
            "durationSeconds": 9.73,         # 违规持续时长（秒）
            "currentTime": 1234567890.23,
        },
    },
}
```

##### `run(max_iterations=None, sample_interval=1.0)`
运行模拟循环。

参数：
- `max_iterations`: 最大迭代次数。如果为 `None`，则无限循环。
- `sample_interval`: 采样间隔（秒）。控制两次检测之间的最小时间间隔。

返回一个生成器，每次产生一个结果字典。

### 3. 占座计时逻辑

**规则**：只有当座位状态为"有物无人"时，才开始记录 `violation_start_time`。

**状态转移**：
- **空闲 → 占座（有物无人）**：开始计时，记录 `violation_start_time`
- **占座（有物无人） → 保持占座（有物无人）**：维持计时
- **占座（有物无人） → 占座（有人）**：停止计时（有人则不违规）
- **占座 → 空闲**：清除计时信息

### 4. 消抖处理

使用 `occupy_thr` 参数实现消抖，确保连续 N 次采样结果一致才更新最终状态，处理人影走动产生的干扰。

## 命令行使用

### 基础用法

```bash
python simulate_images.py
```

### 带参数的完整示例

```bash
python simulate_images.py \
    --image-dir ../library_sampled_data \
    --seats seats.json \
    --conf 0.4 \
    --occupy-thr 3 \
    --max-iterations 100 \
    --sample-interval 1.0 \
    --imgsz 1280 \
    --output-json results.json \
    --continuous-output
```

### 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--image-dir` | `../library_sampled_data` | 包含图片的文件夹路径 |
| `--seats` | `seats.json` | 座位配置JSON文件路径 |
| `--conf` | `0.4` | YOLO检测置信度阈值 |
| `--occupy-thr` | `3` | 判定为占座所需连续采样次数（消抖） |
| `--max-iterations` | `None` | 最大迭代次数，`None` 表示无限循环 |
| `--sample-interval` | `1.0` | 采样间隔（秒） |
| `--imgsz` | `1280` | YOLO模型输入尺寸 |
| `--output-json` | 空 | 输出结果JSON文件路径，空则仅输出到标准输出 |
| `--continuous-output` | False | 持续输出每次检测的结果到标准输出 |
| `--show-frames` | False | 显示处理的图片（需要GUI支持） |

## 程序输出

### 标准输出示例

```json
{
  "occupiedIndices": [0, 2, 5],
  "occupied": [1, 3, 6],
  "seatStates": [...],
  "status": {
    "processedFrames": 15,
    "totalDetections": 15,
    "currentImageIndex": 14,
    "totalImages": 55,
    "elapsedTimeSeconds": 45.23,
    "currentRealTime": 1234567890.12
  },
  "violationTimes": {...},
  "totalIterations": 100,
  "allResults": null
}
```

## 代码集成示例

### 作为Python模块导入

```python
from simulate_images import ImageSimulator
from ultralytics import YOLO
import json

# 加载模型
person_model = YOLO('best.pt')
item_model = YOLO('yolov8n.pt')

# 加载座位配置
with open('seats.json', 'r') as f:
    seats = json.load(f)

# 创建模拟器
simulator = ImageSimulator(
    image_dir='../library_sampled_data',
    seats=seats,
    person_model=person_model,
    item_model=item_model,
    target_item_ids=[24, 26, 28, 73, 74, 76],
)

# 运行模拟
for iteration, result in enumerate(simulator.run(max_iterations=50, sample_interval=0.5)):
    print(f"迭代 {iteration}: 被占座位 {result['occupiedIndices']}")
    print(f"经过时间: {result['status']['elapsedTimeSeconds']}秒")
```

## 时间轴管理说明

### 核心机制

1. **禁止使用图片帧数作为时间**：即使在循环读取图片，时间轴也是连续的。

2. **使用系统真实时间**：所有时间相关的操作都基于 `time.time()`：
   - `get_current_real_time()` 返回当前系统时间戳
   - `get_elapsed_time()` 返回从模拟启动到现在的经过时间

3. **violation_start_time 管理**：
   - 每个座位独立维护一个开始时间戳
   - 只在"有物无人"状态下记录
   - 用于计算违规的持续时长

### 时间精度

- 系统真实时间精度：毫秒级（通过 `time.time()`）
- 采样间隔通过 `sample_interval` 参数控制（默认1秒）
- 结果中的时间均为浮点数，可精确到小数点后多位

## 注意事项

1. **模型文件位置**：确保 `best.pt` 和 `yolov8n.pt` 存在于 `../modules` 目录
2. **图片文件**：脚本会自动查找 `.jpg` 和 `.png` 文件，并按名称排序
3. **座位配置**：`seats.json` 应包含座位的坐标信息 `[[x1,y1,x2,y2], ...]`
4. **内存占用**：循环读取图片时，仅保留当前帧在内存中
5. **CPU占用**：在等待采样间隔时，会进行小睡眠（50ms）以降低CPU占用

## 与 stream_video.py 的区别

| 特性 | stream_video.py | simulate_images.py |
|------|-----------------|-------------------|
| 数据源 | 视频文件或摄像头 | 图片文件夹 |
| 时间轴 | 视频帧率 | 系统真实时间 |
| 循环 | 一次性处理 | 循环读取图片 |
| 占座计时 | 无 | 有（记录violation_start_time） |
| 用途 | 视频检测 | 模拟监控系统 |


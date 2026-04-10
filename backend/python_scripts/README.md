# simulate_images.py 项目总结

## 📋 项目完成情况

### ✅ 已完成的任务

1. **新建 simulate_images.py 脚本**
   - 完整实现 `ImageSimulator` 类
   - 支持图片文件夹的循环读取
   - 集成 YOLO 人物和物品检测

2. **代码复用**
   - ✓ 导入并使用 `stream_video.py` 中的 `detect_seat_states()` 函数
   - ✓ 导入并使用 `load_with_seats.py` 中的 `bottom_in_box()` 和 `merge_person_detections()`
   - ✓ 避免重复编写算法逻辑

3. **核心功能实现**

   **a) 图片轮询机制**
   - 自动发现指定目录中的所有图片（.jpg 和 .png）
   - 按文件名排序，确保顺序一致
   - 自动循环读取，确保持续运行
   - 支持自定义图片目录

   **b) 系统真实时间管理**
   - ✓ 禁止使用图片帧数作为时间
   - ✓ 完全基于 `time.time()` 的系统时间
   - ✓ 时间轴连续性保证：即使图片在循环，也保证计时的连续性
   - ✓ 提供 `get_current_real_time()` 和 `get_elapsed_time()` 方法

   **c) 占座计时逻辑**
   - ✓ 维护全局状态字典 `violation_start_time`
   - ✓ 只在"有物无人"状态下记录起始时间
   - ✓ 自动计算持续时长（当前时间 - 开始时间）
   - ✓ 状态转移时自动更新/清除计时

   **d) 消抖处理**
   - ✓ 保留 `occupy_thr` 逻辑
   - ✓ 连续 N 次采样结果一致才更新最终状态
   - ✓ 消除人影走动等干扰
   - ✓ 提高座位状态判定的稳定性

4. **完整的命令行接口**
   - 支持丰富的参数配置
   - JSON 格式输出
   - 支持连续输出模式

5. **文档编写**
   - `INSTALLATION_GUIDE.md` - 完整安装和使用指南
   - `SIMULATE_IMAGES_USAGE.md` - 详细功能说明
   - `QUICK_REFERENCE.md` - 快速参考指南

## 📁 文件结构

```
backend/python_scripts/
├── simulate_images.py              # 新建的主脚本
├── requirements.txt                 # Python 依赖列表
├── INSTALLATION_GUIDE.md           # 安装和使用完整指南
├── SIMULATE_IMAGES_USAGE.md        # 功能详解文档
├── QUICK_REFERENCE.md              # 快速参考指南
├── stream_video.py                 # 原始视频处理脚本（被导入）
├── load_with_seats.py              # 座位检测函数库（被导入）
├── seats.json                      # 座位配置文件
└── ../library_sampled_data/        # 输入图片源
    ├── frame_0000.jpg
    ├── frame_0001.jpg
    ├── ...
    └── frame_0054.jpg
```

## 🎯 ImageSimulator 类核心设计

### 初始化
```python
simulator = ImageSimulator(
    image_dir='../library_sampled_data',
    seats=seats,
    person_model=person_model,
    item_model=item_model,
    target_item_ids=[24, 26, 28, 73, 74, 76],
    imgsz=1280,
    conf=0.4,
    occupy_thr=3,
)
```

### 关键属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `image_paths` | list | 排序后的图片路径列表 |
| `current_index` | int | 当前图片索引（自动循环） |
| `simulation_start_time` | float | 模拟开始的系统时间戳 |
| `occupied_streak` | list | 各座位的连续占座计数 |
| `empty_streak` | list | 各座位的连续空闲计数 |
| `stable_occupied` | list | 消抖后的稳定占座状态 |
| `violation_start_time` | list | 各座位的违规开始时间戳 |
| `current_occupied` | set | 当前被占座位的索引集合 |

### 关键方法

| 方法 | 说明 | 返回 |
|------|------|------|
| `load_next_image()` | 加载下一张图片（自动循环） | cv2.Mat 或 None |
| `process_frame(frame)` | 处理单帧，进行检测和状态更新 | dict（结果）|
| `get_current_real_time()` | 获取当前系统时间戳 | float |
| `get_elapsed_time()` | 获取经过时间（秒） | float |
| `run(max_iterations, sample_interval)` | 运行模拟循环 | Generator |

## 🔄 时间轴管理机制

### 核心原理

1. **初始化阶段**
   ```python
   self.simulation_start_time = time.time()  # 模拟启动时的系统时间
   ```

2. **每次采样时**
   ```python
   current_time = self.get_current_real_time()  # 当前系统时间
   elapsed = self.get_elapsed_time()            # 经过时间
   ```

3. **占座计时**
   ```python
   duration = current_time - violation_start_time
   ```

### 时间特点

- ✓ **绝对连续**：使用系统时间戳，不会因为图片循环而重置
- ✓ **高精度**：毫秒级精度（浮点数）
- ✓ **独立于帧数**：不依赖图片序列
- ✓ **可配置间隔**：通过 `sample_interval` 控制采样频率

## 💡 占座计时逻辑详解

### 状态机

```
EMPTY（空闲）
  ↓ [人进来]
OCCUPIED_PERSON（有人占座）
  violation_start_time = None
  ↓ [人离开，留下物品]
OCCUPIED_ITEM（有物无人-违规）
  violation_start_time = 当前时间  ← 开始计时
  ↓ [继续有物无人]
计算持续时长 = 当前时间 - violation_start_time
  ↓ [物品被取走]
EMPTY（空闲）
  violation_start_time = None  ← 清除计时
```

### 关键规则

1. **何时开始计时**
   ```
   条件: has_item AND NOT has_person AND 状态从非VIOLATION变为VIOLATION
   动作: violation_start_time = 当前时间
   ```

2. **何时继续计时**
   ```
   条件: has_item AND NOT has_person AND 已经在VIOLATION状态
   动作: 保持violation_start_time不变
   ```

3. **何时停止计时**
   ```
   条件: 不再是VIOLATION状态
   动作: violation_start_time = None
   ```

## 🛡️ 消抖处理

### 实现原理

使用 `occupy_thr` 参数（默认值为3）：

```python
if occupied_streak[seat_index] >= self.occupy_thr:
    self.stable_occupied[seat_index] = True  # 确认占座
elif empty_streak[seat_index] >= self.occupy_thr:
    self.stable_occupied[seat_index] = False  # 确认空闲
```

### 效果

- **3连续采样**：需要3次连续检测为"占座"才认定为占座
- **消除干扰**：人影走动、检测波动不会导致快速状态切换
- **稳定性**：大幅降低误报率

## 📊 输出结果格式

### 完整示例

```json
{
  "occupiedIndices": [0, 2, 5],
  "occupied": [1, 3, 6],
  "seatStates": [
    {
      "index": 0,
      "hasPerson": true,
      "hasItem": false,
      "occupied": true
    },
    {
      "index": 2,
      "hasPerson": false,
      "hasItem": true,
      "occupied": true
    }
  ],
  "status": {
    "processedFrames": 15,
    "totalDetections": 15,
    "currentImageIndex": 14,
    "totalImages": 55,
    "elapsedTimeSeconds": 45.23,
    "currentRealTime": 1707560234.567
  },
  "violationTimes": {
    "2": {
      "startTime": 1707560224.234,
      "durationSeconds": 10.333,
      "currentTime": 1707560234.567
    }
  }
}
```

## 🚀 使用示例

### 1. 基础运行
```bash
python simulate_images.py
```

### 2. 指定迭代次数
```bash
python simulate_images.py --max-iterations 50
```

### 3. 自定义采样间隔
```bash
python simulate_images.py --sample-interval 0.5 --max-iterations 30
```

### 4. 保存结果到文件
```bash
python simulate_images.py --output-json results.json --max-iterations 100
```

### 5. 连续输出模式（观察实时变化）
```bash
python simulate_images.py --continuous-output --max-iterations 20
```

### 6. Python 代码集成
```python
from simulate_images import ImageSimulator
from ultralytics import YOLO
import json

# 加载配置
seats = json.load(open('seats.json'))
person_model = YOLO('modules/best.pt')
item_model = YOLO('modules/yolov8n.pt')

# 创建模拟器
simulator = ImageSimulator(
    image_dir='../library_sampled_data',
    seats=seats,
    person_model=person_model,
    item_model=item_model,
    target_item_ids=[24, 26, 28, 73, 74, 76],
    occupy_thr=3,
)

# 运行
for result in simulator.run(max_iterations=50, sample_interval=1.0):
    print(f"被占座位: {result['occupiedIndices']}")
    print(f"经过时间: {result['status']['elapsedTimeSeconds']}秒")
```

## 📦 依赖项

```
opencv-python>=4.8.0      # 图像处理
ultralytics>=8.0.0        # YOLO 检测模型推理
numpy>=1.21.0             # 数值计算
```


## 🔗 与原始脚本的关系

### 代码复用

```
simulate_images.py
├── 导入: from stream_video import detect_seat_states
│   └─ 核心检测函数，包含YOLO推理和座位检测逻辑
├── 导入: from load_with_seats import bottom_in_box
│   └─ 人物脚底检测函数
└── 导入: from load_with_seats import merge_person_detections
    └─ 人物检测合并函数
```

### 主要改进

| 特性 | stream_video.py | simulate_images.py |
|------|-----------------|-------------------|
| **输入源** | 视频文件或摄像头 | 图片文件夹 |
| **时间轴** | 基于视频FPS | 基于系统真实时间 |
| **循环机制** | 无（一次性处理） | 有（自动循环读取） |
| **占座计时** | 无 | 有（完整的violation计时） |
| **扩展性** | 可调用 | 可导入和定制 |

## ✨ 核心特性总结

### 1. 完整的代码复用
- ✓ 直接导入现有的检测函数
- ✓ 避免重复编写算法
- ✓ 保证一致性

### 2. 真实时间管理
- ✓ 基于系统时间，不依赖帧数
- ✓ 时间轴连续，即使循环图片
- ✓ 支持任意采样频率

### 3. 完整的占座监控
- ✓ 自动记录"有物无人"状态的开始时间
- ✓ 自动计算持续时长
- ✓ 支持实时查询违规信息

### 4. 鲁棒的消抖处理
- ✓ 消除人影走动等干扰
- ✓ 保证座位状态的稳定性
- ✓ 提高检测精度

### 5. 灵活的配置接口
- ✓ 丰富的命令行参数
- ✓ 易于 Python 模块导入
- ✓ 支持 Node.js python-shell 集成

## 📖 文档清单

| 文档 | 用途 |
|------|------|
| `INSTALLATION_GUIDE.md` | 完整安装指南、使用方法、示例代码 |
| `SIMULATE_IMAGES_USAGE.md` | 详细功能说明、API 文档 |
| `QUICK_REFERENCE.md` | 快速查询、常用命令、故障排除 |
| `README.md`（本文件） | 项目总结和概览 |

## 🎓 学习资源

### 快速入门
1. 阅读 `QUICK_REFERENCE.md`
2. 运行 `python simulate_images.py --max-iterations 5`
3. 查看输出结果

### 深入学习
1. 阅读 `INSTALLATION_GUIDE.md`
2. 研究 `simulate_images.py` 源码
3. 尝试 Python 集成示例

### 故障排除
- 参考 `QUICK_REFERENCE.md` 中的"常见错误与解决"
- 检查依赖安装是否完整
- 验证输入文件路径是否正确

## 🔍 验证清单

- [x] simulate_images.py 创建成功
- [x] 正确导入 detect_seat_states 函数
- [x] 正确导入 bottom_in_box 和 merge_person_detections
- [x] ImageSimulator 类完整实现
- [x] 图片轮询机制正常工作
- [x] 系统真实时间管理实现
- [x] 占座计时逻辑完善
- [x] 消抖处理集成
- [x] 命令行接口完整
- [x] 文档编写完整
- [x] 代码无语法错误
- [x] 依赖列表完整

## 📝 后续可能的扩展

1. **可视化功能**
   - 在图片上绘制座位框和检测结果
   - 实时显示被占座位信息

2. **数据库集成**
   - 将结果存储到数据库
   - 支持历史查询

3. **告警功能**
   - 长期占座告警
   - 异常行为检测

4. **性能优化**
   - GPU 并行处理
   - 批量检测

5. **Web API**
   - RESTful 接口
   - WebSocket 实时推送

## 🎉 项目完成

✅ **所有需求已实现**

- 创建了功能完整的 `simulate_images.py` 脚本
- 实现了 `ImageSimulator` 类，包含所有核心功能
- 完成了代码复用，避免重复编写
- 实现了基于系统真实时间的时间轴管理
- 完成了占座计时逻辑的设计和实现
- 集成了消抖处理机制
- 编写了完整的文档和使用指南

可以开始使用该脚本进行座位监控模拟了！


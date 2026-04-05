# Library Occupied

图书馆占座检测与座位管理系统（前后端 + Python 视觉检测）。

## 1. 项目简介

本项目用于实现：

- 用户注册登录、预约座位、查看通知
- 用户举报异常占座
- 管理员座位识别（从视频自动识别座位框）
- 管理员占座检测（基于视频 + 模型识别并回写状态）

## 2. 技术栈

- 前端：React 18、React Router、Axios
- 后端：Node.js、Express、MySQL2、JWT
- 视觉检测：Python、OpenCV、Ultralytics YOLO

## 3. 目录说明

```text
library_occupied/
	backend/
		config/                # 数据库连接
		modules/               # 模型目录（必须）
		python_scripts/        # Python 检测脚本 + 结果文件
		routes/                # 业务路由（auth/seats/reserve/reports）
		schema.sql             # 建表脚本
		update_seats.sql       # 座位更新脚本
		server.js              # 后端入口
	frontend/
		src/components/        # 页面与业务组件
		src/services/api.js    # 前端 API 封装
```

## 4. 环境要求

- Node.js 18+
- npm 9+
- Python 3.9+（建议 3.10/3.11）
- MySQL 8.x（或兼容版本）

## 5. 模型文件放置（重要）

请将模型文件放到：`backend/modules/`

建议包含以下文件：

- `seat_best.pt`（座位检测）
- `best.pt`（人体检测）
- `yolov8n.pt`（物品/通用检测）

默认代码已统一从 `backend/modules` 读取模型。

## 6. 数据库初始化

1. 在 MySQL 中创建数据库（默认名：`library_seat_system`）
2. 执行：`backend/schema.sql`
3. 如需更新座位数据，可执行：`backend/update_seats.sql`

## 7. 后端配置

后端通过环境变量读取数据库与运行参数。可在 `backend` 目录创建 `.env`：

```env
PORT=5000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=library_seat_system

# 可选：Python 解释器路径（不填则使用系统 python）
PYTHON_PATH=

# 可选：默认测试视频路径
DEFAULT_TEST_VIDEO=D:\\third_year_of_university\\project\\2\\library_occupied\\v1.mp4

# 可选：模型覆盖（不填则默认 backend/modules）
SEAT_DETECT_MODEL=
PERSON_DETECT_MODEL=
ITEM_DETECT_MODEL=

# 可选：是否启用定时占座检测
ENABLE_OCCUPATION_CRON=false
```

说明：

- 代码里 `backend/config/db.js` 的默认端口是 `3007`，建议通过 `.env` 明确设置 `DB_PORT=3306`（或你的实际端口）。

## 8. 安装依赖

### 8.1 安装前后端依赖

```bash
# backend
cd backend
npm install

# frontend
cd ../frontend
npm install
```

### 8.2 安装 Python 依赖

在你的 Python 环境中执行：

```bash
pip install ultralytics opencv-python
```

如果出现依赖冲突，可再补充安装：

```bash
pip install numpy
```

## 9. 启动项目

打开两个终端：

```bash
# 终端1：启动后端
cd backend
npm run dev
```

```bash
# 终端2：启动前端
cd frontend
npm start
```

默认访问：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:5000`

## 10. 典型使用流程

1. 管理员进入管理中心，填写视频路径
2. 点击“识别座位”，生成候选座位框
3. 调整并确认座位框，保存到数据库与 `seats.json`
4. 运行“占座检测”，生成检测视频并更新占座结果
5. 用户端查看座位状态、预约、举报

## 10.1 模型 Web API 封装说明（可用 Postman 测试）

“独立训练的模型需按照 Web API 格式进行封装”的意思是：

- 不直接让前端或人工运行 Python 脚本
- 通过 HTTP 接口调用模型能力
- 输入输出统一用 JSON
- 接口可被 Postman、前端、第三方系统直接调用

当前项目已提供模型接口（后端启动后可直接测试）：

- GET /api/model/health
- POST /api/model/seat-detect
- POST /api/model/occupation-detect

统一返回格式：

- 成功：{ "code": 0, "message": "...", "data": { ... } }
- 失败：{ "code": 500, "message": "...", "error": { ... } }

Postman 测试示例：

1. 健康检查
	 - Method: GET
	 - URL: http://localhost:5000/api/model/health

2. 座位识别
	 - Method: POST
	 - URL: http://localhost:5000/api/model/seat-detect
	 - Body(JSON):
		 {
			 "videoPath": "D:/libary_occupied/v1.mp4",
			 "frame": 0
		 }

3. 占座识别
	 - Method: POST
	 - URL: http://localhost:5000/api/model/occupation-detect
	 - Body(JSON):
		 {
			 "videoPath": "D:/libary_occupied/v1.mp4",
			 "area": "A区",
			 "maxFrames": 300
		 }

## 11. 常见问题排查

### 11.1 模型找不到

- 确认 `backend/modules` 下存在 `seat_best.pt`、`best.pt`、`yolov8n.pt`
- 或在 `.env` 显式设置 `SEAT_DETECT_MODEL` / `PERSON_DETECT_MODEL` / `ITEM_DETECT_MODEL`

### 11.2 视频无法打开

- 前端填写的 `videoPath` 必须是运行后端机器可访问到的本地路径
- 建议先用项目根目录下的 `v1.mp4` 验证流程

### 11.3 ESLint/Jest 插件报错

若前端报插件加载异常，优先清理重装：

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

Windows PowerShell 可用：

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm.cmd install
```

### 11.4 数据库连接失败

- 检查 `.env` 中 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`
- 确认 MySQL 已启动，并允许该用户连接

## 12. 组员交接清单

发给组员时请同时提供：

- 项目源码（本仓库）
- `backend/modules` 模型文件
- 数据库初始化 SQL（`schema.sql`）
- `.env` 示例（去除敏感信息）

做到以上 4 项，组员通常可直接运行。
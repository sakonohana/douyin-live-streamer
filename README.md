# 抖音直播转播系统

这是一个可以转播抖音直播间页面的应用程序，包括服务端和客户端两部分。

## 功能特点

- 接收抖音直播间URL并提取直播流
- 使用ffmpeg处理和转码直播流
- 通过React前端界面观看转播内容
- 支持WebSocket实时通信
- 简洁美观的用户界面

## 技术栈

### 服务端
- Node.js
- Express.js
- Puppeteer (用于提取直播流URL)
- Socket.IO
- fluent-ffmpeg

### 客户端
- React.js
- Ant Design
- React Player
- Axios
- Socket.IO Client

## 安装和使用

### 前提条件
- Node.js (版本 >= 14)
- npm 或 yarn
- ffmpeg 命令行工具

### 服务端安装
```bash
cd server
npm install
```

### 客户端安装
```bash
cd client
npm install
```

### 启动服务端
```bash
cd server
npm start
```

### 启动客户端
```bash
cd client
npm start
```

客户端应用将在 http://localhost:3000 运行，服务端将在 http://localhost:3001 运行。

## 使用方法

1. 打开客户端应用 (http://localhost:3000)
2. 在输入框中粘贴抖音直播间链接
3. 点击"开始转播"按钮
4. 等待系统提取直播流并开始播放
5. 播放结束后点击"停止转播"按钮

## 注意事项

- 本应用仅供学习和研究使用
- 请遵守抖音平台的用户协议和相关法律法规
- 未经授权转播直播内容可能侵犯版权，请确保获得合法授权
- 由于抖音可能会更新其页面结构，提取直播流的方法可能需要随时更新

## 许可证

MIT 
# FFmpeg 安装指南

本项目使用FFmpeg进行视频转码，以提高视频兼容性。如果您遇到 `Cannot find ffmpeg` 错误，请按照以下步骤安装FFmpeg。

## Windows 安装方法

1. **下载FFmpeg**
   - 访问 [FFmpeg官方网站](https://ffmpeg.org/download.html) 或 [GitHub发布页](https://github.com/BtbN/FFmpeg-Builds/releases)
   - 下载适合Windows的版本（推荐 "ffmpeg-master-latest-win64-gpl.zip"）

2. **解压文件**
   - 将下载的zip文件解压到您选择的目录，如 `D:\ffmpeg`
   - 确保bin目录可访问，如 `D:\ffmpeg\bin`

3. **设置环境变量** (方法1 - 推荐)
   - 右键点击"此电脑"，选择"属性"
   - 点击"高级系统设置"
   - 点击"环境变量"按钮
   - 在"系统变量"下找到"Path"变量并选择"编辑"
   - 点击"新建"并添加FFmpeg的bin目录路径（如 `D:\ffmpeg\bin`）
   - 点击"确定"保存更改
   - 重启命令提示符或PowerShell窗口以使更改生效

4. **指定程序中的FFmpeg路径** (方法2)
   - 如果不希望修改系统环境变量，可以直接在代码中指定FFmpeg路径
   - 编辑 `server/index.js` 文件，找到以下行并修改为您的实际路径:
   ```javascript
   const FFMPEG_PATH = 'D:/ffmpeg/bin/ffmpeg.exe'; // 修改为实际路径
   const FFPROBE_PATH = 'D:/ffmpeg/bin/ffprobe.exe'; // 修改为实际路径
   ```

5. **验证安装**
   - 打开命令提示符或PowerShell
   - 输入 `ffmpeg -version`
   - 如果显示版本信息，表示安装成功

## Mac OS 安装方法

1. 使用Homebrew安装:
   ```bash
   brew install ffmpeg
   ```

2. 验证安装:
   ```bash
   ffmpeg -version
   ```

## Linux 安装方法

### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install ffmpeg
```

### CentOS/RHEL:
```bash
sudo yum install epel-release
sudo yum install ffmpeg ffmpeg-devel
```

### 验证安装:
```bash
ffmpeg -version
```

## 安装后操作

安装FFmpeg后，请重启应用服务器以确保更改生效。 
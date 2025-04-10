import React, { useState, useEffect } from 'react';
import { Input, Button, Card, message, Layout, Typography, Spin, Radio, Tooltip, Alert, Modal } from 'antd';
import ReactPlayer from 'react-player';
import axios from 'axios';
import { io } from 'socket.io-client';

const { Header, Content, Footer } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Search } = Input;

// 服务器地址
const SERVER_URL = 'http://localhost:3001';

/**
 * 抖音直播转播前端应用
 */
function App() {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [originalStreamUrl, setOriginalStreamUrl] = useState('');
  const [transcodedStreamUrl, setTranscodedStreamUrl] = useState('');
  const [activeStreamUrl, setActiveStreamUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [streamSource, setStreamSource] = useState('original'); // 默认使用原始流
  const [playbackError, setPlaybackError] = useState(false);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);
  const [ffmpegHelpVisible, setFfmpegHelpVisible] = useState(false);
  const [serverError, setServerError] = useState('');
  const [isTestVideo, setIsTestVideo] = useState(false); // 是否为测试视频
  const [testVideoHelpVisible, setTestVideoHelpVisible] = useState(false); // 显示测试视频帮助

  // 初始化WebSocket连接
  useEffect(() => {
    const newSocket = io(SERVER_URL);
    
    newSocket.on('connect', () => {
      console.log('WebSocket连接成功');
      setConnected(true);
    });
    
    newSocket.on('disconnect', () => {
      console.log('WebSocket连接断开');
      setConnected(false);
    });
    
    newSocket.on('stream-ready', (data) => {
      console.log('收到直播流地址:', data);
      
      // 优化测试视频检测逻辑，确保更准确
      // 测试视频的URL通常包含 'douyin-pc-web/uuu_' 标识
      const isTestUrl = data.streamUrl && typeof data.streamUrl === 'string' && 
                         data.streamUrl.includes('douyin-pc-web/uuu_');
      
      setIsTestVideo(isTestUrl);
      
      // 只有确认是测试视频时才显示警告
      if (isTestUrl) {
        // 显示测试视频警告
        message.warning('检测到返回的视频可能是抖音测试视频，而非真实直播流');
        
        // 自动显示帮助对话框
        setTimeout(() => {
          setTestVideoHelpVisible(true);
        }, 1000);
      }
      
      setOriginalStreamUrl(data.streamUrl);
      setTranscodedStreamUrl(data.transcodedUrl || '');
      setSessionId(data.sessionId || '');
      setFfmpegAvailable(data.ffmpegAvailable || false);
      setServerError(data.error || '');
      
      // 如果FFmpeg不可用，强制使用原始流
      if (!data.ffmpegAvailable) {
        setStreamSource('original');
        setActiveStreamUrl(data.streamUrl);
        
        // 显示FFmpeg安装帮助对话框
        setFfmpegHelpVisible(true);
      } else {
        // 默认使用原始流
        setActiveStreamUrl(data.streamUrl);
        setStreamSource('original');
      }
      
      setLoading(false);
      setPlaybackError(false);
    });
    
    newSocket.on('error', (data) => {
      message.error(data.message || '发生错误');
      setLoading(false);
    });
    
    setSocket(newSocket);
    
    // 组件卸载时清理WebSocket连接
    return () => {
      newSocket.disconnect();
    };
  }, []); // 移除streamSource依赖

  /**
   * 开始转播直播
   * @param {string} url - 抖音直播链接
   */
  const startStream = async (url) => {
    try {
      setLoading(true);
      setPlaybackError(false);
      setServerError('');
      setIsTestVideo(false); // 重置测试视频状态
      
      if (!url) {
        message.warning('请输入抖音直播间链接');
        setLoading(false);
        return;
      }
      
      // 验证URL是否是抖音直播链接
      if (!url.includes('douyin.com') && !url.includes('tiktok.com')) {
        if (!url.includes('http')) {
          url = 'https://' + url;
        }
        // 确保URL指向直播间
        if (!url.includes('/live/')) {
          message.error('请输入有效的抖音直播间链接，例如: https://live.douyin.com/123456');
          setLoading(false);
          return;
        }
      }
      
      if (connected && socket) {
        // 使用WebSocket请求直播流
        socket.emit('join-stream', { url });
      } else {
        // 使用REST API请求直播流
        const response = await axios.post(`${SERVER_URL}/api/start-stream`, { url });
        
        if (response.data.success) {
          // 优化测试视频检测逻辑，确保更准确
          const isTestUrl = response.data.streamUrl && typeof response.data.streamUrl === 'string' && 
                            response.data.streamUrl.includes('douyin-pc-web/uuu_');
          
          setIsTestVideo(isTestUrl);
          
          // 只有确认是测试视频时才显示警告
          if (isTestUrl) {
            // 显示测试视频警告
            message.warning('检测到返回的视频可能是抖音测试视频，而非真实直播流');
            
            // 自动显示帮助对话框
            setTimeout(() => {
              setTestVideoHelpVisible(true);
            }, 1000);
          }
          
          setOriginalStreamUrl(response.data.streamUrl);
          setTranscodedStreamUrl(response.data.transcodedUrl || '');
          setSessionId(response.data.sessionId);
          setFfmpegAvailable(response.data.ffmpegAvailable || false);
          setServerError(response.data.error || '');
          
          // 如果FFmpeg不可用，强制使用原始流
          if (!response.data.ffmpegAvailable) {
            setStreamSource('original');
            setActiveStreamUrl(response.data.streamUrl);
            
            // 显示FFmpeg安装帮助对话框
            setFfmpegHelpVisible(true);
          } else {
            // 默认使用原始流
            setActiveStreamUrl(response.data.streamUrl);
            setStreamSource('original');
          }
          
          // 根据是否为测试视频显示不同提示
          if (isTestUrl) {
            message.warning('已开始转播（测试视频）');
          } else {
            message.success('直播转播已启动');
          }
        } else {
          message.error(response.data.error || '直播转播启动失败');
        }
        
        setLoading(false);
      }
    } catch (error) {
      console.error('启动直播转播失败:', error);
      message.error(error.response?.data?.error || '无法连接到抖音直播间');
      setLoading(false);
    }
  };

  /**
   * 切换视频源
   * @param {event} e - 事件对象
   */
  const handleSourceChange = (e) => {
    // 如果FFmpeg不可用，禁止切换到转码流
    if (!ffmpegAvailable && e.target.value === 'transcoded') {
      message.warning('FFmpeg未安装，无法使用转码流');
      return;
    }
    
    const newSource = e.target.value;
    setStreamSource(newSource);
    
    if (newSource === 'original' && originalStreamUrl) {
      setActiveStreamUrl(originalStreamUrl);
      message.info('已切换到原始流');
    } else if (newSource === 'transcoded' && transcodedStreamUrl) {
      setActiveStreamUrl(transcodedStreamUrl);
      message.info('已切换到转码流');
    }
  };

  /**
   * 视频播放错误处理
   * @param {error} error - 错误对象
   */
  const handlePlayerError = (error) => {
    console.error('视频播放错误:', error);
    setPlaybackError(true);
    
    // 如果当前使用的是原始流且播放失败，且FFmpeg可用，自动切换到转码流
    if (streamSource === 'original' && transcodedStreamUrl && ffmpegAvailable) {
      message.info('原始流播放失败，正在自动切换到转码流以提高兼容性');
      setStreamSource('transcoded');
      setActiveStreamUrl(transcodedStreamUrl);
      setPlaybackError(false);
    } else if (streamSource === 'transcoded' && originalStreamUrl) {
      message.warning('转码流播放失败，请尝试手动切换到原始流或检查网络连接');
    }
  };

  /**
   * 停止转播直播
   */
  const stopStream = async () => {
    if (!sessionId) {
      setOriginalStreamUrl('');
      setTranscodedStreamUrl('');
      setActiveStreamUrl('');
      return;
    }
    
    try {
      await axios.post(`${SERVER_URL}/api/stop-stream/${sessionId}`);
      message.success('直播转播已停止');
      setOriginalStreamUrl('');
      setTranscodedStreamUrl('');
      setActiveStreamUrl('');
      setSessionId('');
      setPlaybackError(false);
      setServerError('');
      setIsTestVideo(false);
    } catch (error) {
      console.error('停止直播转播失败:', error);
      message.error('停止直播转播失败');
    }
  };

  /**
   * 关闭FFmpeg帮助对话框
   */
  const handleCloseFFmpegHelp = () => {
    setFfmpegHelpVisible(false);
  };

  /**
   * 关闭测试视频帮助对话框
   */
  const handleCloseTestVideoHelp = () => {
    setTestVideoHelpVisible(false);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 20px' }}>
        <Title level={3} style={{ margin: '16px 0' }}>抖音直播转播系统</Title>
      </Header>
      
      <Content style={{ padding: '20px 50px' }}>
        {/* 只在确认为测试视频时显示警告 */}
        {isTestVideo && (
          <Alert
            message="检测到测试视频"
            description={
              <div>
                <p>抖音返回了测试视频而非真实直播流，可能是由于抖音的反爬虫措施。</p>
                <Button type="link" onClick={() => setTestVideoHelpVisible(true)}>
                  如何解决?
                </Button>
              </div>
            }
            type="warning"
            showIcon
            closable
            style={{ marginBottom: 20 }}
          />
        )}
        
        {!ffmpegAvailable && (
          <Alert
            message="FFmpeg未安装或无法找到"
            description={
              <div>
                <p>转码功能不可用。目前只能使用原始流，可能在某些浏览器中无法正常播放。</p>
                <Button type="link" onClick={() => setFfmpegHelpVisible(true)}>
                  如何安装FFmpeg?
                </Button>
              </div>
            }
            type="warning"
            showIcon
            closable
            style={{ marginBottom: 20 }}
          />
        )}
        
        {serverError && (
          <Alert
            message="服务器错误"
            description={`处理视频流时出错: ${serverError}`}
            type="error"
            showIcon
            closable
            style={{ marginBottom: 20 }}
          />
        )}
        
        <Card title="转播控制面板" style={{ width: '100%', marginBottom: 20 }}>
          <Search
            placeholder="请输入抖音直播间链接 (例如: https://live.douyin.com/123456)"
            enterButton="开始转播"
            size="large"
            loading={loading}
            onSearch={startStream}
            style={{ marginBottom: 20 }}
          />
          
          <Button 
            type="primary" 
            danger 
            disabled={!activeStreamUrl} 
            onClick={stopStream}
            style={{ marginBottom: 20 }}
          >
            停止转播
          </Button>
          
          {(originalStreamUrl || transcodedStreamUrl) && (
            <div style={{ marginBottom: 20 }}>
              <Radio.Group 
                value={streamSource} 
                onChange={handleSourceChange}
                buttonStyle="solid"
              >
                <Tooltip title="原始流可能在某些浏览器无法播放">
                  <Radio.Button value="original">原始流</Radio.Button>
                </Tooltip>
                <Tooltip title={ffmpegAvailable ? "转码流提供更好的兼容性" : "FFmpeg未安装，此选项不可用"}>
                  <Radio.Button value="transcoded" disabled={!ffmpegAvailable}>转码流</Radio.Button>
                </Tooltip>
              </Radio.Group>
            </div>
          )}
          
          <div>
            <Text type="secondary">
              WebSocket状态: {connected ? '已连接' : '未连接'}
            </Text>
          </div>
        </Card>
        
        {loading && (
          <div style={{ textAlign: 'center', margin: '50px 0' }}>
            <Spin size="large" tip="正在获取直播流..." />
          </div>
        )}
        
        {activeStreamUrl && (
          <Card 
            title={
              <div>
                直播画面
                {playbackError && streamSource === 'original' && ffmpegAvailable && (
                  <Text type="warning" style={{ marginLeft: 10 }}>
                    原始流播放失败，已自动切换到转码流
                  </Text>
                )}
                {playbackError && streamSource === 'transcoded' && (
                  <Text type="danger" style={{ marginLeft: 10 }}>
                    转码流播放失败，请尝试切换到原始流
                  </Text>
                )}
                {playbackError && streamSource === 'original' && !ffmpegAvailable && (
                  <Text type="danger" style={{ marginLeft: 10 }}>
                    播放失败，请检查网络连接或更换浏览器
                  </Text>
                )}
                {!playbackError && (
                  <Text type="success" style={{ marginLeft: 10 }}>
                    {streamSource === 'original' ? '(原始流播放中)' : '(转码流播放中)'}
                  </Text>
                )}
                {isTestVideo && <Text type="warning" style={{ marginLeft: 10 }}>（测试视频，非真实直播）</Text>}
              </div>
            } 
            style={{ width: '100%' }}
          >
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <ReactPlayer
                url={activeStreamUrl}
                playing
                controls
                width="100%"
                height="100%"
                style={{ position: 'absolute', top: 0, left: 0 }}
                onError={handlePlayerError}
                config={{
                  file: {
                    attributes: {
                      crossOrigin: 'anonymous',
                      controlsList: 'nodownload'
                    },
                    forceVideo: true
                  }
                }}
              />
            </div>
          </Card>
        )}
        
        {/* FFmpeg安装帮助对话框 */}
        <Modal
          title="如何安装FFmpeg"
          open={ffmpegHelpVisible}
          onOk={handleCloseFFmpegHelp}
          onCancel={handleCloseFFmpegHelp}
          footer={[
            <Button key="close" type="primary" onClick={handleCloseFFmpegHelp}>
              我知道了
            </Button>
          ]}
        >
          <Paragraph>
            FFmpeg是一个强大的视频处理工具，用于转码视频格式，提高视频兼容性。
          </Paragraph>
          
          <Title level={4}>Windows安装方法：</Title>
          <ol>
            <li>访问 <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer">FFmpeg官方网站</a> 或 <a href="https://github.com/BtbN/FFmpeg-Builds/releases" target="_blank" rel="noopener noreferrer">GitHub发布页</a> 下载Windows版本</li>
            <li>解压到指定目录，例如 <Text code>D:\ffmpeg</Text></li>
            <li>将 <Text code>D:\ffmpeg\bin</Text> 添加到系统环境变量Path中</li>
            <li>重启应用程序</li>
          </ol>
          
          <Title level={4}>或者在服务器代码中指定FFmpeg路径：</Title>
          <Paragraph>
            在server/index.js文件中编辑以下变量，指向您的FFmpeg安装路径：
            <pre style={{ background: '#f0f0f0', padding: 10 }}>
              {`const FFMPEG_PATH = 'D:/ffmpeg/bin/ffmpeg.exe'; // 修改为实际路径
const FFPROBE_PATH = 'D:/ffmpeg/bin/ffprobe.exe'; // 修改为实际路径`}
            </pre>
          </Paragraph>
        </Modal>
        
        {/* 测试视频帮助对话框 */}
        <Modal
          title="为什么会看到测试视频？"
          open={testVideoHelpVisible}
          onOk={handleCloseTestVideoHelp}
          onCancel={handleCloseTestVideoHelp}
          footer={[
            <Button key="close" type="primary" onClick={handleCloseTestVideoHelp}>
              我知道了
            </Button>
          ]}
        >
          <Paragraph>
            抖音的直播页面有反爬虫机制，当检测到非正常用户访问时，会返回测试视频而不是真实的直播流。
          </Paragraph>
          
          <Title level={4}>可能的解决方法：</Title>
          <ol>
            <li>
              <Text strong>确保输入正确的直播链接</Text>
              <Paragraph>
                直播链接应该类似于：https://live.douyin.com/123456
              </Paragraph>
            </li>
            <li>
              <Text strong>手动访问直播链接</Text>
              <Paragraph>
                使用浏览器手动访问直播链接，并通过浏览器开发者工具获取真实的直播流地址：
                <ol>
                  <li>打开抖音直播页面</li>
                  <li>右键点击页面，选择"检查"或按F12打开开发者工具</li>
                  <li>切换到"网络"(Network)标签页</li>
                  <li>在过滤器中输入"m3u8"或"flv"</li>
                  <li>刷新页面并观察网络请求</li>
                  <li>找到直播流地址(通常以.m3u8或.flv结尾)</li>
                </ol>
              </Paragraph>
            </li>
            <li>
              <Text strong>使用其他平台</Text>
              <Paragraph>
                如果您是开发者，可以考虑使用具有公开API的平台，如Twitch或YouTube Live。
              </Paragraph>
            </li>
            <li>
              <Text strong>检查直播状态</Text>
              <Paragraph>
                确保直播确实在进行中。如果直播未开始或已结束，系统也可能返回测试视频。
              </Paragraph>
            </li>
          </ol>
          
          <Alert
            message="注意：直播平台可能不允许未经授权的转播"
            description="在使用此工具前，请确保您遵守抖音的服务条款和相关法律法规。未经授权转播他人直播内容可能侵犯版权。"
            type="info"
            showIcon
          />
        </Modal>
      </Content>
      
      <Footer style={{ textAlign: 'center' }}>
        抖音直播转播系统 © {new Date().getFullYear()} Created by YUAN
      </Footer>
    </Layout>
  );
}

export default App; 
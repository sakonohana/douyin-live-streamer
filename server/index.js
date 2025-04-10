/**
 * 抖音直播转播服务
 * 
 * 该服务实现以下功能：
 * 1. 接收抖音直播间URL
 * 2. 使用Puppeteer获取直播流地址
 * 3. 使用ffmpeg进行转码
 * 4. 通过WebSocket实时推送直播内容
 */

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os'); // 引入操作系统模块，用于检测操作系统类型

// 获取当前操作系统类型
const isWindows = os.platform() === 'win32';

// FFmpeg配置
// 系统会首先尝试使用环境变量中的FFmpeg，如果不存在则使用默认路径
// 默认路径根据操作系统类型自动选择
const DEFAULT_FFMPEG_PATH = isWindows 
  ? 'D:/ffmpeg/bin/ffmpeg.exe'  // Windows路径
  : '/usr/bin/ffmpeg';          // Linux/Mac路径

const DEFAULT_FFPROBE_PATH = isWindows
  ? 'D:/ffmpeg/bin/ffprobe.exe' // Windows路径
  : '/usr/bin/ffprobe';         // Linux/Mac路径

// 优先使用环境变量中设置的路径，否则使用默认路径
const FFMPEG_PATH = process.env.FFMPEG_PATH || DEFAULT_FFMPEG_PATH;
const FFPROBE_PATH = process.env.FFPROBE_PATH || DEFAULT_FFPROBE_PATH;

// 检查FFmpeg路径是否存在，如果存在则设置路径
if (fs.existsSync(FFMPEG_PATH)) {
  console.log(`使用自定义FFmpeg路径: ${FFMPEG_PATH}`);
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
}

if (fs.existsSync(FFPROBE_PATH)) {
  console.log(`使用自定义FFprobe路径: ${FFPROBE_PATH}`);
  ffmpeg.setFfprobePath(FFPROBE_PATH);
}

// 检查FFmpeg是否可用
let ffmpegAvailable = false;
try { 
  // 尝试执行ffmpeg命令检查可用性
  // 如果自定义路径存在则使用，否则尝试使用环境变量中的ffmpeg命令
  const cmd = require('child_process').spawnSync(
    fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg', 
    ['-version']
  );
  if (cmd.status === 0) {
    ffmpegAvailable = true;
    console.log('FFmpeg 可用，版本信息：', cmd.stdout.toString().split('\n')[0]);
  }
} catch (e) {
  console.warn('FFmpeg 不可用，转码功能将被禁用:', e.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 中间件
app.use(cors());
app.use(express.json());

// 存储活跃直播会话
const activeLiveStreams = new Map();

/**
 * 从抖音直播页面提取直播流URL
 * @param {string} douyinUrl - 抖音直播间URL
 * @returns {Promise<string>} 直播流URL
 */
async function extractLiveStreamUrl(douyinUrl) {
  console.log('正在尝试提取直播流地址...');
  
  // 验证URL格式，确保是抖音直播链接
  if (!douyinUrl.includes('douyin.com') && !douyinUrl.includes('tiktok.com')) {
    if (!douyinUrl.includes('http')) {
      douyinUrl = 'https://' + douyinUrl;
    }
    // 确保URL指向直播间
    if (!douyinUrl.includes('/live/')) {
      throw new Error('链接格式不正确，请提供有效的抖音直播间链接');
    }
  }
  
  // 获取可用的用户代理列表，随机选择一个，模拟真实浏览器
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  const browser = await puppeteer.launch({
    headless: "new", // 使用新的headless模式
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled', // 禁用自动化控制检测
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--lang=zh-CN,zh' // 设置中文语言环境
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });
  
  try {
    // 创建隐身模式上下文，避免使用任何已保存数据
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    
    // 修改WebDriver相关标记，避免被检测为自动化工具
    await page.evaluateOnNewDocument(() => {
      // 重写navigator.webdriver属性，防止被检测为自动化浏览器
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // 移除window.navigator.chrome.runtime，这是自动化检测的一个标志
      if (window.navigator.chrome) {
        window.navigator.chrome = {};
      }
      
      // 添加浏览器特征以模拟真实环境
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // 模拟WebGL
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // 使用UNMASKED_VENDOR_WEBGL和UNMASKED_RENDERER_WEBGL模拟真实显卡信息
        if (parameter === 37445) {
          return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
        }
        if (parameter === 37446) {
          return 'Intel Iris Graphics 6100'; // UNMASKED_RENDERER_WEBGL
        }
        return getParameter.apply(this, arguments);
      };
      
      // 添加更多浏览器插件，使浏览器特征更真实
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          return [
            {
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              name: "Chrome PDF Plugin"
            },
            {
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              name: "Chrome PDF Viewer"
            },
            {
              description: "Microsoft Edge PDF Viewer",
              filename: "internal-pdf-viewer",
              name: "Microsoft Edge PDF Viewer"
            }
          ];
        },
      });
    });
    
    // 设置用户代理，模拟真实浏览器环境
    await page.setUserAgent(randomUserAgent);
    
    // 设置屏幕和窗口尺寸以模拟真实浏览环境
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });
    
    // 设置语言和地区偏好头以模拟中国用户
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-User': '?1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Ch-Ua': '"Chromium";v="122", "Google Chrome";v="122", "Not(A:Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    });
    
    // 设置超时时间更长
    await page.setDefaultNavigationTimeout(60000);
    
    // 减少拦截，只拦截媒体文件和广告类资源
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      
      // 只拦截广告或分析类资源，允许大部分资源加载
      if (
        url.includes('analytics') || 
        url.includes('tracker') ||
        url.includes('advertisement') ||
        url.includes('doubleclick.net')
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // 监听控制台输出，帮助调试
    page.on('console', msg => console.log('浏览器控制台:', msg.text()));
    
    // 保存媒体请求，用于后续分析
    const mediaRequests = [];
    const liveStreamRequests = [];
    
    // 监听网络请求，查找可能的视频流URL
    page.on('request', request => {
      const url = request.url();
      if (
        url.includes('.m3u8') || 
        url.includes('.flv') || 
        url.includes('.mp4') ||
        url.includes('/stream/') ||
        url.includes('/live/') ||
        url.includes('/play/')
      ) {
        if (!url.includes('douyin-pc-web/uuu_')) { // 排除测试视频
          if (url.includes('.m3u8') || url.includes('.flv')) {
            liveStreamRequests.push(url); // 可能的直播流
          } else {
            mediaRequests.push(url); // 其他媒体请求
          }
        }
      }
    });
    
    // 随机模拟常见移动痕迹
    async function simulateHumanBehavior() {
      // 随机移动鼠标到页面的不同区域
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(Math.random() * 1000);
        const y = Math.floor(Math.random() * 600);
        await page.mouse.move(x, y, { steps: 10 });
        await page.waitForTimeout(Math.random() * 1000 + 500);
      }
      
      // 随机滚动页面
      await page.evaluate(() => {
        const scrollHeight = Math.floor(Math.random() * 500);
        window.scrollTo(0, scrollHeight);
        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 500);
      });
      
      await page.waitForTimeout(1000);
      
      // 模拟用户鼠标悬停在视频播放器上
      await page.evaluate(() => {
        const videoElements = document.querySelectorAll('video, .player-container, .video-player, .webcast-video');
        if (videoElements.length > 0) {
          // 创建并触发鼠标悬停事件
          const element = videoElements[0];
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          const hoverEvent = new MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: centerX,
            clientY: centerY
          });
          element.dispatchEvent(hoverEvent);
        }
      });
    }
    
    console.log('正在访问抖音直播间页面...');
    
    // 添加cookie以模拟已登录状态，这里使用空值作为示例
    await page.setCookie({
      name: 'sessionid_ss',
      value: '',
      domain: '.douyin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });
    
    // 访问页面
    await page.goto(douyinUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    console.log('页面加载完成，准备查找视频元素');
    
    // 模拟人类用户交互行为
    console.log('模拟用户互动...');
    await simulateHumanBehavior();
    
    // 先滚动页面以触发懒加载资源
    await page.evaluate(() => {
      window.scrollTo(0, 300);
      setTimeout(() => window.scrollTo(0, 0), 300);
    });
    
    // 模拟鼠标移动
    await page.mouse.move(Math.random() * 1000, Math.random() * 600);
    
    // 等待更长时间，让页面完全加载
    await page.waitForTimeout(8000);
    
    // 尝试点击可能的播放按钮和同意提示
    try {
      await page.evaluate(() => {
        // 查找并点击同意条款按钮
        const agreeButtons = document.querySelectorAll('[class*="agree"], [class*="consent"], [class*="allow"], [class*="accept"]');
        for (const button of agreeButtons) {
          if (button.offsetWidth > 0 && button.offsetHeight > 0) {
            button.click();
          }
        }
        
        // 尝试查找并点击各种可能的播放按钮
        const playButtons = document.querySelectorAll('button, [role="button"], .play-button, .xgplayer-play, .xgplayer-start, [class*="play"], [aria-label*="播放"]');
        if (playButtons.length > 0) {
          for (const button of playButtons) {
            if (button.offsetWidth > 0 && button.offsetHeight > 0) { // 只点击可见元素
              button.click();
            }
          }
        }
        
        // 点击视频区域，可能会触发播放
        const videoContainers = document.querySelectorAll('.video-container, .player-container, .webcast-video');
        if (videoContainers.length > 0) {
          videoContainers[0].click();
        }
      });
    } catch (e) {
      console.log('尝试点击播放按钮时出错:', e.message);
    }
    
    // 等待视频加载并开始播放
    await page.waitForTimeout(10000);
    
    // 再次模拟人类行为
    await simulateHumanBehavior();
    
    // 查找页面中可能的媒体元素
    console.log('正在查找视频元素和媒体资源...');
    
    // 扩展视频元素选择器范围
    const videoSelectors = [
      'video',
      '.video-player video',
      '.webcast-video video',
      '[data-e2e="webcast-video"] video',
      '.xg-video video',
      '.xgplayer-video',
      '.video-player-v2 video',
      '.player-container video',
      '.live-player video',
      '.player-video video',
      'video[preload]',
      'video[autoplay]',
      'video[src]',
      '.xgplayer'
    ];
    
    let streamUrl = null;
    
    // 尝试直接从DOM中提取媒体元素
    try {
      console.log('尝试从DOM中提取视频元素...');
      
      // 检查页面中是否存在视频元素
      const hasVideo = await page.evaluate((selectors) => {
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            return true;
          }
        }
        return false;
      }, videoSelectors);
      
      if (hasVideo) {
        console.log('找到视频元素，提取视频源');
        // 提取直播流URL
        streamUrl = await page.evaluate((selectors) => {
          // 辅助函数：从对象深层提取属性
          function getDeepProperty(obj, path) {
            const parts = path.split('.');
            let current = obj;
            for (const part of parts) {
              if (current && typeof current === 'object' && part in current) {
                current = current[part];
              } else {
                return null;
              }
            }
            return current;
          }
          
          // 从视频元素中提取URL
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
              if (element && element.src && !element.src.includes('douyin-pc-web/uuu_')) {
                return element.src;
              }
              // 检查是否有dataset中的src属性
              if (element && element.dataset && element.dataset.src && !element.dataset.src.includes('douyin-pc-web/uuu_')) {
                return element.dataset.src;
              }
              // 检查currentSrc属性
              if (element && element.currentSrc && !element.currentSrc.includes('douyin-pc-web/uuu_')) {
                return element.currentSrc;
              }
            }
          }
          
          // 查找xgplayer播放器配置
          const xgplayerConfig = window.__PLAYER_CONFIG__ || window.__PLAYER_INITIAL_STATE__;
          if (xgplayerConfig) {
            // 尝试从播放器配置中提取URL
            const possiblePaths = [
              'videoInfo.url', 
              'videoData.url', 
              'playInfo.url',
              'videoData.sourceUrl',
              'sourceInfo.source',
              'stream.pull_url',
              'stream.default_quality.main.play_url',
              'streamData.stream_url',
              'video.play_url'
            ];
            
            for (const path of possiblePaths) {
              const url = getDeepProperty(xgplayerConfig, path);
              if (url && typeof url === 'string' && (url.includes('http') || url.includes('//')) && !url.includes('douyin-pc-web/uuu_')) {
                return url;
              }
            }
          }
          
          // 尝试从全局变量中提取
          const globalVars = [
            '__INIT_PROPS__',
            '__INITIAL_STATE__',
            'window.LIVE_DATA',
            'window.STREAM_CONFIG',
            'window.PAGE_DATA'
          ];
          
          for (const varName of globalVars) {
            try {
              let obj = window;
              for (const key of varName.replace('window.', '').split('.')) {
                obj = obj[key];
                if (obj === undefined) break;
              }
              
              if (obj && typeof obj === 'object') {
                // 特别针对直播间数据结构
                if (obj.roomInfo) {
                  if (obj.roomInfo.room && obj.roomInfo.room.stream_url) {
                    return obj.roomInfo.room.stream_url;
                  }
                  if (obj.roomInfo.liveUrl) return obj.roomInfo.liveUrl;
                  if (obj.roomInfo.streamUrl) return obj.roomInfo.streamUrl;
                }
                
                // 检查直播流相关字段
                const liveKeys = ['liveUrl', 'streamUrl', 'play_url', 'stream_url', 'flv_url', 'hls_url'];
                for (const key of liveKeys) {
                  if (obj[key] && typeof obj[key] === 'string' && !obj[key].includes('douyin-pc-web/uuu_')) {
                    return obj[key];
                  }
                }
                
                // 递归寻找嵌套对象中的URL
                function findMediaUrl(object, path = []) {
                  if (!object || typeof object !== 'object') return null;
                  
                  for (const key in object) {
                    const value = object[key];
                    const currentPath = [...path, key];
                    
                    if (typeof value === 'string' && 
                        (value.includes('.m3u8') || value.includes('.flv') || currentPath.some(p => liveKeys.includes(p))) && 
                        !value.includes('douyin-pc-web/uuu_')) {
                      return value;
                    }
                    
                    if (value && typeof value === 'object') {
                      const result = findMediaUrl(value, currentPath);
                      if (result) return result;
                    }
                  }
                  
                  return null;
                }
                
                const urlFromObject = findMediaUrl(obj);
                if (urlFromObject) return urlFromObject;
              }
            } catch (e) {
              console.error('解析全局变量失败', e);
            }
          }
          
          // 尝试从XHR或其他请求中获取
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent;
            if (content && (content.includes('.m3u8') || content.includes('.flv'))) {
              const matches = content.match(/(https?:\/\/[^"']+\.(m3u8|flv))/);
              if (matches && matches[1] && !matches[1].includes('douyin-pc-web/uuu_')) {
                return matches[1];
              }
            }
          }
          
          return null;
        }, videoSelectors);
      }
    } catch (e) {
      console.error('从DOM提取视频源失败:', e);
    }
    
    // 如果从DOM中找到了非测试视频，使用这个地址
    if (streamUrl && !streamUrl.includes('douyin-pc-web/uuu_')) {
      console.log('从DOM中找到了真实直播流地址');
    } else {
      // 检查之前收集的直播流请求
      if (liveStreamRequests.length > 0) {
        streamUrl = liveStreamRequests[liveStreamRequests.length - 1];
        console.log('从网络请求中发现直播流地址:', streamUrl);
      } else if (mediaRequests.length > 0) {
        streamUrl = mediaRequests[mediaRequests.length - 1];
        console.log('从网络请求中发现媒体地址:', streamUrl);
      } else {
        // 尝试分析网络请求寻找直播流
        console.log('从DOM中未找到视频源，尝试分析网络请求...');
        
        // 使用CDP会话分析网络通信
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        
        const responsePromises = [];
        
        // 分析网络响应内容
        client.on('Network.responseReceived', async response => {
          const url = response.response.url;
          const mimeType = response.response.mimeType;
          
          // 检查是否是JSON响应，可能包含媒体信息
          if (
            (mimeType.includes('json') || mimeType.includes('javascript')) && 
            (url.includes('/api/') || url.includes('/live/') || url.includes('/room/'))
          ) {
            try {
              const responseBody = await client.send('Network.getResponseBody', {
                requestId: response.requestId
              });
              
              if (responseBody.body) {
                try {
                  const data = JSON.parse(responseBody.body);
                  // 递归搜索JSON对象中可能的媒体URL
                  const findMediaUrls = (obj, paths = []) => {
                    if (!obj || typeof obj !== 'object') return [];
                    
                    let results = [];
                    
                    for (const key in obj) {
                      const value = obj[key];
                      const currentPath = [...paths, key];
                      
                      // 检查键名是否与媒体相关
                      const isMediaKey = [
                        'url', 'streamUrl', 'playUrl', 'videoUrl', 'm3u8', 'flv', 
                        'hls', 'src', 'source', 'media', 'stream_url', 'play_url'
                      ].some(k => key.toLowerCase().includes(k));
                      
                      // 检查值是否是URL
                      if (isMediaKey && typeof value === 'string' && 
                          (value.includes('http') || value.startsWith('//') || 
                           value.includes('.m3u8') || value.includes('.flv')) &&
                          !value.includes('douyin-pc-web/uuu_')) {
                        results.push({
                          url: value.startsWith('//') ? `https:${value}` : value,
                          path: currentPath.join('.')
                        });
                      }
                      
                      // 递归检查嵌套对象
                      if (value && typeof value === 'object') {
                        results = [...results, ...findMediaUrls(value, currentPath)];
                      }
                    }
                    
                    return results;
                  };
                  
                  const mediaUrls = findMediaUrls(data);
                  if (mediaUrls.length > 0) {
                    // 优先使用包含m3u8或flv的URL
                    const streamUrls = mediaUrls
                      .filter(item => !item.url.includes('douyin-pc-web/uuu_'))
                      .sort((a, b) => {
                        const aScore = (a.url.includes('.m3u8') || a.url.includes('.flv')) ? 2 : 1;
                        const bScore = (b.url.includes('.m3u8') || b.url.includes('.flv')) ? 2 : 1;
                        return bScore - aScore;
                      });
                    
                    if (streamUrls.length > 0) {
                      streamUrl = streamUrls[0].url;
                      console.log('从JSON响应中找到直播流地址:', streamUrl);
                    }
                  }
                } catch (e) {
                  console.log('解析JSON响应失败:', e.message);
                }
              }
            } catch (e) {
              console.log('获取响应体失败:', e.message);
            }
          }
        });
        
        // 等待更长时间捕获网络请求
        console.log('等待网络请求以获取直播流...');
        await page.waitForTimeout(15000);
      }
    }
    
    // 如果仍然找不到流地址或仅找到测试视频，尝试更进一步的方法
    if (!streamUrl || streamUrl.includes('douyin-pc-web/uuu_')) {
      console.log('找到的可能是测试视频，尝试更进一步的方法获取真实直播流...');
      
      // 尝试执行自定义脚本提取直播流
      try {
        const extractedUrl = await page.evaluate(() => {
          // 先访问页面上的所有iframe，查找可能包含真实视频的框架
          try {
            const frames = document.querySelectorAll('iframe');
            for (const frame of frames) {
              try {
                const frameDocument = frame.contentDocument || frame.contentWindow.document;
                const videoInFrame = frameDocument.querySelector('video');
                if (videoInFrame && videoInFrame.src && !videoInFrame.src.includes('douyin-pc-web/uuu_')) {
                  return videoInFrame.src;
                }
              } catch (e) {
                // 跨域iframe访问失败，忽略错误
              }
            }
          } catch (e) {
            console.error('检查iframe失败', e);
          }
          
          // 尝试查看网络信息
          if (window.performance && window.performance.getEntries) {
            const entries = window.performance.getEntries();
            const mediaEntries = entries.filter(entry => 
              entry.name && 
              (entry.name.includes('.m3u8') || 
               entry.name.includes('.flv') ||
               entry.name.includes('/live/') ||
               entry.name.includes('/stream/')) &&
              !entry.name.includes('douyin-pc-web/uuu_')
            );
            
            if (mediaEntries.length > 0) {
              return mediaEntries[mediaEntries.length - 1].name;
            }
          }
          
          // 尝试使用媒体会话API
          if (navigator.mediaSession) {
            const mediaMetadata = navigator.mediaSession.metadata;
            if (mediaMetadata && mediaMetadata.artwork && mediaMetadata.artwork.length > 0) {
              // 艺术品URL可能与视频URL相关，尝试寻找规律
              const artworkUrl = mediaMetadata.artwork[0].src;
              const urlParts = artworkUrl.split('/');
              // 构造可能的视频URL
              if (urlParts.length > 5) {
                const basePath = urlParts.slice(0, 5).join('/');
                return `${basePath}/stream.m3u8`;
              }
            }
          }
          
          return null;
        });
        
        if (extractedUrl && !extractedUrl.includes('douyin-pc-web/uuu_')) {
          streamUrl = extractedUrl;
          console.log('通过自定义脚本找到直播流地址:', streamUrl);
        }
      } catch (e) {
        console.error('自定义脚本提取失败:', e);
      }
    }
    
    // 如果使用各种方法都找不到真实直播流，尝试查询抖音API
    if (!streamUrl || streamUrl.includes('douyin-pc-web/uuu_')) {
      console.log('尝试通过直接API查询获取直播流...');
      
      try {
        // 从URL中提取直播间ID
        const roomIdMatch = douyinUrl.match(/\/live\/([^/?]+)/);
        if (roomIdMatch && roomIdMatch[1]) {
          const roomId = roomIdMatch[1];
          console.log('提取到的直播间ID:', roomId);
          
          // 从页面中获取可用的cookie
          const cookies = await page.cookies();
          const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
          
          // 请求抖音API获取直播流信息
          const apiUrl = `https://webcast.amemv.com/webcast/room/reflow/info/?live_id=${roomId}&room_id=${roomId}`;
          
          // 通过页面执行fetch请求，避免CORS和身份验证问题
          const response = await page.evaluate(async (url, cookies) => {
            try {
              const resp = await fetch(url, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': cookies,
                  'User-Agent': navigator.userAgent,
                  'Referer': location.href
                }
              });
              return await resp.json();
            } catch (e) {
              return { error: e.message };
            }
          }, apiUrl, cookieString);
          
          console.log('API响应:', JSON.stringify(response).substring(0, 500) + '...');
          
          if (response && response.data && response.data.room) {
            // 尝试从响应中提取流URL
            if (response.data.room.stream_url && response.data.room.stream_url.flv_url) {
              streamUrl = response.data.room.stream_url.flv_url;
              console.log('从API响应中提取到FLV直播流:', streamUrl);
            } else if (response.data.room.stream_url && response.data.room.stream_url.hls_url) {
              streamUrl = response.data.room.stream_url.hls_url;
              console.log('从API响应中提取到HLS直播流:', streamUrl);
            }
          }
        }
      } catch (e) {
        console.error('API查询失败:', e);
      }
    }
    
    // 如果仍然没找到，或者找到的还是测试视频，则保存调试信息
    if (!streamUrl || streamUrl.includes('douyin-pc-web/uuu_')) {
      // 保存页面HTML内容和截图进行调试
      const pageContent = await page.content();
      require('fs').writeFileSync('debug-page-content.html', pageContent);
      console.log('已保存页面HTML内容到debug-page-content.html');
      
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
      console.log('已保存页面截图到debug-screenshot.png');
      
      // 如果找到了测试视频，可以返回它，同时提供警告
      if (streamUrl && streamUrl.includes('douyin-pc-web/uuu_')) {
        console.warn('只能找到测试视频，可能是抖音的反爬虫机制导致。可以尝试手动获取直播链接。');
        return streamUrl;
      }
      
      throw new Error('无法获取直播流地址，请查看截图和页面HTML内容了解详情');
    }
    
    console.log('成功提取直播流地址:', streamUrl);
    return streamUrl;
  } catch (error) {
    console.error('提取直播流地址失败:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * 处理直播流
 * @param {string} streamUrl - 直播流URL
 * @param {string} sessionId - 会话ID
 * @returns {Object} 包含转码后地址的对象
 */
function processLiveStream(streamUrl, sessionId) {
  // 检查URL是否是测试视频或静态资源
  if (streamUrl.includes('/douyin-pc-web/') || streamUrl.includes('uuu_')) {
    console.log(`警告: 提取的URL可能是测试视频或静态资源: ${streamUrl}`);
  }
  
  // 如果FFmpeg不可用，则直接返回原始URL而不进行转码
  if (!ffmpegAvailable) {
    console.log('FFmpeg不可用，跳过转码步骤，直接返回原始URL');
    return {
      originalUrl: streamUrl,
      transcodedUrl: null,
      ffmpegAvailable: false
    };
  }
  
  try {
    // 创建输出目录（如果不存在）
    const outputDir = path.join(__dirname, 'public', 'streams');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 使用path.join创建跨平台的文件路径
    const outputPath = path.join(outputDir, `${sessionId}.mp4`);
    const outputUrl = `/streams/${sessionId}.mp4`;
    
    // 使用FFmpeg进行转码，将HEVC转换为H.264
    const ffmpegProcess = ffmpeg(streamUrl)
      .videoBitrate('1000k')
      .videoCodec('libx264')
      .audioBitrate('128k')
      .audioCodec('aac')
      .outputOptions([
        '-preset ultrafast',
        '-tune zerolatency',
        '-f mp4',
        '-movflags frag_keyframe+empty_moov+default_base_moof' // 保留原有优化流式传输参数
      ])
      .output(outputPath)
      .on('start', () => {
        console.log(`开始处理直播流: ${sessionId}`);
      })
      .on('error', (err) => {
        console.error(`处理直播流错误: ${err.message}`);
        cleanupStream(sessionId);
      })
      .on('progress', (progress) => {
        // 检查progress对象是否包含完整的信息
        if (progress && typeof progress === 'object') {
          // 格式化percent属性，如果不存在或为undefined则显示帧数或时间信息
          let progressInfo = '';
          
          if (progress.percent !== undefined && !isNaN(parseFloat(progress.percent))) {
            // percent存在且为有效数字，格式化为保留两位小数
            progressInfo = `${parseFloat(progress.percent).toFixed(2)}%`;
          } else if (progress.frames !== undefined) {
            // 如果有帧数信息，则显示已处理的帧数
            progressInfo = `已处理 ${progress.frames} 帧`;
          } else if (progress.timemark !== undefined) {
            // 如果有时间标记，则显示当前处理时间
            progressInfo = `处理时间: ${progress.timemark}`;
          } else {
            // 如果没有任何有效的进度信息，显示处理中
            progressInfo = "处理中...";
          }
          
          // 构建更详细的进度日志
          let detailInfo = [];
          if (progress.frames !== undefined) detailInfo.push(`帧数: ${progress.frames}`);
          if (progress.currentFps !== undefined) detailInfo.push(`FPS: ${progress.currentFps}`);
          if (progress.targetSize !== undefined) detailInfo.push(`大小: ${progress.targetSize}KB`);
          if (progress.timemark !== undefined) detailInfo.push(`时间: ${progress.timemark}`);
          
          // 输出进度信息
          if (detailInfo.length > 0) {
            console.log(`转码进度: ${progressInfo} (${detailInfo.join(', ')})`);
          } else {
            console.log(`转码进度: ${progressInfo}`);
          }
        } else {
          // progress对象无效，输出基本处理信息
          console.log(`转码处理中...`);
        }
      })
      .on('end', () => {
        console.log(`直播流处理结束: ${sessionId}`);
        cleanupStream(sessionId);
      });
    
    // 启动FFmpeg进程
    ffmpegProcess.run();
    
    // 保存FFmpeg进程以便后续清理
    activeLiveStreams.set(sessionId, ffmpegProcess);
    
    return {
      originalUrl: streamUrl,
      transcodedUrl: `http://localhost:${PORT}${outputUrl}`,
      ffmpegAvailable: true
    };
  } catch (error) {
    console.error('处理直播流时出错:', error);
    return {
      originalUrl: streamUrl,
      transcodedUrl: null,
      ffmpegAvailable: false,
      error: error.message
    };
  }
}

/**
 * 清理直播流资源
 * @param {string} sessionId - 会话ID
 */
function cleanupStream(sessionId) {
  if (activeLiveStreams.has(sessionId)) {
    const process = activeLiveStreams.get(sessionId);
    process.kill('SIGTERM');
    activeLiveStreams.delete(sessionId);
    console.log(`已清理直播流: ${sessionId}`);
  }
}

// API路由
app.post('/api/start-stream', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: '缺少抖音直播间URL' });
    }
    
    const sessionId = Date.now().toString();
    
    // 提取直播流URL
    const streamUrl = await extractLiveStreamUrl(url);
    
    // 处理和转码视频流
    const { originalUrl, transcodedUrl, ffmpegAvailable, error } = processLiveStream(streamUrl, sessionId);
    
    // 将URL发送给客户端
    res.json({ 
      success: true, 
      sessionId,
      streamUrl: originalUrl,
      transcodedUrl: transcodedUrl,
      ffmpegAvailable: ffmpegAvailable,
      error: error
    });
    
  } catch (error) {
    console.error('启动直播转播失败:', error);
    res.status(500).json({ error: '无法连接到抖音直播间' });
  }
});

app.get('/api/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (!activeLiveStreams.has(sessionId)) {
    return res.status(404).json({ error: '直播会话不存在' });
  }
  
  res.json({ 
    success: true, 
    status: '直播转播中'
  });
});

app.post('/api/stop-stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  if (activeLiveStreams.has(sessionId)) {
    cleanupStream(sessionId);
    res.json({ success: true, message: '已停止直播转播' });
  } else {
    res.status(404).json({ error: '直播会话不存在' });
  }
});

// 添加静态文件服务
app.use('/streams', express.static(path.join(__dirname, 'public', 'streams')));

// WebSocket连接处理
io.on('connection', (socket) => {
  console.log('客户端已连接', socket.id);
  
  socket.on('join-stream', async (data) => {
    try {
      const { url } = data;
      if (!url) {
        socket.emit('error', { message: '缺少抖音直播间URL' });
        return;
      }
      
      // 提取直播流URL
      const streamUrl = await extractLiveStreamUrl(url);
      
      // 处理和转码视频流
      const sessionId = `${Date.now()}-${socket.id}`;
      const { originalUrl, transcodedUrl, ffmpegAvailable, error } = processLiveStream(streamUrl, sessionId);
      
      // 发送直播流信息给客户端
      socket.emit('stream-ready', { 
        streamUrl: originalUrl,
        transcodedUrl: transcodedUrl,
        sessionId: sessionId,
        ffmpegAvailable: ffmpegAvailable,
        error: error
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('客户端已断开连接', socket.id);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，关闭所有直播转播');
  
  // 清理所有活跃直播会话
  for (const [sessionId] of activeLiveStreams.entries()) {
    cleanupStream(sessionId);
  }
  
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
}); 
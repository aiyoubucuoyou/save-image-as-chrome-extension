// 注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  const formats = [
    { id: 'save-as-png', title: '另存为 PNG' },
    { id: 'save-as-jpg', title: '另存为 JPG' },
    { id: 'save-as-webp', title: '另存为 WebP' }
  ];

  chrome.contextMenus.create({
    id: 'image-save-as',
    title: '图片另存为...',
    contexts: ['image']
  });

  formats.forEach(f => {
    chrome.contextMenus.create({
      id: f.id,
      parentId: 'image-save-as',
      title: f.title,
      contexts: ['image']
    });
  });
});

// 确保 offscreen document 存在
let creatingOffscreen = null;
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: '使用 Canvas 转换图片格式'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

// 从 URL 中提取文件名（不含扩展名）
function getBaseName(url) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || 'image';
    const base = filename.replace(/\.[^.]+$/, '');
    return base || 'image';
  } catch {
    return 'image';
  }
}

// 将 ArrayBuffer 转为 Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 判断是否为需要通过百度图片代理的防盗链域名
function needsBaiduProxy(url) {
  const hotlinkDomains = [
    'sinaimg.cn',
    'sina.com.cn',
    'weibo.com',
    'weibo.cn'
  ];
  try {
    const hostname = new URL(url).hostname;
    return hotlinkDomains.some(d => hostname.endsWith(d));
  } catch {
    return false;
  }
}

// 构建百度图片代理 URL
function buildBaiduProxyUrl(srcUrl) {
  // 将 wx4.sinaimg.cn 转为 tva4.sinaimg.cn（百度代理需要 tva 前缀）
  let proxyTarget = srcUrl;
  proxyTarget = proxyTarget.replace(/\/\/wx(\d+)\.sinaimg\.cn\//g, '//tva$1.sinaimg.cn/');
  return `https://image.baidu.com/search/down?thumburl=https://baidu.com&url=${encodeURIComponent(proxyTarget)}`;
}

// 监听来自 offscreen.js 的转换结果
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'convert-result' && message.dataUrl) {
    chrome.downloads.download({
      url: message.dataUrl,
      filename: `${message.baseName}.${message.format}`,
      saveAs: true
    });
  }
  if (message.action === 'convert-error') {
    console.error('图片转换失败:', message.error);
  }
});

// 获取图片并转为 data URL
async function fetchImageAsDataUrl(srcUrl) {
  // 如果是防盗链域名，使用百度图片代理
  let fetchUrl = srcUrl;
  if (needsBaiduProxy(srcUrl)) {
    fetchUrl = buildBaiduProxyUrl(srcUrl);
    console.log('使用百度代理获取图片:', fetchUrl);
  }

  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('图片数据为空');
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:${contentType};base64,${base64}`;
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const formatMap = {
    'save-as-png': 'png',
    'save-as-jpg': 'jpg',
    'save-as-webp': 'webp'
  };

  const format = formatMap[info.menuItemId];
  if (!format || !info.srcUrl) return;

  const baseName = getBaseName(info.srcUrl);

  try {
    const dataUrl = await fetchImageAsDataUrl(info.srcUrl);

    await ensureOffscreen();

    // 将图片数据（data URL）发送给 offscreen document 进行格式转换
    chrome.runtime.sendMessage({
      action: 'convert-image',
      imageDataUrl: dataUrl,
      format: format,
      baseName: baseName
    });
  } catch (err) {
    console.error('获取图片失败:', err);
    // 最终回退：通过 content script 在页面内获取
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fetchImageInPage,
        args: [info.srcUrl, format, baseName]
      });
    } catch (scriptErr) {
      console.error('Content script 获取图片也失败:', scriptErr);
    }
  }
});

// 注入到页面中执行的函数
function fetchImageInPage(srcUrl, format, baseName) {
  fetch(srcUrl)
    .then(r => r.blob())
    .then(blob => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');

        if (format === 'jpg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.drawImage(img, 0, 0);

        const mimeMap = { 'png': 'image/png', 'jpg': 'image/jpeg', 'webp': 'image/webp' };
        const mimeType = mimeMap[format] || 'image/png';
        const quality = format === 'png' ? undefined : 0.95;

        canvas.toBlob((resultBlob) => {
          const downloadUrl = URL.createObjectURL(resultBlob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `${baseName}.${format}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => {
            URL.revokeObjectURL(downloadUrl);
            URL.revokeObjectURL(objectUrl);
          }, 5000);
        }, mimeType, quality);
      };
      img.src = objectUrl;
    })
    .catch(e => console.error('页面内获取图片失败:', e));
}

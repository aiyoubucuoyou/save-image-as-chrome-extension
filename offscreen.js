// 监听来自 background.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'convert-image') {
    convertImage(message.imageDataUrl, message.format, message.baseName);
  }
});

/**
 * 使用 Canvas 将图片 data URL 转换为目标格式
 */
function convertImage(imageDataUrl, format, baseName) {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');

      // JPG 不支持透明，填充白色背景
      if (format === 'jpg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0);

      const mimeMap = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'webp': 'image/webp'
      };

      const mimeType = mimeMap[format] || 'image/png';
      const quality = format === 'png' ? undefined : 0.95;
      const dataUrl = canvas.toDataURL(mimeType, quality);

      // 发送结果回 background.js
      chrome.runtime.sendMessage({
        action: 'convert-result',
        dataUrl: dataUrl,
        format: format,
        baseName: baseName
      });
    } catch (err) {
      chrome.runtime.sendMessage({
        action: 'convert-error',
        error: err.message
      });
    }
  };
  img.onerror = () => {
    chrome.runtime.sendMessage({
      action: 'convert-error',
      error: '图片加载失败'
    });
  };
  img.src = imageDataUrl;
}

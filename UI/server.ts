import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { GoogleGenAI } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4000';

  // JSON body parsing is scoped to this route only: applying it globally would
  // consume the request stream before the /api proxy below can forward it,
  // causing proxied POST requests (e.g. login) to hang forever.
  app.post('/api/ai-diagnose', express.json(), async (req, res) => {
    const { deviceName, alertMessage, syslogSnippet, metricStats } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      // Fallback response if Gemini key is not set
      return res.json({
        success: true,
        source: 'built-in-heuristics',
        diagnosis: `[Phân tích Tự động NOC]\n- Thiết bị: ${deviceName || 'Chưa xác định'}\n- Tình trạng: Cảnh báo "${alertMessage || 'Phát hiện bất thường'}"\n- Chẩn đoán sơ bộ: Có khả năng nghẽn băng thông đường truyền hoặc sai cấu hình LACP/VLAN. Tiến hành ping kiểm tra packet loss và tra cứu bảng định tuyến (routing table).`,
        recommendations: [
          'Kiểm tra cổng vật lý (Physical Cable / SFP Module)',
          'Xác minh bảng định tuyến OSPF/BGP',
          'Kiểm tra ngưỡng CPU/RAM của thiết bị qua CLI/SNMP',
          'Khôi phục kết nối dự phòng (Secondary WAN/Uplink)'
        ]
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Bạn là một Chuyên gia Kỹ sư Mạng NOC LibreNMS (Senior Network Operation Engineer). Hãy phân tích sự cố mạng sau bằng Tiếng Việt ngắn gọn, chuyên nghiệp, đưa ra nguyên nhân gốc rễ (Root Cause) và các bước xử lý cụ thể cho quản trị viên:
      
Thiết bị: ${deviceName}
Nội dung Cảnh báo: ${alertMessage}
Log Syslog/SNMP: ${syslogSnippet || 'Không có'}
Thông số kĩ thuật: ${JSON.stringify(metricStats || {})}

Hãy trình bày theo định dạng JSON với cấu trúc:
{
  "rootCause": "mô tả nguyên nhân gốc rễ",
  "severityLevel": "Critical / Major / Minor",
  "recommendations": ["bước 1", "bước 2", "bước 3"]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const text = response.text || '';
      return res.json({
        success: true,
        source: 'gemini-2.5-flash',
        rawText: text,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Gemini Diagnosis Error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Lỗi xử lý AI',
      });
    }
  });

  // Health check endpoint (this UI server's own health, distinct from the backend's /api/health)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Proxy remaining REST API and WebSocket traffic to the backend so the
  // browser only ever talks to this single origin (avoids CORS and hardcoded
  // backend URLs). Registered after the routes above so they take precedence.
  // NOTE: mounted at root with `pathFilter` (not `app.use('/api', ...)`) because
  // Express strips the mount prefix from req.url before the proxy sees it,
  // which made every proxied request 404 upstream (e.g. /api/auth/login became
  // /auth/login by the time it reached the api container).
  const proxyErrorHandler = (err: Error, _req: express.Request, res: express.Response) => {
    console.error('Backend proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Không thể kết nối tới backend API. Vui lòng kiểm tra container "api".' });
    }
  };
  app.use(
    createProxyMiddleware({
      target: API_PROXY_TARGET,
      changeOrigin: true,
      pathFilter: '/api',
      proxyTimeout: 10000,
      timeout: 10000,
      on: { error: proxyErrorHandler as never },
    })
  );
  const socketProxy = createProxyMiddleware({ target: API_PROXY_TARGET, changeOrigin: true, pathFilter: '/socket.io', ws: true });
  app.use(socketProxy);

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // http-proxy-middleware's `ws: true` option only rewrites the request path/headers;
  // it does NOT forward the raw WebSocket 'upgrade' event on its own. Express's
  // app.listen() creates the underlying http.Server internally, so middleware never
  // gets a chance to attach an 'upgrade' listener - without this, every WS handshake
  // to /socket.io was silently dropped and socket.io-client fell back to HTTP
  // long-polling permanently (constant reconnect attempts + chatty polling requests,
  // a major source of CPU load once many devices push frequent realtime updates).
  const server = http.createServer(app);
  server.on('upgrade', socketProxy.upgrade);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

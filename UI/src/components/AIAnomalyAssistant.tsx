import React, { useState } from 'react';
import { NetworkAlert, EventLog } from '../types';
import { Sparkles, Terminal, AlertTriangle, ShieldCheck, CheckCircle, RefreshCw, Send } from 'lucide-react';

interface AIAnomalyAssistantProps {
  alerts: NetworkAlert[];
  eventLogs: EventLog[];
  darkMode: boolean;
  selectedAlertForAI?: NetworkAlert | null;
}

export const AIAnomalyAssistant: React.FC<AIAnomalyAssistantProps> = ({
  alerts,
  eventLogs,
  darkMode,
  selectedAlertForAI,
}) => {
  const [deviceName, setDeviceName] = useState(selectedAlertForAI?.deviceName || alerts[0]?.deviceName || 'Core-Router-HN-01');
  const [alertMessage, setAlertMessage] = useState(selectedAlertForAI?.message || alerts[0]?.message || 'High CPU Load & Packet Loss');
  const [syslogSnippet, setSyslogSnippet] = useState(eventLogs[0]?.message || 'System performance warning: CPU usage reached 89.4%');
  const [isLoading, setIsLoading] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<{
    source?: string;
    diagnosis?: string;
    recommendations?: string[];
    rawText?: string;
  } | null>(null);

  const handleRunDiagnosis = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceName,
          alertMessage,
          syslogSnippet,
          metricStats: { time: new Date().toISOString() },
        }),
      });

      const data = await response.json();
      setDiagnosisResult(data);
    } catch {
      setDiagnosisResult({
        diagnosis: 'Không thể kết nối với dịch vụ AI. Hãy kiểm tra kết nối mạng backend server.',
        recommendations: ['Kiểm tra lại server.ts API endpoint'],
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Banner */}
      <div className={`p-5 rounded-xl border ${
        darkMode ? 'bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border-purple-500/30' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-base font-mono bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Trợ lý AI Gemini Chẩn đoán Sự cố Mạng & Root Cause Analysis
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Phân tích các dòng log Syslog phức tạp, cảnh báo chập chờn SNMP và đưa ra các bước khắc phục sự cố NOC chuẩn hóa.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Form Panel */}
        <div className={`p-5 rounded-xl border space-y-4 font-mono text-xs ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <h4 className="font-bold text-sm text-purple-400 flex items-center space-x-2">
            <Terminal className="w-4 h-4" />
            <span>Thông tin Cảnh báo / Syslog Đầu vào</span>
          </h4>

          <div>
            <label className="block text-slate-400 mb-1">Tên Thiết bị bị ảnh hưởng:</label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className={`w-full p-2.5 rounded-lg border focus:ring-1 focus:ring-purple-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Thông điệp Cảnh báo (Alert Message):</label>
            <input
              type="text"
              value={alertMessage}
              onChange={(e) => setAlertMessage(e.target.value)}
              className={`w-full p-2.5 rounded-lg border focus:ring-1 focus:ring-purple-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Đoạn Log Syslog / Trap thu thập được:</label>
            <textarea
              rows={4}
              value={syslogSnippet}
              onChange={(e) => setSyslogSnippet(e.target.value)}
              placeholder="Dán nội dung log từ Cisco IOS / JunOS / FortiGate vào đây..."
              className={`w-full p-2.5 rounded-lg border font-mono text-xs focus:ring-1 focus:ring-purple-500 ${
                darkMode ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300'
              }`}
            ></textarea>
          </div>

          <button
            onClick={handleRunDiagnosis}
            disabled={isLoading}
            className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-lg shadow-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang chẩn đoán qua Gemini AI...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Phân tích Nguyên nhân Gốc rễ (Root Cause)</span>
              </>
            )}
          </button>
        </div>

        {/* Right Output Panel */}
        <div className={`p-5 rounded-xl border font-mono text-xs flex flex-col justify-between ${
          darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h4 className="font-bold text-sm text-emerald-400 flex items-center space-x-2">
                <CheckCircle className="w-4 h-4" />
                <span>Kết quả Phân tích Kỹ thuật NOC</span>
              </h4>
              {diagnosisResult?.source && (
                <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Engine: {diagnosisResult.source}
                </span>
              )}
            </div>

            {diagnosisResult ? (
              <div className="space-y-4">
                {diagnosisResult.diagnosis && (
                  <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700 whitespace-pre-wrap leading-relaxed text-slate-200">
                    {diagnosisResult.diagnosis}
                  </div>
                )}

                {diagnosisResult.rawText && (
                  <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700 whitespace-pre-wrap leading-relaxed text-slate-200">
                    {diagnosisResult.rawText}
                  </div>
                )}

                {diagnosisResult.recommendations && (
                  <div>
                    <h5 className="font-bold text-amber-400 mb-2">Khuyến nghị Khắc phục sự cố (Recommended Playbook):</h5>
                    <ul className="space-y-1.5">
                      {diagnosisResult.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start space-x-2 text-slate-300 bg-slate-800/40 p-2 rounded border border-slate-800">
                          <span className="text-emerald-400 font-bold">[{i + 1}]</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-slate-500">
                <Sparkles className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                <p>Nhập thông tin cảnh báo ở cột bên trái và bấm "Phân tích Nguyên nhân Gốc rễ".</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};

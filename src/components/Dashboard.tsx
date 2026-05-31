/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Folder, ShieldCheck, FileSpreadsheet, Activity, Bell, CheckCircle2,
  Lock, AlertTriangle, Users, Mail, ClipboardCheck, ArrowRightLeft
} from 'lucide-react';
import { GoogleFormInfo, SystemNotification } from '../types';

interface DashboardProps {
  forms: GoogleFormInfo[];
  folderName: string;
  notifications: SystemNotification[];
  onMarkNotificationRead: (id: string) => void;
  onClearNotifications: () => void;
}

export default function Dashboard({
  forms,
  folderName,
  notifications,
  onMarkNotificationRead,
  onClearNotifications
}: DashboardProps) {

  // 1. Data Processing for charts
  const totalResponses = forms.reduce((acc, f) => acc + f.responsesCount, 0);
  const totalQuestions = forms.reduce((acc, f) => acc + f.questions.length, 0);
  const activeFormsCount = forms.filter(f => f.isAcceptingResponses).length;

  const sortedForms = [...forms].sort((a, b) => b.responsesCount - a.responsesCount);

  // Chart 1: Bar Chart of Responses per Form
  const barChartData = sortedForms.map(f => ({
    name: f.title.length > 25 ? f.title.substring(0, 25) + '...' : f.title,
    fullName: f.title,
    'Số phản hồi': f.responsesCount,
    'Số câu hỏi': f.questions.length
  }));

  // Chart 2: Domain/Evaluator break-down dynamically resolved from "Người đánh giá" or "Khoa..." columns.
  // Helper to remove accents and normalize strings for matching
  const normalizeStrForMatch = (str: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };

  const evaluatorCounts: Record<string, number> = {};

  forms.forEach(f => {
    if (!f.headers || !f.rawRows || f.rawRows.length === 0) return;

    // Try finding the column index for "Người đánh giá" or containing "danh gia"
    let colIdx = f.headers.findIndex(h => {
      const norm = normalizeStrForMatch(h);
      return norm.includes('nguoi danh gia') || norm.includes('danh gia');
    });

    // If not found, try finding a column starting with "khoa" or containing "khoa" structures
    if (colIdx === -1) {
      colIdx = f.headers.findIndex(h => {
        const norm = normalizeStrForMatch(h);
        return norm.startsWith('khoa') || norm.includes('khoa /') || norm.includes('khoa/');
      });
    }

    // Default room/department keyword fallback
    if (colIdx === -1) {
      colIdx = f.headers.findIndex(h => {
        const norm = normalizeStrForMatch(h);
        return norm.includes('bo phan') || norm.includes('phong ban');
      });
    }

    if (colIdx !== -1) {
      f.rawRows.forEach(row => {
        const val = row[colIdx];
        if (val && val.trim()) {
          const trimmedVal = val.trim();
          evaluatorCounts[trimmedVal] = (evaluatorCounts[trimmedVal] || 0) + 1;
        }
      });
    }
  });

  const hasRealEvaluatorData = Object.keys(evaluatorCounts).length > 0;
  const chartColors = [
    '#0d9488', // Teal
    '#06b6d4', // Cyan
    '#10b981', // Emerald
    '#6366f1', // Indigo
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#f43f5e', // Rose
  ];

  let domainData: Array<{ name: string; value: number; color: string }> = [];

  if (hasRealEvaluatorData) {
    const sortedEvaluators = Object.entries(evaluatorCounts)
      .sort((a, b) => b[1] - a[1]);

    const maxItems = 5;
    if (sortedEvaluators.length <= maxItems) {
      domainData = sortedEvaluators.map(([name, val], idx) => ({
        name,
        value: val,
        color: chartColors[idx % chartColors.length]
      }));
    } else {
      // Take top 4, aggregate the rest into "Các đối tượng khác"
      const topItems = sortedEvaluators.slice(0, 4);
      const remainingSum = sortedEvaluators.slice(4).reduce((sum, item) => sum + item[1], 0);

      domainData = topItems.map(([name, val], idx) => ({
        name,
        value: val,
        color: chartColors[idx % chartColors.length]
      }));

      domainData.push({
        name: 'Các đối tượng khác / Khoa khác',
        value: remainingSum,
        color: '#64748b' // Slate/gray for other
      });
    }
  } else {
    // Fallback to simulation/placeholders
    domainData = [
      { name: 'Người đánh giá ngoài viện (Bệnh nhân / Thân nhân)', value: Math.round(totalResponses * 0.65) || 0, color: '#0d9488' }, // Teal
      { name: 'Y bác sỹ & Nhân viên các Khoa lâm sàng / Phòng ban', value: Math.round(totalResponses * 0.25) || 0, color: '#06b6d4' }, // Cyan
      { name: 'Hội đồng quản lý / Đoàn đánh giá chất lượng', value: Math.round(totalResponses * 0.10) || 0, color: '#10b981' } // Emerald
    ].filter(d => d.value > 0);
  }

  // If there's absolutely no data, provide a nice empty chart placeholder data
  const fallbackDomainData = [
    { name: 'Người đánh giá ngoài viện (Bệnh nhân / Thân nhân)', value: 12, color: '#0d9488' },
    { name: 'Y bác sỹ & Nhân viên các Khoa lâm sàng / Phòng ban', value: 5, color: '#06b6d4' },
    { name: 'Hội đồng quản lý / Đoàn đánh giá chất lượng', value: 3, color: '#10b981' }
  ];

  return (
    <div className="space-y-6">
      {/* KPI Overviews (Bento Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Folder details */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-left relative overflow-hidden group hover:border-teal-200 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute right-4 top-5 p-2 bg-teal-50 text-teal-600 rounded-lg shrink-0 group-hover:bg-teal-600 group-hover:text-white transition-all">
            <Folder className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest pl-0.5">Thư mục quản lý</span>
            <h4 className="text-lg font-black text-slate-900 tracking-tight italic truncate max-w-[80%] pt-1" title={folderName}>
              {folderName || 'Chưa chọn'}
            </h4>
            <span className="text-[10px] text-teal-600 font-bold bg-teal-50 px-2 py-0.5 rounded-md inline-block mt-2 font-mono">
              DRIVE STORAGE
            </span>
          </div>
        </div>

        {/* Card 2: Active forms */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-left relative overflow-hidden group hover:border-emerald-200 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute right-4 top-5 p-2 bg-emerald-50 text-emerald-500 rounded-lg shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-all">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest pl-0.5">Biểu mẫu hoạt động</span>
            <h4 className="text-3xl font-black text-slate-900 tracking-tight pt-1">
              {activeFormsCount} <span className="text-sm text-slate-400 font-normal">/ {forms.length}</span>
            </h4>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-md inline-block mt-2">
              ACTIVE ENFORCEMENT
            </span>
          </div>
        </div>

        {/* Card 3: Total Submissions */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-left relative overflow-hidden group hover:border-purple-200 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute right-4 top-5 p-2 bg-purple-50 text-purple-500 rounded-lg shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-all">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest pl-0.5">Tổng lượng phản hồi</span>
            <h4 className="text-3xl font-black text-slate-900 tracking-tight pt-1">
              {totalResponses} <span className="text-xs text-slate-400 font-normal">bản</span>
            </h4>
            <span className="text-[10px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-md inline-block mt-2">
              SHEETS SYNCED
            </span>
          </div>
        </div>

        {/* Card 4: Firewall triggers */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-left relative overflow-hidden group hover:border-rose-200 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute right-4 top-5 p-2 bg-rose-50 text-rose-500 rounded-lg shrink-0 group-hover:bg-rose-600 group-hover:text-white transition-all">
            <Activity className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest pl-0.5">Cảnh báo bảo mật</span>
            <h4 className="text-3xl font-black text-slate-900 tracking-tight pt-1">
              {notifications.filter(n => n.type === 'warning' || n.type === 'error').length} <span className="text-xs text-slate-400 font-normal">tin</span>
            </h4>
            <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-md inline-block mt-2">
              SECURITY ALERTS
            </span>
          </div>
        </div>
      </div>

      {/* Primary Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Clinical Progress List */}
        <div className="lg:col-span-8 bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4 text-left flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-teal-50 text-teal-600 px-2.5 py-0.5 rounded-md border border-teal-100/60 font-semibold">
              Xếp hạng chỉ số y tế
            </span>
            <h3 className="font-sans font-black text-lg text-slate-900 mt-2 tracking-tight italic">Quy mô & Thống kê Phản hồi</h3>
            <p className="text-xs text-slate-400 mt-0.5">Danh sách các phiếu khảo sát được sắp xếp theo số lượng mẫu nộp thực tế (Hiển thị đầy đủ 100% tiêu đề quy trình)</p>
          </div>
          
          <div className="w-full text-xs mt-4 max-h-[420px] overflow-y-auto pr-1 space-y-3.5 scrollbar-thin scrollbar-thumb-teal-100 scrollbar-track-transparent">
            {forms.length === 0 ? (
              <div className="flex items-center justify-center py-24 text-slate-400 font-sans">
                Chưa có dữ liệu biểu mẫu nào để hiển thị danh sách thống kê
              </div>
            ) : (
              (() => {
                const maxResponses = Math.max(...forms.map(f => f.responsesCount), 1);
                return sortedForms.map((form) => {
                  const percent = Math.min(100, Math.round((form.responsesCount / maxResponses) * 100));
                  return (
                    <div key={form.id} className="p-4 rounded-2xl border border-slate-100 hover:border-teal-250 hover:shadow-xs bg-slate-50/40 hover:bg-teal-50/10 transition-all space-y-3 group">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        {/* Title & metadata */}
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <span className={`h-2 w-2 rounded-full ${form.isAcceptingResponses ? 'bg-emerald-500' : 'bg-rose-500'}`} title={form.isAcceptingResponses ? 'Đang nhận phản hồi' : 'Đã khóa'} />
                            <span className="text-[10px] font-mono font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded leading-none">
                              MÃ: {form.id.substring(0, 8).toUpperCase()}
                            </span>
                            <span className="text-[9px] font-sans font-bold text-slate-400">
                              {form.isAcceptingResponses ? 'Hoạt động' : 'Đóng liên kết'}
                            </span>
                          </div>
                          <h4 className="font-sans font-extrabold text-sm text-slate-900 group-hover:text-teal-700 transition-colors leading-snug tracking-tight pr-2">
                            {form.title}
                          </h4>
                        </div>
                        
                        {/* Right Stat counter badge */}
                        <div className="flex items-center space-x-2 shrink-0 self-start">
                          <span className="font-mono text-teal-700 font-black text-sm bg-teal-50 px-3 py-1.5 rounded-xl border border-teal-100 shadow-3xs flex items-baseline gap-1">
                            {form.responsesCount} 
                            <span className="text-[10px] font-bold text-teal-600 font-sans">bản ghi</span>
                          </span>
                        </div>
                      </div>

                      {/* Visual Progress Bar logic */}
                      <div className="space-y-1.5">
                        <div className="w-full bg-slate-100/80 rounded-full h-2 overflow-hidden border border-slate-200/50">
                          <div 
                            className="bg-gradient-to-r from-teal-500 via-teal-650 to-emerald-500 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider font-sans">
                          <span className="text-teal-650 font-extrabold font-mono">Phân bổ tỷ trọng: {percent}%</span>
                          <span className="bg-slate-150 bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                            {form.questions.length} câu hỏi khảo sát
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>

        {/* Right Column: Source list analysis (Pie chart) */}
        <div className="lg:col-span-4 bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between text-left">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-teal-50 text-teal-600 px-2.5 py-0.5 rounded-md border border-teal-100/60">
              Đối tượng tham gia
            </span>
            <h3 className="font-sans font-black text-lg text-slate-900 mt-2 tracking-tight italic">Người đánh giá hoặc Khoa</h3>
            <p className="text-xs text-slate-400 mt-0.5">Phân bổ nguồn người đánh giá đóng góp ý kiến và khoa phòng</p>
          </div>

          <div className="h-[180px] w-full mt-4 flex justify-center items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={domainData.length > 0 ? domainData : fallbackDomainData}
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {(domainData.length > 0 ? domainData : fallbackDomainData).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '14px', border: '1px solid #e4e4e7', boxShadow: 'none' }}
                  formatter={(value, name) => [`${value} phản hồi`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Custom Legends với Hiển thị Số lượng và cấu trúc phần trăm (%) đầy đủ */}
          <div className="space-y-2 mt-4 text-left text-[11px] font-medium text-slate-600 border-t border-slate-100 pt-3">
            {(() => {
              const activeList = domainData.length > 0 ? domainData : fallbackDomainData;
              const currentTotal = activeList.reduce((sum, d) => sum + d.value, 0) || 1;
              
              return activeList.map((item, idx) => {
                const pct = ((item.value / currentTotal) * 100).toFixed(1);
                return (
                  <div key={idx} className="flex items-center justify-between py-1 hover:bg-slate-50 rounded-lg px-1 transition-all">
                    <span className="flex items-center space-x-1.5 min-w-0 flex-1">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="truncate font-sans font-semibold text-slate-800 text-[11px]" title={item.name}>
                        {item.name}
                      </span>
                    </span>
                    <span className="font-mono text-slate-500 font-extrabold shrink-0 flex items-center space-x-1 pl-2 text-[11px]">
                      <span>{item.value}</span>
                      <span className="text-slate-300 font-normal">|</span>
                      <span className="text-teal-600 font-black">{pct}%</span>
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Security Firewall audit logs & System Activity Notifications */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-12 bg-slate-950 text-slate-100 p-6 rounded-3xl shadow-xl border border-slate-900 text-left">
          <div className="flex items-center justify-between pb-4 border-b border-slate-900">
            <div className="space-y-1">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#06b6d4]">
                AUDIT TELEMETRY LOGS
              </span>
              <h3 className="font-sans font-black text-white text-lg flex items-center space-x-2 tracking-tight">
                <Bell className="h-4.5 w-4.5 text-teal-400 animate-pulse" />
                <span>Nhật ký Kiểm duyệt & Bảo mật Lâm sàng</span>
              </h3>
              <p className="text-xs text-slate-400">Giám sát các hành động lọc phản hồi biểu mẫu y tế, đồng bộ liên kết Google Sheets thời gian thực</p>
            </div>
            
            {notifications.length > 0 && (
              <button
                onClick={onClearNotifications}
                className="text-[10px] text-slate-400 hover:text-white font-sans font-bold uppercase tracking-wider border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
              >
                Dọn sạch nhật ký
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-900 max-h-[300px] overflow-y-auto font-mono text-xs mt-3">
            {notifications.length === 0 ? (
              <div className="py-16 text-center text-slate-500 space-y-2">
                <ClipboardCheck className="h-10 w-10 text-teal-550 mx-auto" />
                <p className="text-sm font-bold text-white uppercase tracking-wider">Hệ thống an toàn tuyệt đối</p>
                <p className="text-xs text-slate-400">Chưa ghi nhận phản hồi lỗi hoặc sự cố chặn lọc Whitelist nào.</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div key={notif.id} className="py-3 px-1 flex items-start justify-between space-x-3">
                  <div className="flex items-start space-x-3">
                    <span className="shrink-0 mt-0.5">
                      {notif.type === 'warning' && (
                        <div className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md text-[9px] font-bold">BLOCK</div>
                      )}
                      {notif.type === 'error' && (
                        <div className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-md text-[9px] font-bold">ALERT</div>
                      )}
                      {notif.type === 'success' && (
                        <div className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-md text-[9px] font-bold">SYNC</div>
                      )}
                      {notif.type === 'info' && (
                        <div className="px-2 py-0.5 bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-md text-[9px] font-bold">INFO</div>
                      )}
                    </span>
                    
                    <div>
                      <h5 className="font-bold text-white">Phiếu: {notif.formName}</h5>
                      <p className="text-slate-350 font-normal leading-relaxed mt-1 text-xs">{notif.message}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <span className="text-[10px] text-slate-400">
                      {new Date(notif.timestamp).toLocaleTimeString('vi-VN')}
                    </span>
                    {!notif.read && (
                      <button
                        onClick={() => onMarkNotificationRead(notif.id)}
                        className="h-2 w-2 rounded-full bg-teal-400"
                        title="Đánh dấu đã đọc"
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

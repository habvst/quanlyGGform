/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  FileSpreadsheet, Settings, Eye, Clock, ShieldCheck, Mail, ArrowRight,
  ShieldX, CheckCircle, HelpCircle, Activity, ExternalLink
} from 'lucide-react';
import { GoogleFormInfo } from '../types';

interface FormCardProps {
  key?: string | number | any;
  form: GoogleFormInfo;
  onOpenSettings: (form: GoogleFormInfo) => void | any;
  onOpenResponses: (form: GoogleFormInfo) => void | Promise<void> | any;
  onToggleStatus: (formId: string, currentStatus: boolean) => void | Promise<void> | any;
}

export default function FormCard({
  form,
  onOpenSettings,
  onOpenResponses,
  onToggleStatus
}: FormCardProps) {
  
  const settings = form.settings;
  const isTimeLimitActive = settings?.enableTimeLimit;
  const isMaxResActive = settings?.enableMaxResponses;
  const isWhitelistActive = settings?.enableEmailWhitelist;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-lg hover:border-teal-200/80 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden flex flex-col h-full group">
      {/* Upper Color bar and Status */}
      <div className="h-1.5 bg-gradient-to-r from-teal-600 via-teal-500 to-emerald-600 shrink-0" />
      
      <div className="p-6 flex-1 flex flex-col justify-between">
        <div className="space-y-4 text-left">
          {/* Header Title and Count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2.5 py-1 rounded-md border border-slate-200/60 shadow-2xs">
                Mã: {form.id.substring(0, 5)}...
              </span>
              <a
                href={`https://docs.google.com/forms/d/${form.id}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                title="Mở Google Form gốc để chỉnh sửa"
                className="inline-flex items-center space-x-1 text-[10px] font-sans font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md border border-indigo-100 hover:bg-slate-100 hover:border-indigo-200 transition-all cursor-pointer select-none"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                <span>Sửa Form</span>
              </a>
            </div>
            
            <div className="flex items-center space-x-1.5">
              <span className={`h-2 w-2 rounded-full ${form.isAcceptingResponses ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-slate-500">
                {form.isAcceptingResponses ? 'Đang nhận' : 'Khóa'}
              </span>
            </div>
          </div>

          <div>
            <h3 className="font-sans font-bold text-base text-slate-900 line-clamp-2 leading-snug group-hover:text-teal-600 transition-colors">
              {form.title}
            </h3>
            
            {/* Sheet Connection Status Badge */}
            <div className="flex items-center space-x-1.5 mt-2">
              {form.linkedSheetId ? (
                <span className="inline-flex items-center space-x-1 text-[9px] font-sans font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200/60 shadow-2xs">
                  <FileSpreadsheet className="h-3 w-3 text-emerald-600" />
                  <span>Đã kết nối Google Sheet</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 text-[9px] font-sans font-bold uppercase tracking-wider bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md border border-amber-200/60 shadow-2xs">
                  <FileSpreadsheet className="h-3 w-3 text-amber-600 animate-pulse" />
                  <span>Chưa liên kết Google Sheet</span>
                </span>
              )}
            </div>

            <p className="text-slate-500 text-xs line-clamp-2 mt-2.5 min-h-[32px] leading-relaxed">
              {form.description || 'Không có mô tả chi tiết cho biểu mẫu này.'}
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="bg-slate-50/80 rounded-2xl p-4 flex justify-between border border-slate-100">
            <div>
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest font-sans">Tổng phản hồi</span>
              <span className="text-xl font-black font-sans text-slate-900 mt-0.5 block">{form.responsesCount}</span>
            </div>
            
            <div className="w-px bg-slate-200 my-1 font-sans" />
            
            <div className="text-right">
              <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest font-sans">Chỉ số câu hỏi</span>
              <span className="text-xl font-black font-sans text-slate-900 mt-0.5 block">{form.questions.length}</span>
            </div>
          </div>

          {/* Configuration Rules Checkboxes */}
          <div className="space-y-2 pt-1.5">
            <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-widest">Trạng thái rào chắn bảo vệ</span>
            
            <div className="grid grid-cols-1 gap-2">
              {/* Rule 1: Time limits */}
              <div className={`flex items-center space-x-2 text-xs p-2.5 rounded-xl border transition-colors ${
                isTimeLimitActive ? 'bg-teal-55 bg-teal-50/40 border-teal-100 text-teal-850' : 'bg-transparent border-slate-100 text-slate-400'
              }`}>
                <Clock className={`h-4 w-4 ${isTimeLimitActive ? 'text-teal-500' : 'text-slate-300'}`} />
                <span className="font-semibold">Giới hạn thời gian:</span>
                <span className="font-mono font-bold ml-auto text-[10px]">{isTimeLimitActive ? 'ĐANG BẬT' : 'TẮT'}</span>
              </div>

              {/* Rule 2: Max limits */}
              <div className={`flex items-center space-x-2 text-xs p-2.5 rounded-xl border transition-colors ${
                isMaxResActive ? 'bg-cyan-50/40 border-cyan-100 text-cyan-850' : 'bg-transparent border-slate-100 text-slate-400'
              }`}>
                <ShieldCheck className={`h-4 w-4 ${isMaxResActive ? 'text-cyan-500' : 'text-slate-300'}`} />
                <span className="font-semibold">Hạn ngạch trả lời:</span>
                <span className="font-mono font-bold ml-auto text-[10px]">
                  {isMaxResActive ? `${settings?.maxResponses} LƯỢT` : 'TẮT'}
                </span>
              </div>

              {/* Rule 3: Whitelist check */}
              <div className={`flex items-center space-x-2 text-xs p-2.5 rounded-xl border transition-colors ${
                isWhitelistActive ? 'bg-emerald-50/40 border-emerald-100 text-emerald-850' : 'bg-transparent border-slate-100 text-slate-400'
              }`}>
                <Mail className={`h-4 w-4 ${isWhitelistActive ? 'text-emerald-500' : 'text-slate-300'}`} />
                <span className="font-semibold">Whitelist Gmail:</span>
                <span className="font-mono font-bold ml-auto text-[10px] truncate max-w-[100px]" title={settings?.emailWhitelist}>
                  {isWhitelistActive ? 'ĐANG BẬT' : 'TẮT'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Actions */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            onClick={() => onOpenSettings(form)}
            className="flex items-center justify-center space-x-1.5 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-755 py-3 rounded-xl text-xs font-bold active:scale-97 transition-all outline-none cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            <span>Định cấu hình</span>
          </button>

          <button
            onClick={() => onOpenResponses(form)}
            className="flex items-center justify-center space-x-1.5 bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-xl text-xs font-bold active:scale-97 transition-all shadow-md shadow-teal-100/50 outline-none cursor-pointer"
          >
            <Eye className="h-4 w-4" />
            <span>Xét phản hồi</span>
          </button>
        </div>
      </div>
    </div>
  );
}

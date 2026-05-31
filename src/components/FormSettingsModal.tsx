/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Save, Calendar, ShieldCheck, Mail, Clock, HelpCircle, 
  AlertCircle, ChevronRight, ToggleLeft, ToggleRight, Globe,
  Users, UserCheck, UserPlus, Loader2, Check, Trash2, Plus,
  Lock, Link, ExternalLink
} from 'lucide-react';
import { FormConfigSettings, GoogleFormInfo, FormPermission } from '../types';
import { getFormPermissions, addFormPermission, deleteFormPermission, updateFormGeneralAccess } from '../lib/googleApi';

interface FormSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: GoogleFormInfo;
  onSave: (settings: FormConfigSettings) => void;
  onToggleStatus?: (formId: string, currentStatus: boolean) => void;
  token?: string | null;
  globalAppsScriptUrl?: string;
}

export default function FormSettingsModal({ isOpen, onClose, form, onSave, onToggleStatus, token, globalAppsScriptUrl }: FormSettingsModalProps) {
  const [enableTimeLimit, setEnableTimeLimit] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  
  const [enableMaxResponses, setEnableMaxResponses] = useState(false);
  const [maxResponses, setMaxResponses] = useState(100);
  
  const [enableEmailWhitelist, setEnableEmailWhitelist] = useState(false);
  const [emailWhitelist, setEmailWhitelist] = useState('');

  const [permissions, setPermissions] = useState<FormPermission[]>([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'reader' | 'writer'>('reader');
  const [isAddingPermission, setIsAddingPermission] = useState(false);
  const [isDeletingPermissionId, setIsDeletingPermissionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [permissionMessage, setPermissionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // General Access (Quyền truy cập chung) States
  const [generalEditorRole, setGeneralEditorRole] = useState<'restricted' | 'writer'>('restricted');
  const [generalRespondentRole, setGeneralRespondentRole] = useState<'restricted' | 'reader'>('restricted');
  const [isUpdatingGeneralAccess, setIsUpdatingGeneralAccess] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleToggleGeneralAccess = async (target: 'editor' | 'respondent', status: 'restricted' | 'active') => {
    if (!token || !form.id || isUpdatingGeneralAccess) return;
    
    setIsUpdatingGeneralAccess(true);
    setPermissionMessage(null);
    
    // Choose what the new role should be
    let targetRole: 'restricted' | 'reader' | 'writer' = 'restricted';
    if (status === 'active') {
      targetRole = target === 'editor' ? 'writer' : 'reader';
    }
    
    try {
      await updateFormGeneralAccess(token, form.id, targetRole);
      
      // Update local roles for immediate reactivity
      if (targetRole === 'reader') {
        setGeneralRespondentRole('reader');
        setGeneralEditorRole('restricted');
      } else if (targetRole === 'writer') {
        setGeneralRespondentRole('restricted');
        setGeneralEditorRole('writer');
      } else {
        setGeneralRespondentRole('restricted');
        setGeneralEditorRole('restricted');
      }
      
      setPermissionMessage({
        type: 'success',
        text: `Đã kết nối Google Drive và cập nhật Quyền truy cập chung thành công.`
      });
      
      // Reload direct list to reflect any new states
      const refreshed = await getFormPermissions(token, form.id);
      setPermissions(refreshed);
    } catch (err: any) {
      console.error("Lỗi khi cấu hình Quyền truy cập chung:", err);
      setPermissionMessage({
        type: 'error',
        text: `Không thể thay đổi quyền truy cập chung: ${err.message || 'Lỗi hệ thống Google Drive'}`
      });
    } finally {
      setIsUpdatingGeneralAccess(false);
    }
  };

  const handleAddDirectPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !form.id || !newEmail.trim() || isAddingPermission) return;

    setIsAddingPermission(true);
    setPermissionMessage(null);

    const emailToGrant = newEmail.trim().toLowerCase();

    try {
      await addFormPermission(token, form.id, emailToGrant, newRole);
      setNewEmail('');
      setPermissionMessage({
        type: 'success',
        text: `Đã cấp quyền "${newRole === 'reader' ? 'Người trả lời / Xem' : 'Người chỉnh sửa'}" cho tài khoản ${emailToGrant} thành công.`
      });

      // Tải lại danh sách
      const refreshed = await getFormPermissions(token, form.id);
      setPermissions(refreshed);
    } catch (err: any) {
      console.error("Lỗi khi thêm phân quyền trực tiếp:", err);
      let errMsg = 'Vui lòng kiểm tra lại xem hòm thư đã đúng định dạng hòm thư Google (Gmail, Google Workspace) chưa.';
      if (err.message && err.message.includes('400')) {
        errMsg = 'Tài khoản không hợp lệ hoặc không phải là tài khoản Google.';
      } else if (err.message && err.message.includes('404')) {
        errMsg = 'Không tìm thấy Form gốc hoặc không có quyền quản lý files này.';
      }
      setPermissionMessage({
        type: 'error',
        text: `Lỗi gán quyền: ${errMsg}`
      });
    } finally {
      setIsAddingPermission(false);
    }
  };

  const handleDeleteDirectPermission = async (permissionId: string, email: string) => {
    if (!token || !form.id || isDeletingPermissionId) return;

    setIsDeletingPermissionId(permissionId);
    setConfirmDeleteId(null);
    setPermissionMessage(null);

    try {
      await deleteFormPermission(token, form.id, permissionId);
      setPermissionMessage({
        type: 'success',
        text: `Đã thu hồi thành công quyền truy cập của tài khoản ${email}.`
      });

      // Tải lại danh sách
      const refreshed = await getFormPermissions(token, form.id);
      setPermissions(refreshed);
    } catch (err) {
      console.error("Lỗi khi xóa phân quyền trực tiếp:", err);
      setPermissionMessage({
        type: 'error',
        text: `Không thể thu hồi quyền của tài khoản ${email}. Đã xảy ra lỗi hệ thống.`
      });
    } finally {
      setIsDeletingPermissionId(null);
    }
  };

  // Load permissions when form ID or token changes
  useEffect(() => {
    setConfirmDeleteId(null);
    if (token && form.id && isOpen) {
      setIsLoadingPermissions(true);
      getFormPermissions(token, form.id)
        .then(res => {
          setPermissions(res);
          // Find general sharing values if present in the loaded list
          const editorAccess = res.find(p => p.type === 'anyone' && (p.role === 'writer' || p.role === 'editor'));
          const respondentAccess = res.find(p => p.type === 'anyone' && (p.role === 'reader' || p.role === 'viewer'));
          
          setGeneralEditorRole(editorAccess ? 'writer' : 'restricted');
          setGeneralRespondentRole(respondentAccess ? 'reader' : 'restricted');
        })
        .catch(err => {
          console.error("Lỗi khi lấy thông tin quyền biểu mẫu:", err);
        })
        .finally(() => {
          setIsLoadingPermissions(false);
        });
    } else {
      setPermissions([]);
      setGeneralEditorRole('restricted');
      setGeneralRespondentRole('restricted');
    }
  }, [form.id, token, isOpen]);

  // Load existing settings when modal opens
  useEffect(() => {
    if (form.settings) {
      setEnableTimeLimit(form.settings.enableTimeLimit || false);
      setStartTime(form.settings.startTime || '');
      setEndTime(form.settings.endTime || '');
      setEnableMaxResponses(form.settings.enableMaxResponses || false);
      setMaxResponses(form.settings.maxResponses || 100);
      setEnableEmailWhitelist(form.settings.enableEmailWhitelist || false);
      setEmailWhitelist(form.settings.emailWhitelist || '');
    } else {
      // Defaults
      setEnableTimeLimit(false);
      setStartTime('');
      setEndTime('');
      setEnableMaxResponses(false);
      setMaxResponses(100);
      setEnableEmailWhitelist(false);
      setEmailWhitelist('');
    }
  }, [form]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      formId: form.id,
      enableTimeLimit,
      startTime,
      endTime,
      enableMaxResponses,
      maxResponses: Number(maxResponses),
      enableEmailWhitelist,
      emailWhitelist,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        />

        {/* Modal Container */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="bg-white rounded-3xl shadow-xl w-full max-w-lg border border-slate-100 overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
            <div>
              <span className="text-[9px] font-mono uppercase tracking-widest text-teal-600 font-black bg-teal-50 px-2.5 py-1 rounded-md border border-teal-100">
                QUY TẮC PHÊ DUYỆT FORM
              </span>
              <h3 className="font-sans font-black text-base text-slate-900 tracking-tight italic mt-2.5 line-clamp-1">
                {form.title}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-6 space-y-6 text-left">
            {/* Form Responding State summary */}
            <div className="p-4 rounded-3xl bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2.5 rounded-2xl transition-all duration-300 ${form.isAcceptingResponses ? 'bg-teal-50 text-teal-600 border border-teal-100' : 'bg-rose-50 text-rose-500 border border-rose-100'}`}>
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase text-slate-800 tracking-wide flex items-center space-x-1.5">
                      <span>Cổng tiếp nhận câu hỏi</span>
                      <span className="text-[9px] font-sans text-slate-400 capitalize font-medium italic">(Nhấn nút để chuyển)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">Trực tiếp trên liên kết Google Forms</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleStatus && onToggleStatus(form.id, form.isAcceptingResponses)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider border cursor-pointer select-none transition-all duration-300 active:scale-95 shadow-sm ${
                    form.isAcceptingResponses 
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600/20 shadow-emerald-100/30' 
                      : 'bg-rose-500 hover:bg-rose-600 text-white border-rose-600/20 shadow-rose-100/30'
                  }`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full bg-white ${form.isAcceptingResponses ? 'animate-pulse' : ''}`} />
                  <span>{form.isAcceptingResponses ? 'Đang mở nhận' : 'Tạm dừng nhận'}</span>
                </button>
              </div>

              {/* Apps Script URL status and troubleshooting check */}
              {!globalAppsScriptUrl ? (
                <div className="mt-3 flex items-start space-x-2 text-[10.5px] text-amber-700 bg-amber-50/70 p-3 rounded-2xl border border-amber-200/60 leading-relaxed">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    <strong className="font-bold block text-amber-800 text-[11px] mb-0.5 animate-pulse">⚠️ Chưa cấu hình Web App Apps Script:</strong>
                    Nếu bạn chuyển đổi trạng thái trên app mà thấy Google Forms thực tế vẫn chưa mở/đóng, đó là vì ứng dụng chưa được gán liên kết Web App Apps Script. Vui lòng đóng hộp thoại này, sao chép mã và gắn URL Web App vào phần <span className="font-extrabold text-teal-700 underline">"Tích hợp Google Apps Script"</span> trên thanh menu.
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-start space-x-2 text-[10.5px] text-slate-600 bg-teal-50/20 p-3 rounded-2xl border border-teal-100/80 leading-relaxed">
                  <Check className="h-4 w-4 shrink-0 mt-0.5 text-teal-600" />
                  <div>
                    <strong className="font-bold block text-slate-800 text-[11px] mb-0.5">💡 Đã kết nối với Apps Script:</strong>
                    Yêu cầu bật/tắt sẽ tự động gửi qua URL Apps Script của bạn. Nếu trên Google Forms thực tế vẫn <span className="underline font-semibold">không đổi trạng thái</span>, vui lòng thực hiện:
                    <ol className="list-decimal ml-4 mt-1 space-y-1 text-slate-500 font-sans">
                      <li>Truy cập vào dự án Apps Script của bạn trên Google Drive.</li>
                      <li>Chắc chắn bạn đã <strong className="text-slate-700">sao chép mã Apps Script mới nhất</strong> ở tab tích hợp của ứng dụng (trong đó có hàm hỗ trợ <code className="bg-slate-100 px-1 font-mono rounded text-[9.5px]">toggle_accepting</code>).</li>
                      <li>Nhấn nút <strong className="text-slate-700">"Triển khai mới" (New deployment)</strong> trong Apps Script và chọn lại quyền truy cập là <span className="italic">"Anyone"</span> để cập nhật mã trên máy chủ Google!</li>
                    </ol>
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 1: Time limits */}
            <div className="space-y-3">
              <div className="flex items-center justify-between animate-fade-in">
                <div className="flex items-center space-x-2.5">
                  <Calendar className="h-4.5 w-4.5 text-teal-600" />
                  <label className="text-xs font-bold uppercase tracking-wider font-sans text-slate-800">Giới hạn thời gian kết thúc</label>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableTimeLimit(!enableTimeLimit)}
                  className="text-slate-500 hover:text-teal-600 focus:outline-none transition-all"
                >
                  {enableTimeLimit ? (
                    <ToggleRight className="h-8 w-8 text-teal-600 cursor-pointer" />
                  ) : (
                    <ToggleLeft className="h-8 w-8 text-slate-300 cursor-pointer" />
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-normal pl-7">
                Tự động từ chối nhận câu trả lời và đóng biểu mẫu khi ngoài khoảng thời gian được cấu hình.
              </p>

              {enableTimeLimit && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="grid grid-cols-2 gap-3 pl-7 pt-1 overflow-hidden"
                >
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-sans font-medium text-slate-500 flex items-center space-x-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Ngày bắt đầu</span>
                    </span>
                    <input
                      type="datetime-local"
                      required={enableTimeLimit}
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-700 font-medium"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-sans font-medium text-slate-500 flex items-center space-x-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Ngày kết thúc</span>
                    </span>
                    <input
                      type="datetime-local"
                      required={enableTimeLimit}
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-700 font-medium"
                    />
                  </div>
                </motion.div>
              )}
            </div>

            <hr className="border-slate-200" />

            {/* SECTION 2: Max response limit */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck className="h-4.5 w-4.5 text-teal-600" />
                  <label className="text-xs font-bold uppercase tracking-wider font-sans text-slate-800">Giới hạn số lượt phản hồi</label>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableMaxResponses(!enableMaxResponses)}
                  className="text-slate-500 hover:text-teal-600 focus:outline-none transition-all"
                >
                  {enableMaxResponses ? (
                    <ToggleRight className="h-8 w-8 text-teal-600 cursor-pointer" />
                  ) : (
                    <ToggleLeft className="h-8 w-8 text-slate-300 cursor-pointer" />
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-500 leading-normal pl-7">
                Tự động tạm tắt và đóng Form ngay lập tức khi tổng số phản hồi thu về đạt ngưỡng cài đặt dưới đây.
              </p>

              {enableMaxResponses && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="pl-7 pt-1 overflow-hidden"
                >
                  <div className="space-y-1.5 max-w-[180px]">
                    <span className="text-[11px] font-sans font-bold text-slate-500">Số lượng phản hồi tối đa</span>
                    <input
                      type="number"
                      min={1}
                      required={enableMaxResponses}
                      value={maxResponses}
                      onChange={(e) => setMaxResponses(Math.max(1, Number(e.target.value)))}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all text-slate-800 font-bold font-mono text-xs"
                    />
                  </div>
                </motion.div>
              )}
            </div>

            <hr className="border-slate-200" />

            {/* SECTION: Quyền truy cập chung (General Access / Link-sharing) */}
            <div className="space-y-4 animate-fade-in pl-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Globe className="h-4.5 w-4.5 text-teal-600" />
                  <label className="text-xs font-mono font-black uppercase tracking-wider text-slate-800">
                    Quyền truy cập chung
                  </label>
                </div>
                {isUpdatingGeneralAccess && (
                  <span className="flex items-center space-x-1 text-[10px] text-teal-600 font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang lưu...</span>
                  </span>
                )}
              </div>
              
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4.5 space-y-4 transition-all text-[11.5px] leading-relaxed">
                
                {/* Row 1: Chế độ xem cho Người chỉnh sửa */}
                <div className="flex items-start justify-between gap-4 text-left">
                  <div className="flex items-start space-x-3 min-w-0 flex-1">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      generalEditorRole === 'restricted' 
                        ? 'bg-slate-100 text-slate-500 border-slate-200/80' 
                        : 'bg-indigo-50 text-indigo-600 border-indigo-150'
                    }`}>
                      {generalEditorRole === 'restricted' ? <Lock className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                    </div>
                    <div className="space-y-0.5 font-sans">
                      <h5 className="font-extrabold text-slate-800">
                        Chế độ xem cho Người chỉnh sửa
                      </h5>
                      <p className="text-[10px] text-slate-500 leading-tight">
                        {generalEditorRole === 'restricted' 
                          ? 'Chỉ những người có quyền truy cập mới có thể mở bằng đường liên kết này' 
                          : 'Bất kỳ ai có đường liên kết này đều có quyền chỉnh sửa'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="shrink-0 pt-0.5">
                    <select
                      value={generalEditorRole}
                      disabled={isUpdatingGeneralAccess}
                      onChange={(e) => handleToggleGeneralAccess('editor', e.target.value === 'restricted' ? 'restricted' : 'active')}
                      className="text-[11px] border border-slate-250 rounded-xl px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500/15 focus:border-indigo-500 outline-none transition-all text-slate-700 font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="restricted">Hạn chế</option>
                      <option value="writer">Bất kỳ ai có đường...</option>
                    </select>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-200/60" />

                {/* Row 2: Chế độ xem cho Người trả lời */}
                <div className="flex items-start justify-between gap-4 text-left">
                  <div className="flex items-start space-x-3 min-w-0 flex-1">
                    <div className={`p-2 rounded-xl border shrink-0 ${
                      generalRespondentRole === 'restricted' 
                        ? 'bg-slate-100 text-slate-500 border-slate-200/80' 
                        : 'bg-emerald-50 text-emerald-600 border-emerald-150'
                    }`}>
                      {generalRespondentRole === 'restricted' ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                    </div>
                    <div className="space-y-0.5 font-sans">
                      <h5 className="font-extrabold text-slate-800">
                        Chế độ xem cho Người trả lời
                      </h5>
                      <p className="text-[10px] text-slate-500 leading-tight">
                        {generalRespondentRole === 'restricted' 
                          ? 'Chỉ những người được cấp quyền trực tiếp mới có thể phản hồi biểu mẫu này' 
                          : 'Bất cứ ai có kết nối Internet và có đường liên kết đều có thể phản hồi'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="shrink-0 pt-0.5">
                    <select
                      value={generalRespondentRole}
                      disabled={isUpdatingGeneralAccess}
                      onChange={(e) => handleToggleGeneralAccess('respondent', e.target.value === 'restricted' ? 'restricted' : 'active')}
                      className="text-[11px] border border-slate-250 rounded-xl px-2.5 py-1.5 bg-white focus:ring-2 focus:ring-emerald-500/15 focus:border-emerald-500 outline-none transition-all text-slate-700 font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="restricted">Hạn chế</option>
                      <option value="reader">Bất kỳ ai có đường...</option>
                    </select>
                  </div>
                </div>

                {/* Action Buttons for Form Links */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  {form.responderUri && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(form.responderUri);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="w-full flex items-center justify-center space-x-2 border border-slate-200 hover:bg-slate-100 bg-white active:scale-95 transition-all text-slate-700 font-bold font-sans text-[11px] uppercase tracking-wide px-4 py-2.5 rounded-2xl cursor-pointer"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600" />
                          <span className="text-emerald-700 font-extrabold">Đã sao chép liên kết!</span>
                        </>
                      ) : (
                        <>
                          <Link className="h-4 w-4 text-slate-500" />
                          <span>Sao chép liên kết người trả lời</span>
                        </>
                      )}
                    </button>
                  )}

                  {form.id && (
                    <a
                      href={`https://docs.google.com/forms/d/${form.id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center space-x-2 border border-slate-200 hover:bg-slate-100 bg-white active:scale-95 transition-all text-slate-700 hover:text-indigo-600 font-bold font-sans text-[11px] uppercase tracking-wide px-4 py-2.5 rounded-2xl cursor-pointer"
                    >
                      <ExternalLink className="h-4 w-4 text-indigo-500" />
                      <span>Truy cập trang chỉnh sửa Form</span>
                    </a>
                  )}
                </div>

              </div>
            </div>

            <hr className="border-slate-200" />

            {/* SECTION 3: Direct Access Authorization on Google Forms */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2.5">
                <Users className="h-4.5 w-4.5 text-indigo-600" />
                <label className="text-xs font-bold uppercase tracking-wider font-sans text-slate-800">
                  Quyền truy cập trực tiếp trên Google Form
                </label>
              </div>
              <p className="text-xs text-slate-500 leading-normal pl-7">
                Quản lý trực tiếp danh sách tài khoản Google được cấp quyền xem/trả lời hoặc chỉnh sửa. Mọi thay đổi sẽ có hiệu lực ngay lập tức trên Google Form gốc.
              </p>

              <div className="pl-7 space-y-4">
                {/* Form to add a new direct permission */}
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
                  <span className="text-[10px] font-sans font-black text-slate-600 uppercase tracking-widest block">
                    Cấp quyền truy cập mới
                  </span>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1">
                      <input
                        type="email"
                        placeholder="Nhập địa chỉ email Google (Gmail hoặc Workspace)..."
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-slate-700 font-medium placeholder:text-slate-400"
                      />
                    </div>
                    <div className="w-full sm:w-auto shrink-0 flex gap-2">
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value as 'reader' | 'writer')}
                        className="text-xs border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-slate-700 font-bold cursor-pointer"
                      >
                        <option value="reader">Người trả lời / Xem</option>
                        <option value="writer">Người chỉnh sửa</option>
                      </select>
                      
                      <button
                        type="button"
                        onClick={handleAddDirectPermission}
                        disabled={isAddingPermission || !newEmail.trim()}
                        className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer disabled:cursor-not-allowed shadow-sm shadow-indigo-100 shrink-0"
                      >
                        {isAddingPermission ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        <span>Cấp quyền</span>
                      </button>
                    </div>
                  </div>
                </div>

                {permissionMessage && (
                  <div className={`text-[10px] p-3 rounded-xl border flex items-start space-x-1.5 font-sans justify-start text-left ${
                    permissionMessage.type === 'success' 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-150' 
                      : 'bg-rose-50 text-rose-800 border-rose-150'
                  }`}>
                    <AlertCircle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                      permissionMessage.type === 'success' ? 'text-emerald-500' : 'text-rose-500'
                    }`} />
                    <div className="leading-relaxed font-semibold">{permissionMessage.text}</div>
                  </div>
                )}

                {/* Permissions List container */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-widest font-black px-1">
                    <span>Danh sách tài khoản được phép</span>
                    <span>{permissions.length} thành viên</span>
                  </div>

                  {isLoadingPermissions ? (
                    <div className="py-6 flex items-center justify-center space-x-2 text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                      <span>Đang kết nối tải danh sách từ Google...</span>
                    </div>
                  ) : permissions.length === 0 ? (
                    <div className="text-[10px] text-slate-400 italic py-4 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                      Không tìm thấy phân quyền chi tiết hoặc biểu mẫu đang ở chế độ công khai.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {permissions.map((perm) => {
                        let roleLabel = 'Thành viên';
                        let roleColor = 'bg-slate-100/80 text-slate-600 border-slate-200';
                        
                        if (perm.role === 'owner') {
                          roleLabel = 'Chủ sở hữu';
                          roleColor = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
                        } else if (perm.role === 'writer') {
                          roleLabel = 'Người chỉnh sửa';
                          roleColor = 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20';
                        } else if (perm.role === 'reader') {
                          roleLabel = 'Người trả lời';
                          roleColor = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
                        }

                        return (
                          <div key={perm.id} className="flex items-center justify-between p-3 bg-white hover:bg-slate-50/50 rounded-2xl border border-slate-150 text-[11px] hover:border-indigo-150 transition-all font-sans">
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="font-extrabold text-slate-800 truncate text-left">
                                {perm.displayName || 'Tài khoản Google'}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 truncate mt-0.5 text-left">
                                {perm.emailAddress || 'Chưa định cấu hình hòm thư hoặc chia sẻ dạng liên kết'}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 shrink-0">
                              <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase border font-sans ${roleColor}`}>
                                {roleLabel}
                              </span>
                              {perm.role !== 'owner' && (
                                <>
                                  {confirmDeleteId === perm.id ? (
                                    <div className="flex items-center space-x-1.5 bg-rose-50 border border-rose-200 px-1.5 py-1 rounded-xl">
                                      <span className="text-[9px] font-black uppercase text-rose-600 tracking-wider">Xóa?</span>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteDirectPermission(perm.id, perm.emailAddress || '')}
                                        disabled={isDeletingPermissionId === perm.id}
                                        className="p-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                                        title="Chắc chắn xóa"
                                      >
                                        {isDeletingPermissionId === perm.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin text-white" />
                                        ) : (
                                          <Check className="h-3 w-3" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        disabled={isDeletingPermissionId === perm.id}
                                        className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                                        title="Hủy"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isDeletingPermissionId !== null}
                                      onClick={() => setConfirmDeleteId(perm.id)}
                                      className="p-1.5 rounded-lg border border-rose-100/80 hover:border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-500 hover:text-rose-700 transition-all cursor-pointer active:scale-95"
                                      title="Thu hồi quyền truy cập"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </form>

          {/* Footer Action */}
          <div className="p-4 px-6 border-t border-slate-205 flex items-center justify-end space-x-3 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-[11px] font-bold uppercase tracking-wider select-none active:scale-95 transition-all cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              onClick={handleSubmit}
              className="flex items-center space-x-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 transition-all text-white rounded-xl text-[11px] font-bold uppercase tracking-wider shadow-md shadow-teal-900/10 select-none cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Lưu Cấu hình</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

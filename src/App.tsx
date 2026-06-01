/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  initAuth, googleSignIn, logout, getAccessToken 
} from './lib/firebase';
import { 
  getDriveFolders, getFolderContents, getFormDetails, 
  getLinkedSheetData, deleteSheetRow, deleteSheetRows, deleteAllSheetResponses, loadFolderSettings, saveFolderSettings 
} from './lib/googleApi';
import { 
  GoogleFormInfo, FormConfigSettings, DriveFolder, SystemNotification 
} from './types';
import Dashboard from './components/Dashboard';
import FormCard from './components/FormCard';
import FormSettingsModal from './components/FormSettingsModal';
import ResponsesList from './components/ResponsesList';
import AppsScriptGuide from './components/AppsScriptGuide';
import FolderTree from './components/FolderTree';
import WordToFormCreator from './components/WordToFormCreator';

import { 
  FolderSync, ShieldCheck, Mail, LogOut, ArrowRight, Grid, LayoutDashboard, 
  Code2, Sparkles, RefreshCw, AlertCircle, FileSpreadsheet, Loader2, Play,
  Globe, Save, Activity, Heart, Search, X, FileText, Menu, Folder, ChevronRight, HelpCircle
} from 'lucide-react';

const shouldFilterByProcedure = (sheetTitle: string, formTitle: string): boolean => {
  if (!sheetTitle || !formTitle) return false;
  
  const normalizeStr = (str: string) => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  };
  
  const normSheet = normalizeStr(sheetTitle);
  const normForm = normalizeStr(formTitle);
  
  // If the sheet tab title is specifically named after this form, this is a dedicated tab. Do NOT filter.
  if (normSheet.includes(normForm) || normForm.includes(normSheet)) {
    return false;
  }
  
  // Commonly used generic tab names where filtering is needed if they contain multiple forms' data:
  const genericTabs = [
    'formresponses', 'formresponses1', 'phanhoibieumau', 'phanhoibieumau1',
    'sheet1', 'sheet', 'trangtinh1', 'trangtinh', 'responses', 'tonghop'
  ];
  const isGeneric = genericTabs.some(gt => normSheet.includes(gt) || gt.includes(normSheet));
  
  // If the sheet title is not generic (e.g., custom tab "Quy trình..."), assume it's a dedicated tab and do not filter
  if (!isGeneric) {
    return false;
  }
  
  return true;
};

const isProcedureColumn = (header: string): boolean => {
  const h = header.toLowerCase().trim();
  if (h.length > 25) return false;
  if (/^\d+[\s\.)]/.test(h)) return false; // Starts with a number like "1. ", "2)", etc.
  if (h.includes('?') || h.includes(':')) return false;
  
  // Commonly used keywords for column containing procedure/form titles
  const validKeywords = [
    'tên quy trình', 'quy trình', 'chọn quy trình', 'quy trình kỹ thuật',
    'tên biểu mẫu', 'biểu mẫu', 'procedure name', 'procedure', 'form name', 'bài đánh giá'
  ];
  
  // Must match one of these keywords exactly or contain them closely
  const isMatch = validKeywords.some(keyword => {
    if (h === keyword) return true;
    if (h.includes(keyword)) {
      // Avoid matching questions like "chuẩn bị quy trình" or "các bước quy trình"
      const badKeywords = ['chuẩn bị', 'bước', 'đủ', 'thực hiện', 'nhận xét', 'góp ý', 'đóng góp', 'ý kiến', 'nội dung', 'kết quả'];
      return !badKeywords.some(bad => h.includes(bad));
    }
    return false;
  });
  
  return isMatch;
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);

  // Drive and Core Data
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [selectedFolderName, setSelectedFolderName] = useState<string>('');
  const [isConnectingFolder, setIsConnectingFolder] = useState(false);
  const [isFolderLoaded, setIsFolderLoaded] = useState(false);

  // Forms in selected folder
  const [forms, setForms] = useState<GoogleFormInfo[]>([]);
  const [configFileId, setConfigFileId] = useState<string | null>(null);
  const [folderSettings, setFolderSettings] = useState<Record<string, FormConfigSettings>>({});
  const [globalAppsScriptUrl, setGlobalAppsScriptUrl] = useState<string>('');
  const [isSavingGlobalAppsScript, setIsSavingGlobalAppsScript] = useState<boolean>(false);

  // Sync global url state when folder settings finish loading
  useEffect(() => {
    if (folderSettings && folderSettings['_global_']) {
      setGlobalAppsScriptUrl(folderSettings['_global_'].appsScriptUrl || '');
    } else {
      setGlobalAppsScriptUrl('');
    }
  }, [folderSettings]);

  // Synchronize Google Form status periodically based on schedules & quotas
  useEffect(() => {
    if (!token || !selectedFolderId || forms.length === 0) return;

    const interval = setInterval(async () => {
      const now = new Date();
      const formsToUpdate: { formId: string; nextStatus: boolean; originalTitle: string; message: string }[] = [];

      for (const form of forms) {
        const settings = form.settings;
        if (!settings) continue;
        if (!settings.enableTimeLimit && !settings.enableMaxResponses) continue;

        let calculatedStatus = form.isAcceptingResponses;
        let msg = '';

        if (settings.enableTimeLimit) {
          const start = settings.startTime ? new Date(settings.startTime) : null;
          const end = settings.endTime ? new Date(settings.endTime) : null;

          const notStarted = start ? now < start : false;
          const expired = end ? now > end : false;
          calculatedStatus = !(notStarted || expired);

          if (calculatedStatus !== form.isAcceptingResponses) {
            msg = calculatedStatus 
              ? `Hệ thống tự động MỞ cổng nhận phản hồi của Form theo lịch hẹn giờ bắt đầu (${settings.startTime ? new Date(settings.startTime).toLocaleString('vi-VN') : ''}).` 
              : (notStarted 
                ? `Hệ thống tự động ĐÓNG cổng phản hồi của Form vì chưa đến thời gian nhận (${settings.startTime ? new Date(settings.startTime).toLocaleString('vi-VN') : ''}).` 
                : `Hệ thống tự động ĐÓNG cổng phản hồi của Form vì đã ngoài thời hạn kết thúc nhận tin (${settings.endTime ? new Date(settings.endTime).toLocaleString('vi-VN') : ''}).`);
          }
        }

        // Tự động đóng cổng nhận phản hồi khi vượt hạn định tối đa và cấu hình đang bật
        if (settings.enableMaxResponses && form.responsesCount >= settings.maxResponses) {
          if (calculatedStatus || form.isAcceptingResponses) {
            calculatedStatus = false;
            msg = `Hệ thống tự động ĐÓNG cổng phản hồi của Form vì số lượng phản hồi hiện tại (${form.responsesCount}) đã đạt hoặc vượt mức tối đa cấu hình (${settings.maxResponses}).`;
          }
        }

        if (calculatedStatus !== form.isAcceptingResponses) {
          formsToUpdate.push({
            formId: form.id,
            nextStatus: calculatedStatus,
            originalTitle: form.title,
            message: msg
          });
        }
      }

      if (formsToUpdate.length === 0) return;

      // Plan update for all mismatched forms
      let updatedFolderSettings = { ...folderSettings };
      
      // Update local forms list inside state with settings updated
      setForms(prev => prev.map(f => {
        const match = formsToUpdate.find(up => up.formId === f.id);
        if (match) {
          const originalSettings = f.settings || {
            formId: f.id,
            enableTimeLimit: true,
            startTime: '',
            endTime: '',
            enableMaxResponses: false,
            maxResponses: 100,
            enableEmailWhitelist: false,
            emailWhitelist: '',
          };
          const updatedFormSetting = {
            ...originalSettings,
            isAcceptingResponses: match.nextStatus,
          };
          updatedFolderSettings[f.id] = updatedFormSetting;
          return {
            ...f,
            isAcceptingResponses: match.nextStatus,
            settings: updatedFormSetting
          };
        }
        return f;
      }));

      // Update folder settings local state to keep in-sync
      setFolderSettings(updatedFolderSettings);

      // Keep settings dialog modal completely in-sync
      setActiveFormForSettings(prev => {
        if (prev) {
          const match = formsToUpdate.find(up => up.formId === prev.id);
          if (match) {
            const originalSettings = prev.settings || {
              formId: prev.id,
              enableTimeLimit: true,
              startTime: '',
              endTime: '',
              enableMaxResponses: false,
              maxResponses: 100,
              enableEmailWhitelist: false,
              emailWhitelist: '',
            };
            return {
              ...prev,
              isAcceptingResponses: match.nextStatus,
              settings: {
                ...originalSettings,
                isAcceptingResponses: match.nextStatus,
              }
            };
          }
        }
        return prev;
      });

      for (const update of formsToUpdate) {
        // Create auto-log notification
        const newNotif: SystemNotification = {
          id: Math.random().toString(),
          formName: update.originalTitle,
          type: update.nextStatus ? 'success' : 'warning',
          message: update.message,
          timestamp: new Date().toISOString(),
          read: false
        };
        setNotifications(prev => [newNotif, ...prev]);

        // Save progress to Google Drive JSON
        try {
          await saveFolderSettings(token, selectedFolderId, updatedFolderSettings, configFileId);
        } catch (err) {
          console.error(`Lỗi khi tự động lưu thiết lập tiến trình thời gian cho form ${update.formId}:`, err);
        }

        // Send API requests to Apps Script
        const appsScriptUrl = updatedFolderSettings['_global_']?.appsScriptUrl || updatedFolderSettings[update.formId]?.appsScriptUrl;
        if (appsScriptUrl) {
          try {
            await fetch(appsScriptUrl, {
              method: 'POST',
              mode: 'no-cors',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                action: 'toggle_accepting',
                formId: update.formId,
                isAccepting: update.nextStatus,
              }),
            });
          } catch (scriptErr) {
            console.error(`Lỗi hệ thống khi cập nhật Apps Script tự động cho form ${update.formId}:`, scriptErr);
          }
        }
      }

    }, 8500); // Check every 8.5s

    return () => clearInterval(interval);
  }, [token, selectedFolderId, forms, folderSettings, configFileId]);

  // Navigation & View controllers
  const [activeTab, setActiveTab ] = useState<'dashboard' | 'forms' | 'guide' | 'docx'>('forms');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeFormForResponses, setActiveFormForResponses] = useState<GoogleFormInfo | null>(null);
  const [formResponsesHeaders, setFormResponsesHeaders] = useState<string[]>([]);
  const [formResponsesRows, setFormResponsesRows] = useState<string[][]>([]);
  const [formResponsesList, setFormResponsesList] = useState<any[]>([]);
  const [isFetchingResponses, setIsFetchingResponses] = useState(false);

  // Search Filter State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showOnlyAcceptingResponses, setShowOnlyAcceptingResponses] = useState<boolean>(false);

  // Modals & Temp States
  const [activeFormForSettings, setActiveFormForSettings] = useState<GoogleFormInfo | null>(null);
  const [isDeletingResponse, setIsDeletingResponse] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);

  // 1. Listen to Firebase login states
  useEffect(() => {
    const unsub = initAuth(
      async (u, t) => {
        setUser(u);
        setToken(t);
        setNeedsAuth(false);
        setIsLoadingAuth(false);
        setAuthErrorMessage(null);
        // Load user's folders once login returns
        try {
          const folderList = await getDriveFolders(t);
          setFolders(folderList);
        } catch (err: any) {
          console.error('Lỗi định cấu danh sách thư mục Drive:', err);
          setAuthErrorMessage(err?.message || 'Không thể liên kết dữ liệu từ Google Drive.');
        }
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
        setIsLoadingAuth(false);
      }
    );
    return () => unsub();
  }, []);

  // Generate some realistic security auditable logs on first folder load for realism
  const generateSimulatedLogs = (folderName: string) => {
    const mockLogs: SystemNotification[] = [
      {
        id: 'mock1',
        formName: 'Khảo sát Hài lòng Người bệnh Nội trú',
        type: 'warning',
        message: 'Hệ thống phát hiện địa chỉ người gửi không khớp cấu hình Whitelist nội bộ bệnh viện.',
        timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
        read: false
      },
      {
        id: 'mock2',
        formName: 'Báo cáo Sự cố Y khoa Tự nguyện (Sông Thương)',
        type: 'success',
        message: 'Hoàn tất cập nhật và đồng bộ 14 phiếu phản hồi lâm sàng mới về Google Sheets liên kết thông qua cổng bảo mật.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        read: true
      },
      {
        id: 'mock3',
        formName: 'Bảng kiểm Tuân thủ Kiểm soát Nhiễm khuẩn',
        type: 'error',
        message: 'Tự động đóng liên kết nhận phản hồi vì đã đạt số lượng giới hạn mẫu tối đa kiểm trị chất lượng tuần này: 50/50 lượt.',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        read: false
      }
    ];
    setNotifications(mockLogs);
  };

  const handleLogin = async () => {
    setIsLoadingAuth(true);
    setAuthErrorMessage(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setNeedsAuth(false);
        const folderList = await getDriveFolders(res.accessToken);
        setFolders(folderList);
      }
    } catch (e: any) {
      console.error('Đăng nhập thất bại:', e);
      setAuthErrorMessage(e?.message || 'Có lỗi xảy ra trong quá trình đăng nhập và nạp dữ liệu từ Google.');
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsFolderLoaded(false);
    setForms([]);
    setNotifications([]);
  };

  // 2. Fetch all Google Forms and settings in the connected Drive Folder
  const handleConnectFolder = async () => {
    if (!selectedFolderId || !token) return;
    setIsConnectingFolder(true);
    
    // Find folder object to get name
    const selectedObj = folders.find(f => f.id === selectedFolderId);
    const folderName = selectedObj ? selectedObj.name : 'Thư mục đã chọn';
    setSelectedFolderName(folderName);

    try {
      // Step A: Load stored settings from JSON config file inside the selected folder
      const { settings, fileId } = await loadFolderSettings(token, selectedFolderId);
      setConfigFileId(fileId);
      setFolderSettings(settings);

      // Step B: Scan folder for forms and spreadsheets
      const { forms: scannedForms, sheets: scannedSheets } = await getFolderContents(token, selectedFolderId);
      
      if (scannedForms.length === 0) {
        alert('Không tìm thấy bất kỳ Google Forms nào trong thư mục đã chọn. Vui lý chọn thư mục có chứa forms!');
        setIsConnectingFolder(false);
        return;
      }

      // Step C: Detailed info loop for each form
      const fullyLoadedForms: GoogleFormInfo[] = [];

      for (const form of scannedForms) {
        try {
          const detail = await getFormDetails(token, form.id);
          
          // Match settings
          const formSetting = settings[form.id] || {
            formId: form.id,
            enableTimeLimit: false,
            startTime: '',
            endTime: '',
            enableMaxResponses: false,
            maxResponses: 100,
            enableEmailWhitelist: false,
            emailWhitelist: '',
          };

          // Link Spreadsheet: Try mapping Spreadsheet having the SAME title, or first Spreadsheet
          let matchedSheetId: string | null = null;
          const matchingSheet = scannedSheets.find(
            (s) => s.name.toLowerCase().includes(detail.title.toLowerCase()) || detail.title.toLowerCase().includes(s.name.toLowerCase())
          );

          if (matchingSheet) {
            matchedSheetId = matchingSheet.id;
          } else if (scannedSheets.length > 0) {
            matchedSheetId = scannedSheets[0].id; // Fallback to first spreadsheet
          }

          let responseCount = 0;
          let formHeaders: string[] = [];
          let formRows: string[][] = [];
          if (matchedSheetId) {
            try {
              const sheetTitleToMatch = detail.title || form.name;
              const sheetData = await getLinkedSheetData(token, matchedSheetId, sheetTitleToMatch);
              
              let currentRows = sheetData.rows;
              formHeaders = sheetData.headers;
              
              // Filter logic for multi-procedure single-sheet structures:
              const lowercaseHeaders = sheetData.headers.map(h => h.toLowerCase());
              const procIndex = lowercaseHeaders.findIndex((h, idx) => 
                isProcedureColumn(sheetData.headers[idx])
              );
              
              const isGenericOrShared = shouldFilterByProcedure(sheetData.sheetTitle, sheetTitleToMatch);
              
              if (procIndex !== -1 && sheetTitleToMatch && isGenericOrShared) {
                const normalizeStr = (str: string) => {
                  if (!str) return '';
                  return str
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^a-z0-9]/g, '');
                };
                const normTitle = normalizeStr(sheetTitleToMatch);
                currentRows = currentRows.filter(row => {
                  const val = row[procIndex];
                  if (!val) return false;
                  const normVal = normalizeStr(val);
                  return normVal === normTitle || normVal.includes(normTitle) || normTitle.includes(normVal);
                });
              }
              
              responseCount = currentRows.length;
              formRows = currentRows;
            } catch (e) {
              console.warn(`Lỗi khi đếm dòng từ Sheet của Form ${form.id}:`, e);
            }
          }

          let isAccepting = formSetting.isAcceptingResponses !== undefined ? formSetting.isAcceptingResponses : true;

          if (formSetting.enableTimeLimit) {
            const now = new Date();
            const start = formSetting.startTime ? new Date(formSetting.startTime) : null;
            const end = formSetting.endTime ? new Date(formSetting.endTime) : null;
            
            const notStarted = start ? now < start : false;
            const expired = end ? now > end : false;

            if (notStarted || expired) {
              isAccepting = false;
            } else {
              isAccepting = true;
            }
          }

          // Kiểm tra giới hạn số lượng phản hồi tối đa khi nạp
          if (formSetting.enableMaxResponses && responseCount >= formSetting.maxResponses) {
            isAccepting = false;
          }

          fullyLoadedForms.push({
            ...detail,
            isAcceptingResponses: isAccepting,
            linkedSheetId: matchedSheetId,
            responsesCount: responseCount,
            settings: formSetting,
            headers: formHeaders,
            rawRows: formRows,
          });
        } catch (err) {
          console.error(`Không thể nạp chi tiết cho Form ${form.id}:`, err);
        }
      }

      setForms(fullyLoadedForms);
      generateSimulatedLogs(folderName);
      setIsFolderLoaded(true);
      setActiveTab('forms');
    } catch (err) {
      console.error('Lỗi khi liên kết thư mục:', err);
      alert('Không thể kết nối thư mục này. Vui lòng xác nhận quyền và thử lại.');
    } finally {
      setIsConnectingFolder(false);
    }
  };

  // 3. Save modified settings for a specific form
  const handleSaveFormSettings = async (newSettings: FormConfigSettings) => {
    if (!token || !selectedFolderId) return;

    const originalForm = forms.find(f => f.id === newSettings.formId);
    const currentAccepting = originalForm ? originalForm.isAcceptingResponses : true;

    // Check time limit alignment if enabled
    let determinedStatus = newSettings.isAcceptingResponses !== undefined 
      ? newSettings.isAcceptingResponses 
      : currentAccepting;
      
    let autoTimeLimitApplied = false;
    let autoTimeLimitMsg = '';

    if (newSettings.enableTimeLimit) {
      const now = new Date();
      const start = newSettings.startTime ? new Date(newSettings.startTime) : null;
      const end = newSettings.endTime ? new Date(newSettings.endTime) : null;
      
      const notStarted = start ? now < start : false;
      const expired = end ? now > end : false;

      if (notStarted || expired) {
        determinedStatus = false;
        autoTimeLimitApplied = true;
        autoTimeLimitMsg = notStarted 
          ? 'Hệ thống tự động ĐÓNG cổng phản hồi của Form vì chưa đến thời gian mở nhận cấu hình.' 
          : 'Hệ thống tự động ĐÓNG cổng phản hồi của Form vì đã ngoài thời hạn kết thúc nhận tin.';
      } else {
        determinedStatus = true;
        autoTimeLimitApplied = true;
        autoTimeLimitMsg = 'Hệ thống tự động MỞ cổng nhận câu hỏi của Form vì thời gian hiện tại nằm trong khoảng hợp lệ.';
      }
    }

    // Kiểm tra giới hạn số lượng phản hồi tối đa khi lưu thiết lập mới
    const currentCount = originalForm ? originalForm.responsesCount : 0;

    if (newSettings.enableMaxResponses && currentCount >= newSettings.maxResponses) {
      determinedStatus = false;
      autoTimeLimitApplied = true;
      autoTimeLimitMsg = `Hệ thống tự động ĐÓNG cổng phản hồi của Form vì số lượng phản hồi hiện tại (${currentCount}) đã đạt hoặc vượt mức tối đa cấu hình (${newSettings.maxResponses}).`;
    }

    const updatedFormSetting = {
      ...newSettings,
      isAcceptingResponses: determinedStatus,
    };

    // Update Local Settings State
    const updatedSettings = {
      ...folderSettings,
      [newSettings.formId]: updatedFormSetting,
    };

    try {
      // Save config JSON upload to Google Drive
      const savedFileId = await saveFolderSettings(token, selectedFolderId, updatedSettings, configFileId);
      setConfigFileId(savedFileId);
      setFolderSettings(updatedSettings);

      // Reflect change in local Forms status
      setForms(prev => prev.map(f => {
        if (f.id === newSettings.formId) {
          return { ...f, isAcceptingResponses: determinedStatus, settings: updatedFormSetting };
        }
        return f;
      }));

      // Keep settings dialog modal completely in-sync
      setActiveFormForSettings(prev => {
        if (prev && prev.id === newSettings.formId) {
          return { ...prev, isAcceptingResponses: determinedStatus, settings: updatedFormSetting };
        }
        return prev;
      });

      // Find form title
      const originalForm = forms.find(f => f.id === newSettings.formId);
      const title = originalForm ? originalForm.title : 'Biểu mẫu';

      // Push real status log
      const newNotif: SystemNotification = {
        id: Math.random().toString(),
        formName: title,
        type: autoTimeLimitApplied ? (determinedStatus ? 'success' : 'warning') : 'info',
        message: autoTimeLimitApplied 
          ? autoTimeLimitMsg 
          : 'Cập nhật và kích hoạt bộ rào chắn lọc: Hạn ngạch & Whitelist bảo mật.',
        timestamp: new Date().toISOString(),
        read: false
      };
      setNotifications(prev => [newNotif, ...prev]);

      // 5. Query Apps Script Web App url to apply the acceptingResponses state change directly on Google Forms
      const appsScriptUrl = folderSettings['_global_']?.appsScriptUrl || updatedFormSetting.appsScriptUrl;
      if (appsScriptUrl) {
        try {
          await fetch(appsScriptUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'toggle_accepting',
              formId: newSettings.formId,
              isAccepting: determinedStatus,
            }),
          });
        } catch (scriptErr) {
          console.error('Lỗi khi gửi yêu cầu đồng bộ đóng/mở nhận câu hỏi đến Google Apps Script:', scriptErr);
        }
      }

    } catch (e) {
      console.error('Gặp sự cố khi ghi cấu hình lên Drive:', e);
      alert('Không thể lưu cài đặt. Hãy kiểm tra kết nối.');
    }
  };

  // 3b. Save global Apps Script Web App URL for the entire folder
  const handleSaveGlobalAppsScript = async () => {
    if (!token || !selectedFolderId) return;
    setIsSavingGlobalAppsScript(true);

    const updatedSettings = {
      ...folderSettings,
      _global_: {
        formId: '_global_',
        enableTimeLimit: false,
        startTime: '',
        endTime: '',
        enableMaxResponses: false,
        maxResponses: 0,
        enableEmailWhitelist: false,
        emailWhitelist: '',
        appsScriptUrl: globalAppsScriptUrl,
      },
    };

    try {
      const savedFileId = await saveFolderSettings(token, selectedFolderId, updatedSettings, configFileId);
      setConfigFileId(savedFileId);
      setFolderSettings(updatedSettings);

      const newNotif: SystemNotification = {
        id: Math.random().toString(),
        formName: 'Cấu hình thư mục',
        type: 'success',
        message: 'Đã lưu cấu hình Google Apps Script Web App chung áp dụng cho toàn bộ thư mục.',
        timestamp: new Date().toISOString(),
        read: false
      };
      setNotifications(prev => [newNotif, ...prev]);
      alert('Cập nhật địa chỉ Apps Script chung thành công! Tất cả chức năng xóa phản hồi trong thư mục này giờ sẽ áp dụng địa chỉ này.');
    } catch (err) {
      console.error('Lỗi khi ghi cấu hình Apps Script chung lên Drive:', err);
      alert('Không thể lưu cấu hình chung. Vui lòng kiểm tra lại kết nối Google Drive.');
    } finally {
      setIsSavingGlobalAppsScript(false);
    }
  };

  // 4. Fetch response list for a specific form
  const handleViewResponses = async (form: GoogleFormInfo) => {
    if (!token) return;
    setActiveFormForResponses(form);
    setIsFetchingResponses(true);

    if (!form.linkedSheetId) {
      alert('Biểu mẫu chưa được xuất dữ liệu kết nối Spreadsheet. Vui lòng tạo tệp Spreadsheet cho nó trước trên Drive!');
      setIsFetchingResponses(false);
      return;
    }

    try {
      const { headers, rows, sheetTitle } = await getLinkedSheetData(token, form.linkedSheetId, form.title);
      setFormResponsesHeaders(headers);
      setFormResponsesRows(rows);

      const lowercaseHeaders = headers.map(h => h.toLowerCase());
      
      // Look for custom email/respondent column in Vietnamese/English
      let emailColIdx = 1; // Default to Column B
      const emailKeywords = ['email', 'mail', 'ngươi nộp', 'người nộp', 'người gửi', 'người đánh giá', 'tài khoản', 'account', 'respondent', 'username', 'đánh giá'];
      const foundEmailIdx = lowercaseHeaders.findIndex(h => 
        emailKeywords.some(keyword => h.includes(keyword))
      );
      if (foundEmailIdx !== -1) {
        emailColIdx = foundEmailIdx;
      }

      // Look for a timestamp/date column in Vietnamese/English
      let timestampColIdx = 0; // Default to Column A
      const timestampKeywords = ['dấu thời gian', 'thời gian', 'timestamp', 'ngày', 'giờ', 'date', 'time'];
      const foundTimeIdx = lowercaseHeaders.findIndex(h => 
        timestampKeywords.some(keyword => h.includes(keyword))
      );
      if (foundTimeIdx !== -1) {
        timestampColIdx = foundTimeIdx;
      }

      // Re-map row arrays to custom structured object representations
      const mappedList: any[] = rows.map((row, rIdx) => {
        const answers: Record<string, string> = {};
        headers.forEach((h, colIdx) => {
          answers[h] = row[colIdx] || '';
        });

        return {
          responseId: `res-${rIdx}`,
          originalIndex: rIdx,
          timestamp: row[timestampColIdx] || '',
          email: row[emailColIdx] || 'Ẩn danh',
          answers,
          rowValues: row,
        };
      });

      // Filter rows based on procedure/form name if there's a column for it
      let filteredList = mappedList;
      const procIndex = lowercaseHeaders.findIndex((h, idx) => 
        isProcedureColumn(headers[idx])
      );

      const isGenericOrShared = shouldFilterByProcedure(sheetTitle, form.title);

      if (procIndex !== -1 && isGenericOrShared) {
        const normalizeStr = (str: string) => {
          if (!str) return '';
          return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
        };
        const normTitle = normalizeStr(form.title);
        filteredList = mappedList.filter(item => {
          const val = item.rowValues[procIndex];
          if (!val) return false;
          const normVal = normalizeStr(val);
          return normVal === normTitle || normVal.includes(normTitle) || normTitle.includes(normVal);
        });
      }

      setFormResponsesList(filteredList);

      // Sync freshly fetched sheet responses & headers back to the central forms state
      setForms(prev => prev.map(f => {
        if (f.id === form.id) {
          return {
            ...f,
            responsesCount: filteredList.length,
            headers: headers,
            rawRows: filteredList.map(item => item.rowValues)
          };
        }
        return f;
      }));
    } catch (err) {
      console.error('Lỗi nạp câu trả lời:', err);
      alert('Không thể đọc đồng bộ dữ liệu của Sheet liên kết. Vui lòng kiểm tra lại liên kết trang tính!');
    } finally {
      setIsFetchingResponses(false);
    }
  };

  // 5. Delete specific user response permanently (MANDATORY security compliant workflow with confirm popup on children)
  const handleDeleteResponse = async (
    responseId: string, 
    email: string, 
    timestamp: string, 
    rowIndex: number
  ) => {
    if (!token || !activeFormForResponses || !activeFormForResponses.linkedSheetId) return;
    setIsDeletingResponse(true);

    try {
      // 1. Fetch metadata sheets list of the spreadsheet to resolve exact correct sheet Tab Name
      const { sheetTitle } = await getLinkedSheetData(token, activeFormForResponses.linkedSheetId, activeFormForResponses.title);
      
      // 2. rowIndex is the parsed row matching location. Sheet lines are 1-based, first data line is row 2
      // rowIndex returned is 0-indexed representing the rows array, so target spreadsheet row number in sheet is: (rowIndex + 2)
      const targetSheetLine = rowIndex + 1; // rowIndex is relative to rows values offset-by-headers in getLinkedSheetData

      // 3. Delete from Google Form via Apps Script if Web App URL is configured
      let formDeleted = false;
      let formDeleteError = false;
      const appsScriptUrl = folderSettings['_global_']?.appsScriptUrl || activeFormForResponses.settings?.appsScriptUrl;
      if (appsScriptUrl) {
        try {
          // Send cross-origin POST request to Apps Script Web App to trigger core Google Form response deletion
          await fetch(appsScriptUrl, {
            method: 'POST',
            mode: 'no-cors', // standard way to dispatch to Google Apps Script Web App without CORS blocks
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'delete_response',
              formId: activeFormForResponses.id,
              responseId: responseId,
            }),
          });
          formDeleted = true;
        } catch (scriptErr) {
          console.error('Lỗi khi gọi Apps Script để xóa câu trả lời trên Google Form:', scriptErr);
          formDeleteError = true;
        }
      }
      
      const success = await deleteSheetRow(
        token, 
        activeFormForResponses.linkedSheetId, 
        sheetTitle, 
        targetSheetLine
      );

      if (success) {
        // Update Local Spreadsheet Cache Lists in memory
        const updatedRows = [...formResponsesRows];
        updatedRows.splice(rowIndex, 1);
        setFormResponsesRows(updatedRows);

        const updatedList = [...formResponsesList];
        updatedList.splice(rowIndex, 1);
        setFormResponsesList(updatedList);

        // Update counts in central Forms List
        setForms(prev => prev.map(f => {
          if (f.id === activeFormForResponses.id) {
            return { ...f, responsesCount: updatedRows.length, rawRows: updatedRows };
          }
          return f;
        }));

        // Build notification message based on whether Apps Script is configured
        let notificationMsg = '';
        let notificationType: 'success' | 'warning' = 'success';
        
        if (appsScriptUrl) {
          if (formDeleteError) {
            notificationMsg = `Đã xóa dòng ${targetSheetLine + 1} của [${email}] trên Sheets, nhưng gặp trục trặc khi gọi Apps Script để xóa trong Google Forms.`;
            notificationType = 'warning';
          } else {
            notificationMsg = `Đã xóa triệt để phản hồi của [${email}] cả trên Google Sheets (dòng ${targetSheetLine + 1}) và trong Google Forms thành công.`;
          }
        } else {
          notificationMsg = `Đã xóa dòng ${targetSheetLine + 1} của [${email}] trên Sheets vĩnh viễn, nhưng chưa xóa trên Google Forms (hãy dán liên kết Apps Script trong cấu hình thư mục để xóa tự động cả hai nơi).`;
          notificationType = 'warning';
        }

        // Log actions in security firewalls notifications
        const clearAction: SystemNotification = {
          id: Math.random().toString(),
          formName: activeFormForResponses.title,
          type: notificationType,
          message: notificationMsg,
          timestamp: new Date().toISOString(),
          read: false
        };
        setNotifications(prev => [clearAction, ...prev]);
        
        // Alert the user on deletion result
        if (appsScriptUrl && !formDeleteError) {
          alert('Đã xóa phản hồi thành công trên cả Google Sheets và Google Forms!');
        } else if (!appsScriptUrl) {
          alert('Đã xóa hàng dữ liệu trên Google Sheets. Lưu ý: Cần kết nối Apps Script Web App ở cài đặt thư mục để xóa kèm trong Google Forms.');
        } else {
          alert('Đã xóa hàng dữ liệu trên Google Sheets, nhưng có lỗi xảy ra khi liên hệ Apps Script Web App để xóa trong Google Forms.');
        }
      } else {
        alert('Có lỗi xảy ra khi yêu cầu Google Sheets API xóa hàng dữ liệu.');
      }
    } catch (e) {
      console.error('Trục trặc khi xóa phản hồi:', e);
      alert('Đã xảy ra lỗi khi thực hiện xóa!');
    } finally {
      setIsDeletingResponse(false);
    }
  };

  // 5c. Delete multiple specific user responses permanently (dual action: (1) Google Forms via Google Apps Script and (2) Google Sheet row deletion)
  const handleDeleteMultipleResponses = async (
    selectedItems: Array<{ responseId: string; email: string; timestamp: string; rowIndex: number }>
  ) => {
    if (!token || !activeFormForResponses || !activeFormForResponses.linkedSheetId || selectedItems.length === 0) return;
    setIsDeletingResponse(true);

    try {
      // 1. Fetch metadata sheets list of the spreadsheet to resolve exact correct sheet Tab Name
      const { sheetTitle } = await getLinkedSheetData(token, activeFormForResponses.linkedSheetId, activeFormForResponses.title);

      // 2. Call Google Apps Script to delete response from Google Form (in parallel for each item since no-cors)
      let formDeleteCount = 0;
      let formErrors = 0;
      const appsScriptUrl = folderSettings['_global_']?.appsScriptUrl || activeFormForResponses.settings?.appsScriptUrl;
      
      if (appsScriptUrl) {
        await Promise.all(
          selectedItems.map(async (item) => {
            try {
              await fetch(appsScriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  action: 'delete_response',
                  formId: activeFormForResponses.id,
                  responseId: item.responseId,
                }),
              });
              formDeleteCount++;
            } catch (scriptErr) {
              console.error(`Lỗi khi gọi Apps Script để xóa câu trả lời ${item.responseId} trên Google Form:`, scriptErr);
              formErrors++;
            }
          })
        );
      }

      // 3. Extract row indices (represent index of the data rows array, i.e. 0-indexed relative to state list)
      const targetRowIndices = selectedItems.map(item => item.rowIndex);

      // Perform Google Sheets api delete
      const success = await deleteSheetRows(
        token,
        activeFormForResponses.linkedSheetId,
        sheetTitle,
        targetRowIndices
      );

      if (success) {
        // Filter out deleted rows from local states
        const updatedRows = formResponsesRows.filter((_, i) => !targetRowIndices.includes(i));
        setFormResponsesRows(updatedRows);

        const updatedList = formResponsesList.filter((_, i) => !targetRowIndices.includes(i));
        setFormResponsesList(updatedList);

        // Update counts in central Forms List
        setForms(prev => prev.map(f => {
          if (f.id === activeFormForResponses.id) {
            return { ...f, responsesCount: updatedRows.length, rawRows: updatedRows };
          }
          return f;
        }));

        // Notifications log
        let notificationMsg = '';
        let notificationType: 'success' | 'warning' = 'success';
        const totalRowsToDelete = selectedItems.length;

        if (appsScriptUrl) {
          if (formErrors > 0) {
            notificationMsg = `Đã xóa ${totalRowsToDelete} hàng trên Sheets, nhưng gặp trục trặc khi gọi Apps Script để xóa một số phản hồi trong Google Forms (${formErrors} lỗi).`;
            notificationType = 'warning';
          } else {
            notificationMsg = `Đã xóa triệt để ${totalRowsToDelete} phản hồi được chọn cả trên Google Sheets và Google Forms thành công.`;
          }
        } else {
          notificationMsg = `Đã xóa vĩnh viễn ${totalRowsToDelete} hàng trên Sheets thành công, nhưng chưa xóa trong Google Forms (hãy dán liên kết Apps Script trong cấu hình thư mục để xóa tự động cả hai nơi).`;
          notificationType = 'warning';
        }

        const clearAction: SystemNotification = {
          id: Math.random().toString(),
          formName: activeFormForResponses.title,
          type: notificationType,
          message: notificationMsg,
          timestamp: new Date().toISOString(),
          read: false
        };
        setNotifications(prev => [clearAction, ...prev]);

        if (appsScriptUrl && formErrors === 0) {
          alert(`Đã xóa thành công ${totalRowsToDelete} phản hồi trên cả Google Sheets và Google Forms!`);
        } else if (!appsScriptUrl) {
          alert(`Đã xóa ${totalRowsToDelete} dòng dữ liệu trên Google Sheets. Lưu ý: Cần kết nối Apps Script Web App ở cài đặt thư mục để xóa hoàn toàn trong Google Forms.`);
        } else {
          alert(`Đã xóa ${totalRowsToDelete} dòng dữ liệu trên Google Sheets, nhưng có một số lỗi khi liên hệ Apps Script Web App để xóa trong Google Forms.`);
        }
      } else {
        alert('Có lỗi xảy ra khi yêu cầu Google Sheets API xóa hàng dữ liệu.');
      }
    } catch (e) {
      console.error('Trục trặc khi xóa hàng loạt phản hồi:', e);
      alert('Đã xảy ra lỗi khi thực hiện xóa!');
    } finally {
      setIsDeletingResponse(false);
    }
  };

  // 5b. Delete all responses (bulk clear)
  const handleDeleteAllResponses = async () => {
    if (!token || !activeFormForResponses || !activeFormForResponses.linkedSheetId) return;
    
    const count = formResponsesRows.length;
    if (count === 0) {
      alert('Không có phản hồi nào để xóa.');
      return;
    }

    setIsDeletingAll(true);

    try {
      // 1. Fetch sheet metadata to resolve sheet title
      const { sheetTitle } = await getLinkedSheetData(token, activeFormForResponses.linkedSheetId, activeFormForResponses.title);

      // 2. Call Google Apps Script to delete all responses in Google Form if URL is configured
      let formDeleted = false;
      let formDeleteError = false;
      const appsScriptUrl = folderSettings['_global_']?.appsScriptUrl || activeFormForResponses.settings?.appsScriptUrl;
      
      if (appsScriptUrl) {
        try {
          await fetch(appsScriptUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'delete_all_responses',
              formId: activeFormForResponses.id,
            }),
          });
          formDeleted = true;
        } catch (scriptErr) {
          console.error('Lỗi khi gọi Apps Script để xóa toàn bộ phản hồi trên Form:', scriptErr);
          formDeleteError = true;
        }
      }

      // 3. Call Sheets API to delete all response rows (everything below header, up to rowCount)
      const success = await deleteAllSheetResponses(
        token,
        activeFormForResponses.linkedSheetId,
        sheetTitle,
        count
      );

      if (success) {
        // Clear in-memory state representing rows
        setFormResponsesRows([]);
        setFormResponsesList([]);

        // Balance / Update forms counts in central Forms List
        setForms(prev => prev.map(f => {
          if (f.id === activeFormForResponses.id) {
            return { ...f, responsesCount: 0, rawRows: [] };
          }
          return f;
        }));

        // Write system notification
        let notificationMsg = '';
        let notificationType: 'success' | 'warning' = 'success';

        if (appsScriptUrl) {
          if (formDeleteError) {
            notificationMsg = `Đã xóa toàn bộ ${count} phản hồi trên Sheets, nhưng gặp trục trặc khi gọi Apps Script để xóa trong Google Forms.`;
            notificationType = 'warning';
          } else {
            notificationMsg = `Đã xóa sạch triệt để toàn bộ ${count} phản hồi trên cả Google Sheets và Google Form thành công.`;
          }
        } else {
          notificationMsg = `Đã xóa toàn bộ ${count} phản hồi trên Sheets thành công, nhưng chưa xóa trong Google Forms (vui lòng cấu hình Apps Script để tự động xóa ở cả hai).`;
          notificationType = 'warning';
        }

        const logAction: SystemNotification = {
          id: Math.random().toString(),
          formName: activeFormForResponses.title,
          type: notificationType,
          message: notificationMsg,
          timestamp: new Date().toISOString(),
          read: false
        };
        setNotifications(prev => [logAction, ...prev]);

        if (appsScriptUrl && !formDeleteError) {
          alert('Đã xóa sạch toàn bộ phản hồi thành công trên cả Google Sheets và Google Forms!');
        } else if (!appsScriptUrl) {
          alert('Đã xóa toàn bộ hàng dữ liệu trên Google Sheets. Hãy dán liên kết Apps Script trong cấu hình thư mục để xóa tự động trên Google Forms.');
        } else {
          alert('Đã xóa toàn bộ hàng dữ liệu trên Google Sheets, nhưng có lỗi xảy ra khi liên hệ Apps Script Web App để xóa trên Google Forms.');
        }
      } else {
        alert('Có lỗi xảy ra khi yêu cầu Google Sheets API xóa hàng dữ liệu.');
      }
    } catch (e: any) {
      console.error('Lỗi khi xóa toàn bộ phản hồi:', e);
      alert('Đã xảy ra lỗi khi thực hiện xóa toàn bộ phản hồi! Chi tiết: ' + (e?.message || JSON.stringify(e)));
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleToggleFormStatus = async (formId: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;

    // 1. Update central forms list immediately
    setForms(prev => prev.map(f => {
      if (f.id === formId) {
        return { ...f, isAcceptingResponses: nextStatus };
      }
      return f;
    }));

    // 2. Keep settings dialog modal completely in-sync
    setActiveFormForSettings(prev => {
      if (prev && prev.id === formId) {
        return { ...prev, isAcceptingResponses: nextStatus };
      }
      return prev;
    });

    // 3. Resolve parent details and write a system notification audit trail
    const targetForm = forms.find(f => f.id === formId);
    const title = targetForm ? targetForm.title : 'Biểu mẫu';

    const statusLabel = nextStatus ? 'ĐANG MỞ NHẬN PHẢN HỒI' : 'TẠM DỪNG NHẬN PHẢN HỒI';
    const notifType = nextStatus ? 'success' : 'warning';

    const localLog: SystemNotification = {
      id: Math.random().toString(),
      formName: title,
      type: notifType,
      message: `Cổng tiếp nhận câu hỏi của Form đã được chuyển đổi trạng thái thành công: [${statusLabel}].`,
      timestamp: new Date().toISOString(),
      read: false
    };

    setNotifications(prev => [localLog, ...prev]);

    // 4. Save state change persistently on Google Drive settings file .gform_manager_settings.json
    if (token && selectedFolderId) {
      const currentFormSetting = folderSettings[formId] || {
        formId: formId,
        enableTimeLimit: false,
        startTime: '',
        endTime: '',
        enableMaxResponses: false,
        maxResponses: 100,
        enableEmailWhitelist: false,
        emailWhitelist: '',
      };

      const updatedFormSetting = {
        ...currentFormSetting,
        isAcceptingResponses: nextStatus,
      };

      const updatedSettings = {
        ...folderSettings,
        [formId]: updatedFormSetting,
      };

      try {
        const savedFileId = await saveFolderSettings(token, selectedFolderId, updatedSettings, configFileId);
        setConfigFileId(savedFileId);
        setFolderSettings(updatedSettings);

        // Update local forms list inside state with settings updated
        setForms(prev => prev.map(f => {
          if (f.id === formId) {
            return { ...f, isAcceptingResponses: nextStatus, settings: updatedFormSetting };
          }
          return f;
        }));
      } catch (err) {
        console.error('Lỗi khi ghi trạng thái nhận phản hồi mới lên Google Drive:', err);
      }
    }

    // 5. Query Apps Script Web App url to apply the acceptingResponses state change directly on Google Forms
    const appsScriptUrl = folderSettings['_global_']?.appsScriptUrl || targetForm?.settings?.appsScriptUrl;
    if (appsScriptUrl) {
      try {
        await fetch(appsScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'toggle_accepting',
            formId: formId,
            isAccepting: nextStatus,
          }),
        });
      } catch (scriptErr) {
        console.error('Lỗi khi gửi yêu cầu đồng bộ đóng/mở nhận câu hỏi đến Google Apps Script:', scriptErr);
      }
    }
  };

  // Trigger loading state screen
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
        <p className="font-sans text-sm font-semibold text-slate-600 mt-4">Đang đồng bộ đăng nhập...</p>
      </div>
    );
  }

  // LOGIN SCREEN
  if (needsAuth || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50/30 via-slate-50 to-emerald-50/30 flex flex-col items-center justify-center p-4">
        {/* Medical Cross Background Grid Effect */}
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200/80 shadow-2xl shadow-teal-900/5 overflow-hidden p-8 text-center space-y-7 relative">
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 via-emerald-500 to-teal-700" />
          
          <div className="space-y-3 shrink-0">
            <div className="h-14 w-14 bg-teal-50 text-teal-600 flex items-center justify-center rounded-2xl mx-auto border border-teal-100 shadow-sm shadow-teal-100/50">
              <Activity className="h-7 w-7" />
            </div>
            
            <h1 className="font-sans font-black text-2xl text-slate-950 tracking-tight">
              MedForm OS
            </h1>
            <p className="text-slate-500 text-xs max-w-xs mx-auto leading-relaxed">
              Hệ thống giám sát, đồng bộ bảo mật danh sách và kiểm soát phản hồi biểu mẫu y tế, khảo sát lâm sàng & chất lượng y khoa.
            </p>
          </div>

          <div className="bg-teal-50/40 rounded-2xl p-4.5 text-left border border-teal-100/50 space-y-2.5">
            <h3 className="text-[10px] font-bold text-teal-900 uppercase tracking-widest flex items-center space-x-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-teal-650" />
              <span>Tiêu chuẩn tuân thủ Y khoa</span>
            </h3>
            <ul className="text-slate-600 text-xs font-sans space-y-2 leading-normal">
              <li>• Quản lý tập trung các tệp Forms trong thư mục Drive an sinh.</li>
              <li>• Rào cản lọc email theo Whitelist để hạn chế trùng lặp phản hồi.</li>
              <li>• Khảo sát sự hài lòng và tự động đồng bộ kết quả về Sheets.</li>
              <li>• Hỗ trợ gỡ sạch phản hồi lỗi tại nguồn Google Forms tức thời.</li>
            </ul>
          </div>

          <button
            onClick={handleLogin}
            className="w-full gsi-material-button flex items-center justify-center active:scale-98 transition-all"
          >
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper shadow-md">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents font-sans font-semibold text-slate-600">Đăng nhập tài khoản Google</span>
            </div>
          </button>

          {authErrorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-left space-y-2 mt-4 transition-all animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-red-650 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-red-800">Cơ chế xác thực chưa được cấp phép (GCP)</h4>
                  <p className="text-red-700 text-[10.5px] font-medium leading-relaxed">
                    {authErrorMessage.includes('GOOGLE_API_DISABLED') ? (
                      <>
                        Yêu cầu truy cập Google Drive API bị từ chối do bạn chưa kích hoạt các API nền tảng trên Google Cloud Console của dự án <strong>quanly-ggform</strong>.
                      </>
                    ) : (
                      authErrorMessage
                    )}
                  </p>
                </div>
              </div>

              {authErrorMessage.includes('GOOGLE_API_DISABLED') && (
                <div className="border-t border-red-100 pt-2 text-[10px] space-y-2 text-slate-600 font-sans leading-normal pl-6">
                  <p className="font-semibold text-slate-800">⚡ Cách xử lý nhanh như sau:</p>
                  <p>Bạn phải kích hoạt (Enable) cả 3 API này trên Google Cloud mới có thể sử dụng biểu mẫu:</p>
                  <div className="space-y-1 pl-1 font-semibold text-teal-700 text-[10.5px]">
                    <div>
                      👉{' '}
                      <a 
                        href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=quanly-ggform" 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="underline hover:text-teal-900 transition-colors"
                      >
                        Bước 1: Kích hoạt Google Drive API
                      </a>
                    </div>
                    <div>
                      👉{' '}
                      <a 
                        href="https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=quanly-ggform" 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="underline hover:text-teal-900 transition-colors"
                      >
                        Bước 2: Kích hoạt Google Sheets API
                      </a>
                    </div>
                    <div>
                      👉{' '}
                      <a 
                        href="https://console.cloud.google.com/apis/library/forms.googleapis.com?project=quanly-ggform" 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="underline hover:text-teal-900 transition-colors"
                      >
                        Bước 3: Kích hoạt Google Forms API
                      </a>
                    </div>
                  </div>
                  <p className="mt-2 text-slate-500 leading-relaxed text-[9.5px]">
                    Lưu ý: Nếu tài khoản đang ở chế độ thử nghiệm (Testing), hãy chắc chắn bạn đã thêm tài sản email của mình vào mục <a href="https://console.cloud.google.com/apis/credentials/consent?project=quanly-ggform" target="_blank" rel="noreferrer" className="underline font-bold text-slate-700 hover:text-slate-900">Màn hình đồng ý OAuth (Consent screen)</a>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // CONNECT DRIVE FOLDER STATE SCREEN
  if (!isFolderLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200/80 shadow-2xl shadow-teal-900/5 overflow-hidden p-7 space-y-6 text-left relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-teal-600" />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono text-slate-500 font-semibold">{user.email}</span>
            </div>
            
            <button
              onClick={handleLogout}
              className="p-1.5 hover:bg-slate-55 text-slate-400 hover:text-rose-600 rounded-lg transition-all"
              title="Đăng xuất"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-1.5 text-left">
            <h2 className="font-sans font-black text-lg text-slate-950">Liên kết Cơ sở dữ liệu</h2>
            <p className="text-slate-500 text-xs leading-relaxed">
              Lựa chọn thư mục Drive lưu trữ các phiếu khảo sát người bệnh, kiểm tra chất lượng lâm sàng hoặc báo cáo sự cố để đồng bộ quản lý.
            </p>
          </div>

          {/* Folder dropdown */}
          <div className="space-y-2">
            <label className="text-[10px] font-sans font-extrabold text-slate-400 uppercase tracking-widest pl-0.5">Thư mục hồ sơ y khoa</label>
            <FolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(id, name) => {
                setSelectedFolderId(id);
                setSelectedFolderName(name);
              }}
            />
          </div>

          {folders.length === 0 && (
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 text-[10px] text-amber-850 flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <p className="leading-relaxed">
                Không tìm thấy thư mục phù hợp. Vui lòng tạo thư mục chứa các biểu mẫu y tế và bảng kết quả tương ứng trên Google Drive, sau đó tải lại trang!
              </p>
            </div>
          )}

          <button
            onClick={handleConnectFolder}
            disabled={!selectedFolderId || isConnectingFolder}
            className="w-full flex items-center justify-center space-x-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-2xl py-3.5 text-xs font-bold active:scale-98 transition-all shadow-md shadow-teal-100 cursor-pointer"
          >
            {isConnectingFolder ? (
              <>
                <RefreshCw className="h-4.5 w-4.5 animate-spin text-teal-200" />
                <span>Đang quét các biểu mẫu y tế...</span>
              </>
            ) : (
              <>
                <FolderSync className="h-4.5 w-4.5" />
                <span>Nạp Dữ liệu Thư mục</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const filteredForms = forms.filter(form => {
    // Check search term
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || 
                          form.title.toLowerCase().includes(term) || 
                          form.id.toLowerCase().includes(term);
    
    // Check accepting responses filter
    const matchesAccepting = !showOnlyAcceptingResponses || form.isAcceptingResponses;
    
    return matchesSearch && matchesAccepting;
  });

  // MAIN RUNNING APP WORKSPACE
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row font-sans text-slate-800">
      
      {/* 1. Mobile Header (shown only on mobile screen widths) */}
      <header className="md:hidden bg-white border-b border-slate-200 py-3.5 px-4 flex items-center justify-between sticky top-0 z-30 select-none">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 bg-teal-600 text-white rounded-lg flex items-center justify-center shadow-md shadow-teal-100">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-sans font-black text-xs text-slate-950 tracking-tight uppercase">
              MedForm OS
            </h1>
            <span className="text-[9px] text-teal-650 font-extrabold uppercase tracking-wide block">Khảo Sát Lâm Sàng</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-lg transition-all cursor-pointer"
            title="Mở menu điều khiển"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* 2. Responsive Sticky Desktop Sidebar Menu (Bảng menu) */}
      <aside className={`
        fixed md:sticky top-0 left-0 z-40 md:z-20
        w-64 h-screen shrink-0
        bg-[#0F172A] border-r border-slate-800/60 text-slate-200
        flex flex-col justify-between
        transition-transform duration-300 ease-in-out select-none
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        
        <div className="flex flex-col p-5 space-y-6 overflow-y-auto max-h-[85vh] scrollbar-none">
          {/* Close button for mobile menu screen */}
          <div className="md:hidden flex justify-end">
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Brand Logo Header */}
          <div className="flex items-center space-x-3 text-left">
            <div className="w-9 h-9 bg-teal-600 text-white rounded-xl flex items-center justify-center ring-4 ring-teal-500/15 shadow-md shadow-teal-600/30">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-sans font-black text-sm text-white tracking-tight uppercase flex items-center gap-1.5 leading-none">
                MedForm OS
              </h1>
              <span className="text-[8px] text-teal-400 font-extrabold uppercase tracking-wider block mt-1">KHẢO SÁT & BẢO MẬT Y KHOA</span>
            </div>
          </div>

          {/* Active Folder Widget Component (Database Control Interface) */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-3.5 space-y-3 text-left transition-all duration-300">
            <div className="flex items-center space-x-2 text-slate-400">
              <Folder className="h-3.5 w-3.5 text-teal-400 shrink-0" />
              <span className="text-[9px] font-sans font-extrabold uppercase tracking-widest text-slate-400">HỒ SƠ KHẢO SÁT CHÍNH</span>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-black text-white leading-normal truncate font-sans italic" title={selectedFolderName}>
                {selectedFolderName || 'Chưa đồng bộ'}
              </p>
              <p className="text-[9px] text-slate-500 font-mono leading-none truncate">Drive ID: {selectedFolderId ? selectedFolderId.substring(0, 14) + '...' : ''}</p>
            </div>
            {/* Swappable folder button to re-trigger directory selection */}
            <button
              onClick={() => {
                setIsFolderLoaded(false);
                setForms([]);
                setMobileMenuOpen(false);
              }}
              className="mt-1 w-full bg-slate-800 hover:bg-teal-650 hover:text-white text-slate-300 p-2 rounded-xl text-[9px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
              title="Đổi thư mục Drive lưu trữ"
            >
              <RefreshCw className="h-3 w-3 animate-spin duration-3000" />
              <span>CHUYỂN THƯ MỤC</span>
            </button>
          </div>

          {/* Navigation Menu Panels */}
          <div className="space-y-5 pt-1 text-left">
            <div className="space-y-1.5">
              <span className="text-[9px] font-sans font-black text-slate-500 uppercase tracking-widest pl-1.5 block">Hệ thống giám sát</span>
              <nav className="space-y-1">
                {/* Bảng vận hành (Dashboard) */}
                <button
                  onClick={() => {
                    setActiveTab('dashboard');
                    setActiveFormForResponses(null); // Return to dashboard root
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer text-left relative overflow-hidden ${
                    activeTab === 'dashboard' && !activeFormForResponses
                      ? 'bg-teal-600/95 text-white shadow-lg shadow-teal-500/20 border-l-4 border-teal-400 pl-3'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border-l-4 border-transparent pl-3'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <LayoutDashboard className={`h-4 w-4 shrink-0 transition-colors ${activeTab === 'dashboard' && !activeFormForResponses ? 'text-teal-300' : 'text-slate-550'}`} />
                    <span>Bảng vận hành</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-black tracking-wider leading-none ${activeTab === 'dashboard' && !activeFormForResponses ? 'bg-teal-700 text-teal-100' : 'bg-slate-800 text-slate-400'}`}>
                    {forms.reduce((acc, f) => acc + f.responsesCount, 0)}
                  </span>
                </button>

                {/* Bộ lọc biểu mẫu (Forms filter list) */}
                <button
                  onClick={() => {
                    setActiveTab('forms');
                    setActiveFormForResponses(null); // Return to forms root
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer text-left relative overflow-hidden ${
                    activeTab === 'forms' && !activeFormForResponses
                      ? 'bg-teal-600/95 text-white shadow-lg shadow-teal-500/20 border-l-4 border-teal-400 pl-3'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border-l-4 border-transparent pl-3'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Grid className={`h-4 w-4 shrink-0 transition-colors ${activeTab === 'forms' && !activeFormForResponses ? 'text-teal-300' : 'text-slate-550'}`} />
                    <span>Hệ thống biểu mẫu</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-black tracking-wider leading-none ${activeTab === 'forms' && !activeFormForResponses ? 'bg-teal-700 text-teal-100' : 'bg-slate-800 text-slate-400'}`}>
                    {forms.length}
                  </span>
                </button>
              </nav>
            </div>

            <div className="space-y-1.5">
              <span className="text-[9px] font-sans font-black text-slate-500 uppercase tracking-widest pl-1.5 block">Tự động hóa</span>
              <nav className="space-y-1">
                {/* Tạo Form từ Word */}
                <button
                  onClick={() => {
                    setActiveTab('docx');
                    setActiveFormForResponses(null); // Return to docx root
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer text-left relative overflow-hidden ${
                    activeTab === 'docx' && !activeFormForResponses
                      ? 'bg-teal-600/95 text-white shadow-lg shadow-teal-500/20 border-l-4 border-teal-400 pl-3'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border-l-4 border-transparent pl-3'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <FileText className={`h-4 w-4 shrink-0 transition-colors ${activeTab === 'docx' && !activeFormForResponses ? 'text-teal-300' : 'text-slate-550'}`} />
                    <span>Tạo Form từ Word</span>
                  </div>
                  <span className="bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded text-[7.5px] uppercase tracking-wider font-sans font-black leading-none shrink-0">AI Core</span>
                </button>

                {/* Mã Apps Script proxy */}
                <button
                  onClick={() => {
                    setActiveTab('guide');
                    setActiveFormForResponses(null); // Return to guide root
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer text-left relative overflow-hidden ${
                    activeTab === 'guide' && !activeFormForResponses
                      ? 'bg-teal-600/95 text-white shadow-lg shadow-teal-500/20 border-l-4 border-teal-400 pl-3'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900/60 border-l-4 border-transparent pl-3'
                  }`}
                >
                  <div className="flex items-center space-x-2.5">
                    <Code2 className={`h-4 w-4 shrink-0 transition-colors ${activeTab === 'guide' && !activeFormForResponses ? 'text-teal-300' : 'text-slate-550'}`} />
                    <span>Cấu hình Apps Script</span>
                  </div>
                  <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />
                </button>
              </nav>
            </div>
          </div>

          {/* Real-time Health indicators widget inside Sidebar layout (Architectural honesty with Vietnamese style) */}
          <div className="bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900 text-left space-y-2">
            <div className="flex items-center space-x-2 text-slate-500 font-mono tracking-wider font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[8.5px] font-bold">STATE SYNC PROTOCOLS</span>
            </div>
            <div className="text-[9px] text-slate-400 font-medium leading-normal space-y-1 font-mono">
              <p>• Google API: Ready (Token OK)</p>
              <p>• Security Layer: active (SSL)</p>
              <p>• Whitelist Engine: Online</p>
            </div>
          </div>
        </div>

        {/* Sidebar Footer layout: active personnel info & LogOut trigger */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/45 flex items-center justify-between">
          <div className="min-w-0 flex-1 pl-1 text-left">
            <p className="text-[10px] text-slate-300 font-black uppercase tracking-widest truncate">{user.displayName || 'Bác sĩ Sông Thương'}</p>
            <p className="text-[9.5px] text-teal-400 font-mono truncate leading-tight mt-0.5" title={user.email}>{user.email}</p>
          </div>
          
          <button
            onClick={handleLogout}
            className="p-2 hover:bg-slate-850 text-slate-400 hover:text-rose-400 rounded-lg transition-all cursor-pointer shrink-0 ml-2 border border-transparent hover:border-slate-800"
            title="Đăng xuất tài khoản Google"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Menu Backdrop transparent overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-3xs z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 3. Right Side Workspace Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        
        {/* Desktop Header panel (statically shown instead of full horizontal header) */}
        <header className="hidden md:flex bg-white border-b border-slate-200 py-[17px] px-8 sticky top-0 z-30 shrink-0 items-center justify-between select-none">
          <div className="text-left">
            <h2 className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 leading-none">
              {activeFormForResponses ? (
                <span className="flex items-center space-x-1.5">
                  <span>GIÁM SÁT BIỂU MẪU</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-teal-600 font-black">{activeFormForResponses.title}</span>
                </span>
              ) : (
                <>
                  {activeTab === 'forms' && 'Tìm kiếm quy trình & Cấu hình rào cản hành chính'}
                  {activeTab === 'dashboard' && 'Bảng thông số vận hành lâm sàng'}
                  {activeTab === 'docx' && 'Biến tập tài liệu y văn thông minh'}
                  {activeTab === 'guide' && 'Cấu hình đồng bộ Google Cloud Engine'}
                </>
              )}
            </h2>
            <p className="text-base font-black text-slate-950 tracking-tight italic mt-1 leading-none uppercase">
              {activeFormForResponses ? (
                <span>Trình quản lý câu trả lời thời gian thực</span>
              ) : (
                <>
                  {activeTab === 'forms' && 'Hồ Sơ Toàn Bộ Phiếu Khảo Sát'}
                  {activeTab === 'dashboard' && 'Thống Kê Chỉ Số Chất Lượng Bệnh Viện'}
                  {activeTab === 'docx' && 'Bộ Máy Tạo Biểu Mẫu Word Thông Minh'}
                  {activeTab === 'guide' && 'Trung Tâm Liên Kết Apps Script Proxy'}
                </>
              )}
            </p>
          </div>

          {/* Secure database indicators widget */}
          <div className="flex items-center space-x-2.5 bg-teal-50 px-3 py-1.5 rounded-xl border border-teal-100">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-[9px] font-black text-teal-800 font-sans tracking-wide uppercase">CƠ SỞ DỮ LIỆU ĐANG LIÊN KẾT: GOOGLE DRIVE</span>
          </div>
        </header>

        {/* Content Wrapper */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
          {activeFormForResponses ? (
            /* RESPONSES WORKSPACE (Selected form only) */
            isFetchingResponses ? (
              <div className="py-24 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-200 shadow-sm text-center">
                <Loader2 className="h-10 w-10 text-teal-655 animate-spin" />
                <p className="font-sans text-xs font-semibold text-slate-500 mt-4">Xác thực chứng thư & Đồng bộ dữ liệu gốc từ Sheets...</p>
              </div>
            ) : (
              <ResponsesList
                form={activeFormForResponses}
                responses={formResponsesList}
                headers={formResponsesHeaders}
                rawRows={formResponsesRows}
                onBack={() => {
                  setActiveFormForResponses(null);
                  handleConnectFolder(); // Sync counts
                }}
                onRefresh={() => handleViewResponses(activeFormForResponses)}
                onDeleteResponse={handleDeleteResponse}
                onDeleteMultipleResponses={handleDeleteMultipleResponses}
                isDeleting={isDeletingResponse}
                onDeleteAllResponses={handleDeleteAllResponses}
                isDeletingAll={isDeletingAll}
              />
            )
          ) : (
            /* DYNAMIC MULTI-VIEW WORKSPACE MODULES TABS PANEL */
            <div className="space-y-8">
              {activeTab === 'forms' && (
                <div className="space-y-6 text-left">
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div className="space-y-1">
                      <div>
                        <span className="text-[10px] font-mono font-bold text-teal-600 bg-teal-50 px-2.5 py-1 rounded border border-teal-200/50 uppercase tracking-widest">DRIVE DB CONNECTED</span>
                      </div>
                      <h2 className="text-xl font-black text-slate-900 tracking-tight italic uppercase">Toàn bộ quy trình biểu mẫu hoạt động</h2>
                      <p className="text-xs text-slate-500">Cấu hình rào cản hành chính (giới hạn lượt, hẹn giờ đóng/mở nhận câu trả lời, Whitelist email) của các phiếu khảo sát nằm trong Thư mục: <span className="font-mono text-slate-600 font-semibold">{selectedFolderName}</span></p>
                    </div>

                     {/* Search Bar & Filters - Modern and Sleek */}
                     <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto shrink-0 select-none">
                       {/* Only Accepting Responses Checkbox */}
                       <label className="flex items-center space-x-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 active:scale-[0.98] transition-all cursor-pointer shadow-3xs">
                         <input
                           type="checkbox"
                           checked={showOnlyAcceptingResponses}
                           onChange={(e) => setShowOnlyAcceptingResponses(e.target.checked)}
                           className="h-4 w-4 rounded border-slate-300 text-teal-650 focus:ring-teal-500/10 focus:ring-offset-0 focus:ring-2 accent-teal-650 cursor-pointer"
                         />
                         <span>Chỉ hiện form đang nhận phản hồi</span>
                       </label>

                       <div className="relative w-full sm:w-64">
                         <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                           <Search className="h-4 w-4 text-teal-650" />
                         </div>
                         <input
                           type="text"
                           placeholder="Tìm quy trình kỹ thuật..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 focus:bg-white rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-450 placeholder:font-normal focus:ring-2 focus:ring-teal-500/10 focus:border-teal-550 outline-none transition-all shadow-3xs"
                         />
                         {searchTerm && (
                           <button
                             onClick={() => setSearchTerm('')}
                             className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-rose-500 cursor-pointer"
                             title="Xóa bộ lọc"
                           >
                             <X className="h-3.5 w-3.5" />
                           </button>
                         )}
                       </div>
                     </div>
                  </div>

                  {filteredForms.length === 0 ? (
                    <div className="py-16 text-center bg-white rounded-3xl border border-slate-200 p-6 space-y-3.5 shadow-3xs">
                      <div className="h-12 w-12 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto border border-teal-100">
                        <Search className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-sans font-black text-slate-900 text-sm">Không tìm thấy biểu mẫu phù hợp</h4>
                        <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                          {searchTerm && showOnlyAcceptingResponses
                            ? `Không tìm thấy phiếu khảo sát nào khớp với từ khóa "${searchTerm}" và đang ở trạng thái nhận phản hồi.`
                            : searchTerm
                            ? `Không tìm thấy phiếu khảo sát nào khớp với từ khóa "${searchTerm}".`
                            : "Không tìm thấy phiếu khảo sát nào đang ở trạng thái nhận phản hồi."}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {searchTerm && (
                          <button
                            onClick={() => setSearchTerm('')}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-2 border border-slate-200 hover:border-slate-300 text-slate-700 bg-white hover:bg-slate-50 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
                          >
                            <span>Xóa từ khóa</span>
                          </button>
                        )}
                        {showOnlyAcceptingResponses && (
                          <button
                            onClick={() => setShowOnlyAcceptingResponses(false)}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-2 border border-slate-200 hover:border-slate-300 text-slate-700 bg-white hover:bg-slate-50 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
                          >
                            <span>Hiển thị tất cả form</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {filteredForms.map(form => (
                        <FormCard
                          key={form.id}
                          form={form}
                          onOpenSettings={(f) => setActiveFormForSettings(f)}
                          onOpenResponses={(f) => handleViewResponses(f)}
                          onToggleStatus={handleToggleFormStatus}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'dashboard' && (
                <Dashboard
                  forms={forms}
                  folderName={selectedFolderName}
                  notifications={notifications}
                  onMarkNotificationRead={(id) => {
                    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
                  }}
                  onClearNotifications={() => setNotifications([])}
                />
              )}

              {activeTab === 'guide' && (
                <div className="text-left">
                  <AppsScriptGuide
                    folderId={selectedFolderId || ''}
                    folderName={selectedFolderName || ''}
                    globalAppsScriptUrl={globalAppsScriptUrl}
                    setGlobalAppsScriptUrl={setGlobalAppsScriptUrl}
                    onSaveGlobalAppsScript={handleSaveGlobalAppsScript}
                    isSavingGlobalAppsScript={isSavingGlobalAppsScript}
                  />
                </div>
              )}

              {activeTab === 'docx' && (
                <div className="text-left">
                  <WordToFormCreator
                    token={token}
                    folderId={selectedFolderId || ''}
                    folderName={selectedFolderName || ''}
                    globalAppsScriptUrl={globalAppsScriptUrl}
                    onSuccess={() => {
                      setActiveTab('forms');
                      handleConnectFolder();
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Settings Dialog Modal */}
      {activeFormForSettings && (
        <FormSettingsModal
          isOpen={!!activeFormForSettings}
          onClose={() => setActiveFormForSettings(null)}
          form={activeFormForSettings}
          onSave={handleSaveFormSettings}
          onToggleStatus={handleToggleFormStatus}
          token={token}
          globalAppsScriptUrl={globalAppsScriptUrl}
        />
      )}
    </div>
  );
}
